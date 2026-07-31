import { createClient } from "@supabase/supabase-js";
import { adminClient, cleanupBoard, SUPABASE_URL, SUPABASE_ANON_KEY } from "../../helpers/supabase.js";
import {
  FIXTURE_OWNER,
  FIXTURE_REPO,
  FIXTURE_CONTRIBUTOR,
  FIXTURE_CONTRIBUTOR_GITHUB_ID,
} from "../github-mock-server.js";

export interface SyncBoardFixture {
  boardId: string;
  repoOwner: string;
  repoName: string;
  contributorLogin: string;
  cleanup: () => Promise<void>;
}

/**
 * Seeds a board owned by the shared E2E test user (E2E_EMAIL/E2E_PASSWORD — the same
 * account auth.setup.ts signs in as) with one repo matching the GitHub mock server's fixture
 * data and one contributor whose github_id matches the mock PR/review author ids, so the
 * synced KPI metrics resolve to that contributor.
 */
export async function seedSyncBoard(): Promise<SyncBoardFixture> {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  if (!email || !password) {
    throw new Error("E2E_EMAIL and E2E_PASSWORD must be set to seed the sync board");
  }

  // The E2E test user already exists (see README's E2E setup section) — sign in to resolve its
  // id rather than creating a new user, since the sync Workflow reads the board owner's stored
  // GitHub PAT (seeded once per suite run by auth.setup.ts).
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Failed to sign in E2E test user: ${error.message}`);
  const ownerUserId = data.user.id;

  const boardName = `Sync Chain ${Date.now()}`;
  const { data: boardData, error: boardError } = await adminClient
    .from("boards")
    .insert({ name: boardName, owner_user_id: ownerUserId })
    .select("id")
    .single();
  if (boardError) throw new Error(`Failed to create board: ${boardError.message}`);
  const boardId = boardData.id as string;

  const { error: repoError } = await adminClient
    .from("github_repos")
    .insert({ board_id: boardId, repo_owner: FIXTURE_OWNER, repo_name: FIXTURE_REPO });
  if (repoError) throw new Error(`Failed to create repo: ${repoError.message}`);

  const { error: contributorError } = await adminClient.from("board_contributors").insert({
    board_id: boardId,
    github_id: FIXTURE_CONTRIBUTOR_GITHUB_ID,
    github_login: FIXTURE_CONTRIBUTOR,
  });
  if (contributorError) throw new Error(`Failed to create contributor: ${contributorError.message}`);

  return {
    boardId,
    repoOwner: FIXTURE_OWNER,
    repoName: FIXTURE_REPO,
    contributorLogin: FIXTURE_CONTRIBUTOR,
    // boards DELETE cascades github_repos + board_contributors
    cleanup: () => cleanupBoard(boardId),
  };
}
