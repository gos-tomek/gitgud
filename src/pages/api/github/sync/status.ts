import type { APIRoute } from "astro";
import { z } from "zod";
import { env } from "cloudflare:workers";
import { createClient } from "@/lib/supabase";
import { getBoardWithRole } from "@/lib/services/boards";

const statusSchema = z.object({
  boardId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Invalid board ID"),
  instanceId: z.string().min(1, "Instance ID is required"),
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type SupabaseClient = NonNullable<ReturnType<typeof createClient>>;

type ValidationResult =
  | { ok: true; supabase: SupabaseClient; boardId: string; instanceId: string; userId: string }
  | { ok: false; response: Response };

// Shared by GET (status) and DELETE (terminate): auth, query-param shape, and the
// dedup-key-prefix check that stops a board member from probing another board's instance.
async function validate(context: Parameters<APIRoute>[0]): Promise<ValidationResult> {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return { ok: false, response: json({ error: "Supabase is not configured" }, 503) };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, response: json({ error: "Unauthorized" }, 401) };
  }

  const url = new URL(context.request.url);
  const parsed = statusSchema.safeParse({
    boardId: url.searchParams.get("boardId"),
    instanceId: url.searchParams.get("instanceId"),
  });
  if (!parsed.success) {
    const message = parsed.error.issues.at(0)?.message ?? "Invalid input";
    return { ok: false, response: json({ error: message }, 400) };
  }

  const { boardId, instanceId } = parsed.data;

  if (!instanceId.startsWith(`board-${boardId}-`)) {
    return { ok: false, response: json({ error: "Instance does not belong to this board" }, 403) };
  }

  return { ok: true, supabase, boardId, instanceId, userId: user.id };
}

export const GET: APIRoute = async (context) => {
  const result = await validate(context);
  if (!result.ok) return result.response;
  const { supabase, boardId, instanceId, userId } = result;

  // RLS on `boards` already scopes this to members of the board — no further role check needed
  // for a read-only status lookup (unlike triggering or cancelling a sync, which are owner-only).
  const board = await getBoardWithRole(supabase, boardId, userId);
  if (!board) {
    return json({ error: "Board not found" }, 404);
  }

  try {
    const instance = await env.CLASSIFICATION_BATCH.get(instanceId);
    const { status } = await instance.status();
    return json({ status });
  } catch {
    return json({ error: "Instance not found" }, 404);
  }
};

export const DELETE: APIRoute = async (context) => {
  const result = await validate(context);
  if (!result.ok) return result.response;
  const { supabase, boardId, instanceId, userId } = result;

  const board = await getBoardWithRole(supabase, boardId, userId);
  if (!board) {
    return json({ error: "Board not found" }, 404);
  }
  if (board.role !== "supervisor") {
    return json({ error: "Only the board owner can cancel a sync" }, 403);
  }

  try {
    const instance = await env.CLASSIFICATION_BATCH.get(instanceId);
    await instance.terminate();
    return json({ status: "terminated" });
  } catch {
    // terminate() throws if the instance is already errored/terminated/complete — the caller's
    // goal (stop it running) is already met in all of those cases, so treat this as a no-op
    // success rather than an error.
    return json({ status: "unknown" });
  }
};
