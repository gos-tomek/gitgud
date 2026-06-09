import { adminClient, cleanupBoard, cleanupUser, createTestUser } from "../helpers/supabase.js";
import { checkSupabase } from "../helpers/setup.js";

const supabaseAvailable = await checkSupabase();

describe.skipIf(!supabaseAvailable)("Smoke: test infrastructure", () => {
  let userId: string;
  let boardId: string | undefined;

  afterEach(async () => {
    if (boardId) {
      await cleanupBoard(boardId);
      boardId = undefined;
    }
    if (userId) {
      await cleanupUser(userId);
    }
  });

  it("admin client connects and boards table is accessible", async () => {
    const { data, error } = await adminClient.from("boards").select("id").limit(1);
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  it("createTestUser creates an authenticated client with RLS enforced", async () => {
    const email = `smoke-${Date.now()}@test.local`;
    const { client, userId: uid } = await createTestUser(email);
    userId = uid;

    // A fresh user with no boards should see no rows (RLS: is_board_member returns false)
    const { data, error } = await client.from("boards").select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("admin can create a board that the owner can read back", async () => {
    const email = `smoke-board-${Date.now()}@test.local`;
    const { client, userId: uid } = await createTestUser(email);
    userId = uid;

    const { data: insertData, error: insertError } = await adminClient
      .from("boards")
      .insert({ name: "smoke-board", owner_user_id: uid })
      .select("id")
      .single();
    expect(insertError).toBeNull();
    if (!insertData) throw new Error("Insert returned no data");
    boardId = insertData.id as string;

    // Owner should see their own board through the user client (RLS: boards_select_owner policy)
    const { data: readData, error: readError } = await client.from("boards").select("id").eq("id", boardId);
    expect(readError).toBeNull();
    expect(readData).toHaveLength(1);
  });
});
