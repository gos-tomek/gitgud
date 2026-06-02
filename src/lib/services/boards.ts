import type { createClient } from "@/lib/supabase";
import type { BoardContributor, UserBoard } from "@/types";

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

export class BoardNameTakenError extends Error {
  constructor() {
    super("You already have a board with that name");
    this.name = "BoardNameTakenError";
  }
}

export async function createBoard(supabase: SupabaseClient, userId: string, name: string): Promise<{ id: string }> {
  const trimmed = name.trim();
  const { data, error } = await supabase
    .from("boards")
    .insert({ name: trimmed, owner_user_id: userId })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") throw new BoardNameTakenError();
    throw error;
  }

  return { id: String(data.id) };
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

export async function getBoardRepos(
  supabase: SupabaseClient,
  boardId: string,
): Promise<{ repoOwner: string; repoName: string; connectedAt: string }[]> {
  const { data, error } = await supabase
    .from("github_repos")
    .select("repo_owner,repo_name,connected_at")
    .eq("board_id", boardId)
    .order("connected_at", { ascending: true });

  if (error) throw error;

  return data.map((row) => ({
    repoOwner: row.repo_owner as string,
    repoName: row.repo_name as string,
    connectedAt: row.connected_at as string,
  }));
}

export async function getBoardContributors(supabase: SupabaseClient, boardId: string): Promise<BoardContributor[]> {
  const { data, error } = await supabase
    .from("board_contributors")
    .select("board_id,github_id,github_login,avatar_url,user_id,added_at")
    .eq("board_id", boardId)
    .order("added_at", { ascending: true });

  if (error) throw error;

  return data.map((row) => ({
    boardId: row.board_id as string,
    githubId: row.github_id as number,
    githubLogin: row.github_login as string,
    avatarUrl: row.avatar_url as string | null,
    userId: row.user_id as string | null,
    addedAt: row.added_at as string,
  }));
}

export async function addBoardContributors(
  supabase: SupabaseClient,
  boardId: string,
  contributors: { githubId: number; githubLogin: string; avatarUrl: string | null | undefined }[],
): Promise<void> {
  const { error } = await supabase.from("board_contributors").insert(
    contributors.map((c) => ({
      board_id: boardId,
      github_id: c.githubId,
      github_login: c.githubLogin,
      avatar_url: c.avatarUrl ?? null,
    })),
  );

  if (error) throw error;
}
