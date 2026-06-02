export type BoardRole = "supervisor" | "contributor";

export interface Board {
  id: string;
  name: string;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
}

export type UserBoard = Board & { role: BoardRole };

export interface GitHubRepo {
  id: string;
  boardId: string;
  repoOwner: string;
  repoName: string;
  connectedAt: string;
  connectedBy: string;
}

export interface GitHubPullRequest {
  id: number;
  repoId: string;
  number: number;
  title: string;
  state: string;
  authorLogin: string;
  authorGithubId: number;
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  fetchedAt: string;
}

export interface GitHubReview {
  id: number;
  pullRequestId: number;
  reviewerLogin: string;
  reviewerGithubId: number;
  state: string;
  submittedAt: string;
  fetchedAt: string;
}

export interface BoardContributor {
  boardId: string;
  githubId: number;
  githubLogin: string;
  avatarUrl: string | null;
  userId: string | null;
  addedAt: string;
}

export interface GitHubReviewComment {
  id: number;
  pullRequestId: number;
  reviewId: number | null;
  commenterLogin: string;
  commenterGithubId: number;
  body: string;
  path: string | null;
  positionLine: number | null;
  positionSide: string | null;
  createdAt: string;
  updatedAt: string;
  fetchedAt: string;
}
