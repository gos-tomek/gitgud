import type { createClient } from "@/lib/supabase";
import type { UserBoard } from "@/types";

type SupabaseClient = NonNullable<ReturnType<typeof createClient>>;

interface BoardRow {
  id: string;
  name: string;
  owner_user_id: string;
  created_at: string;
  updated_at: string;
}

function toUserBoard(row: BoardRow, userId: string): UserBoard {
  const ownerUserId = row.owner_user_id;
  return {
    id: row.id,
    name: row.name,
    ownerUserId,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    role: ownerUserId === userId ? "supervisor" : "contributor",
  };
}

export async function getUserBoards(supabase: SupabaseClient, userId: string): Promise<UserBoard[]> {
  const { data, error } = await supabase
    .from("boards")
    .select("id,name,owner_user_id,created_at,updated_at,board_members!inner(user_id)")
    .eq("board_members.user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data as BoardRow[]).map((row) => toUserBoard(row, userId));
}

export async function getBoardWithRole(
  supabase: SupabaseClient,
  boardId: string,
  userId: string,
): Promise<UserBoard | null> {
  const { data, error } = await supabase
    .from("boards")
    .select("id,name,owner_user_id,created_at,updated_at")
    .eq("id", boardId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return toUserBoard(data, userId);
}
