import type { APIContext } from "astro";

// Virtual module — must be mocked before any import that transitively loads it
// (src/lib/supabase.ts reads SUPABASE_URL/SUPABASE_KEY from astro:env/server).
vi.mock("astro:env/server", () => ({
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_KEY: "test-key",
}));

// Only the cookie-transport layer is faked — createClient returns a *real*,
// already-authenticated Supabase client from the integration fixture below, so
// every query the route handler issues (RLS, board_contributors, user_profiles)
// runs against the real local Supabase instance. This is what the hermetic
// suite (tests/hermetic/impact-api.test.ts) cannot exercise: it mocks the
// Supabase client itself, so it can't catch a route querying a column whose
// real-world value (board_contributors.user_id) is never populated.
vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));

import { createClient } from "@/lib/supabase";
import { adminClient } from "../helpers/supabase.js";
import { checkSupabase } from "../helpers/setup.js";
import { seedTwoBoards, type TwoBoardFixture } from "../helpers/seed.js";

const { GET: summaryGET } = await import("@/pages/api/board/[boardId]/impact/[login]/summary");
const { GET: authorGET } = await import("@/pages/api/board/[boardId]/impact/[login]/author");
const { GET: reviewerGET } = await import("@/pages/api/board/[boardId]/impact/[login]/reviewer");
const { GET: activityGET } = await import("@/pages/api/board/[boardId]/impact/[login]/activity");
const { GET: classificationsGET } = await import("@/pages/api/board/[boardId]/impact/[login]/classifications");
const { GET: threadsGET } = await import("@/pages/api/board/[boardId]/threads/[login]");

const supabaseAvailable = await checkSupabase();

function makeContext(boardId: string, login: string): APIContext {
  const url = new URL(`http://localhost/api/board/${boardId}/impact/${login}/summary`);
  return { request: new Request(url), cookies: {}, params: { boardId, login }, url } as unknown as APIContext;
}

describe.skipIf(!supabaseAvailable)("Impact API ownership guard against real data (Risk #1 regression)", () => {
  let fixture: TwoBoardFixture;
  let contributorLogin: string;
  const otherContributorLogin = "someone-else";

  beforeAll(async () => {
    fixture = await seedTwoBoards();

    const { data, error } = await adminClient
      .from("board_contributors")
      .select("github_login")
      .eq("board_id", fixture.ownerA.boardId)
      .eq("github_id", fixture.contributor.githubId)
      .single();
    if (error) throw new Error(`Failed to look up seeded contributor login: ${error.message}`);
    contributorLogin = data.github_login as string;

    // A second contributor on the same board, unrelated to fixture.contributor — proves the
    // ownership guard distinguishes "a board member" from "this specific board member".
    const { error: insertError } = await adminClient.from("board_contributors").insert({
      board_id: fixture.ownerA.boardId,
      github_id: fixture.contributor.githubId + 1,
      github_login: otherContributorLogin,
    });
    if (insertError) throw new Error(`Failed to seed second contributor: ${insertError.message}`);

    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(fixture.contributor.client);
  });

  afterAll(async () => {
    await fixture.cleanup();
  });

  // board_contributors.user_id is never populated by any insert path (create_board_atomic
  // omits it) — a guard keyed on it would always evaluate to "not found" for every real
  // contributor. This is exactly the bug manual testing caught after Phase 3/4: a real
  // contributor reaching their own impact page got 403 instead of 200.
  it.each([
    ["summary", summaryGET],
    ["author", authorGET],
    ["reviewer", reviewerGET],
    ["activity", activityGET],
    ["classifications", classificationsGET],
    ["threads", threadsGET],
  ] as const)("%s: a contributor can view their own impact profile (200, not 403)", async (_name, handler) => {
    const res = await handler(makeContext(fixture.ownerA.boardId, contributorLogin));
    expect(res.status).toBe(200);
  });

  it.each([
    ["summary", summaryGET],
    ["author", authorGET],
    ["reviewer", reviewerGET],
    ["activity", activityGET],
    ["classifications", classificationsGET],
    ["threads", threadsGET],
  ] as const)("%s: a contributor cannot view another contributor's impact profile (403)", async (_name, handler) => {
    const res = await handler(makeContext(fixture.ownerA.boardId, otherContributorLogin));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Forbidden");
  });
});
