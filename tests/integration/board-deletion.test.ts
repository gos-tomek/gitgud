import { adminClient } from "../helpers/supabase.js";
import { seedTwoBoards, type TwoBoardFixture } from "../helpers/seed.js";
import { checkSupabase } from "../helpers/setup.js";

const supabaseAvailable = await checkSupabase();

describe.skipIf(!supabaseAvailable)("Board-only deletion cascade", () => {
  let fixture: TwoBoardFixture;

  beforeAll(async () => {
    fixture = await seedTwoBoards();
  });

  afterAll(async () => {
    await fixture.cleanup();
  });

  it("cascades through all 6 child tables when board owner deletes via RLS", async () => {
    const { boardId, client } = fixture.ownerA;
    const { repoId, prId } = fixture;

    const { error } = await client.from("boards").delete().eq("id", boardId);
    expect(error).toBeNull();

    // board_members was dropped in 20260623110000_drop_board_members.sql; access is now derived.
    const [repoResult, contributorResult, prResult, reviewResult, commentResult, classificationResult] =
      await Promise.all([
        adminClient.from("github_repos").select("id").eq("board_id", boardId),
        adminClient.from("board_contributors").select("board_id").eq("board_id", boardId),
        adminClient.from("github_pull_requests").select("id").eq("repo_id", repoId),
        adminClient.from("github_reviews").select("id").eq("pull_request_id", prId),
        adminClient.from("github_review_comments").select("id").eq("pull_request_id", prId),
        adminClient.from("thread_classifications").select("pull_request_id").eq("pull_request_id", prId),
      ]);

    expect(repoResult.data).toEqual([]);
    expect(contributorResult.data).toEqual([]);
    expect(prResult.data).toEqual([]);
    expect(reviewResult.data).toEqual([]);
    expect(commentResult.data).toEqual([]);
    expect(classificationResult.data).toEqual([]);
  });
});
