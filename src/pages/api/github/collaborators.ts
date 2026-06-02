import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { makeOctokit, GitHubAuthError } from "@/lib/github";
import { logger } from "@/lib/logger";

const collaboratorsSchema = z.object({
  pat: z.string().min(1, "PAT is required"),
  repos: z
    .array(
      z.object({
        owner: z.string().min(1),
        name: z.string().min(1),
      }),
    )
    .min(1, "At least one repository is required"),
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const COLLABORATOR_LIMIT = 200;

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

  const parsed = collaboratorsSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues.at(0)?.message ?? "Invalid input";
    return json({ error: message }, 400);
  }

  const { pat, repos } = parsed.data;

  try {
    const octokit = makeOctokit(pat);
    const collaboratorMap = new Map<number, { login: string; id: number; avatarUrl: string; type: string }>();
    const warnings: { repo: string; message: string }[] = [];

    // listContributors (not listCollaborators) is intentional: read-only PATs work, and contributors
    // correlate with who appears in PR/review ingestion data — the users an EM actually wants to track.
    for (const repo of repos) {
      if (collaboratorMap.size >= COLLABORATOR_LIMIT) break;

      try {
        for await (const response of octokit.paginate.iterator(octokit.rest.repos.listContributors, {
          owner: repo.owner,
          repo: repo.name,
          per_page: 100,
        })) {
          // GitHub returns 202 while computing contribution stats for the first time — no data yet.
          if ((response.status as number) === 202) {
            warnings.push({ repo: `${repo.owner}/${repo.name}`, message: "Stats still computing, try again shortly" });
            break;
          }
          for (const contributor of response.data) {
            if (!contributor.id) continue;
            if (!collaboratorMap.has(contributor.id)) {
              collaboratorMap.set(contributor.id, {
                login: contributor.login ?? "",
                id: contributor.id,
                avatarUrl: contributor.avatar_url ?? "",
                type: contributor.type,
              });
            }
            if (collaboratorMap.size >= COLLABORATOR_LIMIT) break;
          }
          if (collaboratorMap.size >= COLLABORATOR_LIMIT) break;
        }
      } catch (err) {
        // Per-repo auth error — PAT has no access to this private repo; skip with a warning
        if (err instanceof GitHubAuthError) {
          warnings.push({ repo: `${repo.owner}/${repo.name}`, message: "Insufficient access" });
          continue;
        }
        throw err;
      }
    }

    return json({ collaborators: Array.from(collaboratorMap.values()), warnings });
  } catch (err) {
    if (err instanceof GitHubAuthError) {
      return json({ error: "Token is invalid or expired" }, 401);
    }
    logger.error("[collaborators]", err);
    return json({ error: "Failed to fetch collaborators" }, 500);
  }
};
