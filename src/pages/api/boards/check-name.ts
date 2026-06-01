import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";

const schema = z.object({
  name: z.string().trim().min(1, "Board name is required").max(80, "Keep it under 80 characters"),
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

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues.at(0);
    return json({ error: firstIssue?.message ?? "Invalid input" }, 400);
  }

  const { data } = await supabase
    .from("boards")
    .select("id")
    .eq("owner_user_id", user.id)
    .ilike("name", parsed.data.name)
    .maybeSingle();

  if (data) {
    return json({ error: "You already have a board with that name" }, 409);
  }

  return new Response(null, { status: 204 });
};
