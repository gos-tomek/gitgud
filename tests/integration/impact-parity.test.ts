import type { APIContext } from "astro";

// Virtual module — must be mocked before any import that transitively loads it
vi.mock("astro:env/server", () => ({
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_KEY: "test-key",
}));

vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));

import { createClient } from "@/lib/supabase";
import { checkSupabase } from "../helpers/setup.js";
import { seedTwoBoards, type TwoBoardFixture } from "../helpers/seed.js";
import { adminClient } from "../helpers/supabase.js";

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

describe.skipIf(!supabaseAvailable)("Impact API IC-vs-EM data parity (Risk #7)", () => {
  let fixture: TwoBoardFixture;
  let contributorLogin: string;

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
  });

  afterAll(async () => {
    await fixture.cleanup();
  });

  it.each([
    ["summary", summaryGET],
    ["author", authorGET],
    ["reviewer", reviewerGET],
    ["activity", activityGET],
    ["classifications", classificationsGET],
    ["threads", threadsGET],
  ] as const)(
    "%s: IC and EM receive identical JSON payloads for the same contributor profile",
    async (_name, handler) => {
      const mockClient = vi.mocked(createClient);
      const ctx = makeContext(fixture.ownerA.boardId, contributorLogin);

      mockClient.mockReturnValueOnce(fixture.contributor.client);
      const icRes = await handler(ctx);
      expect(icRes.status).toBe(200);
      const icBody = (await icRes.json()) as unknown;

      mockClient.mockReturnValueOnce(fixture.ownerA.client);
      const emRes = await handler(ctx);
      expect(emRes.status).toBe(200);
      const emBody = (await emRes.json()) as unknown;

      expect(icBody).toEqual(emBody);
    },
  );
});
