import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

interface GitHubUser {
  id: number;
  login: string;
  avatar_url: string;
}

const signupSchema = z.object({
  email: z.string().min(1, "Email is required"),
  password: z.string().min(1, "Password is required"),
  github_login: z.string().min(1, "GitHub username is required"),
});

async function fetchGitHubUser(login: string): Promise<GitHubUser | null> {
  const response = await fetch(`https://api.github.com/users/${encodeURIComponent(login)}`, {
    headers: { Accept: "application/json", "User-Agent": "GitGud-App" },
  });

  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);

  return await response.json();
}

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const parsedBody = signupSchema.safeParse({
    email: form.get("email"),
    password: form.get("password"),
    github_login: form.get("github_login"),
  });
  if (!parsedBody.success) {
    const message = parsedBody.error.issues.at(0)?.message ?? "Invalid signup data";
    return context.redirect(`/auth/signup?error=${encodeURIComponent(message)}`);
  }
  const { email, password } = parsedBody.data;
  const githubLogin = parsedBody.data.github_login.trim().toLowerCase();

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signup?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  let githubUser: GitHubUser | null;
  try {
    githubUser = await fetchGitHubUser(githubLogin);
  } catch (err) {
    logger.error("GitHub username verification failed", err);
    return context.redirect(
      `/auth/signup?error=${encodeURIComponent("Could not verify GitHub username. Please try again later.")}`,
    );
  }

  if (!githubUser) {
    return context.redirect(`/auth/signup?error=${encodeURIComponent("GitHub username not found")}`);
  }

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        github_id: githubUser.id,
        github_login: githubUser.login,
        avatar_url: githubUser.avatar_url,
      },
    },
  });

  if (error) {
    logger.error("Account creation failed", error);
    return context.redirect(`/auth/signup?error=${encodeURIComponent("Account creation failed. Please try again.")}`);
  }

  return context.redirect("/auth/confirm-email");
};
