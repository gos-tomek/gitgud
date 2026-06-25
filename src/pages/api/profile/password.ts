import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(6, "New password must be at least 6 characters"),
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
  if (!user?.email) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = changePasswordSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues.at(0)?.message ?? "Invalid input";
    return json({ error: message }, 400);
  }

  const { currentPassword, newPassword } = parsed.data;

  // Re-verify the current password before allowing the change — the session alone isn't
  // proof of intent to change credentials (e.g. an unattended/hijacked-but-not-yet-expired
  // session shouldn't be able to silently lock the real owner out).
  const { error: reauthError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (reauthError) {
    return json({ error: "Current password is incorrect" }, 401);
  }

  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
  if (updateError) {
    logger.error("[profile/password] updateUser failed", { userId: user.id, detail: updateError.message });
    return json({ error: "Failed to update password. Please try again." }, 500);
  }

  return json({ ok: true });
};
