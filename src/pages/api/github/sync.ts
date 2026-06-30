import type { APIRoute } from "astro";
import { z } from "zod";
import { env } from "cloudflare:workers";
import { createClient } from "@/lib/supabase";
import { getBoardWithRole } from "@/lib/services/boards";
import { logger } from "@/lib/logger";

const syncSchema = z.object({
  boardId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Invalid board ID"),
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ error: "Supabase is not configured" }, 503);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = syncSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues.at(0)?.message ?? "Invalid input";
    return json({ error: message }, 400);
  }

  const { boardId } = parsed.data;

  const board = await getBoardWithRole(supabase, boardId, user.id);
  if (!board) {
    return json({ error: "Board not found" }, 404);
  }
  if (board.role !== "supervisor") {
    return json({ error: "Only the board owner can trigger a sync" }, 403);
  }

  // One Workflow instance per board per UTC day — matches the daily Cron dispatcher's dedup key
  // (src/worker.ts `scheduled`), so a manual trigger on a day the Cron already ran (or a rapid
  // double-click) returns the existing instance instead of starting a second sync+classify run.
  const dateStamp = new Date().toISOString().slice(0, 10);
  const instanceId = `board-${boardId}-${dateStamp}`;

  try {
    const instance = await env.CLASSIFICATION_BATCH.create({ id: instanceId, params: { boardId } });
    return json({ instanceId: instance.id, status: "queued" });
  } catch (err) {
    // Workflow.create() throws if the id already exists — check the existing instance's state.
    try {
      const existing = await env.CLASSIFICATION_BATCH.get(instanceId);
      const { status } = await existing.status();

      // If the previous run finished (successfully or with an error), allow a retry with a
      // unique suffix so the dedup key no longer collides. Running instances are left alone.
      if (status === "errored" || status === "complete") {
        const retryId = `${instanceId}-${Date.now()}`;
        const retried = await env.CLASSIFICATION_BATCH.create({ id: retryId, params: { boardId } });
        return json({ instanceId: retried.id, status: "queued" });
      }

      return json({ instanceId: existing.id, status });
    } catch {
      logger.error("[github-sync]", err);
      return json({ error: "Failed to start sync" }, 500);
    }
  }
};
