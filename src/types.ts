export type BoardRole = "supervisor" | "contributor";

export interface Board {
  id: string;
  name: string;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
}

export type UserBoard = Board & { role: BoardRole };
