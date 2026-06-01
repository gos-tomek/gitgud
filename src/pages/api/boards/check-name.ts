import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";

const schema = z.object({
  name: z.string().trim().min(1, "Board name is required").max(80, "Keep it under 80 characters"),
});

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return new Response(JSON.stringify({ error: "Supabase is not configured" }), { status: 500 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues.at(0);
    return new Response(JSON.stringify({ error: firstIssue?.message ?? "Invalid input" }), { status: 400 });
  }

  const { data } = await supabase
    .from("boards")
    .select("id")
    .eq("owner_user_id", user.id)
    .ilike("name", parsed.data.name)
    .maybeSingle();

  if (data) {
    return new Response(JSON.stringify({ error: "You already have a board with that name" }), { status: 409 });
  }

  return new Response(null, { status: 204 });
};
