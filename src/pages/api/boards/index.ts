import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { createBoard, BoardNameTakenError } from "@/lib/services/boards";

const createBoardSchema = z.object({
  name: z.string().trim().min(1, "Board name is required").max(80, "Keep it under 80 characters"),
});

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/boards/new?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return context.redirect("/auth/signin");
  }

  const form = await context.request.formData();
  const raw = { name: form.get("name") as string };
  const parsed = createBoardSchema.safeParse(raw);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues.at(0);
    const message = firstIssue?.message ?? "Invalid input";
    return context.redirect(`/boards/new?error=${encodeURIComponent(message)}`);
  }

  try {
    const { id } = await createBoard(supabase, user.id, parsed.data.name);
    return context.redirect(`/boards/${id}`);
  } catch (err) {
    if (err instanceof BoardNameTakenError) {
      return context.redirect(`/boards/new?error=${encodeURIComponent(err.message)}`);
    }
    return context.redirect(`/boards/new?error=${encodeURIComponent("Something went wrong. Please try again.")}`);
  }
};
