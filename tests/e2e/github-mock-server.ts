import http from "node:http";

export interface MockServer {
  url: string;
  stop: () => Promise<void>;
}

// Fixture PRs — all within the 90-day backfill window (2026-06 to 2026-07).
// PRs #1 and #2 authored by alice-dev (→ "PRs authored" KPI).
// PR #3 authored by bob-dev with alice-dev as reviewer (→ "Reviews given" KPI).
export const FIXTURE_OWNER = "acme-org";
export const FIXTURE_REPO = "backend";
export const FIXTURE_CONTRIBUTOR = "alice-dev";

export const FIXTURE_PRS = [
  {
    id: 100001,
    number: 1,
    title: "Add feature A",
    state: "closed",
    user: { login: "alice-dev", id: 1001 },
    draft: false,
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
    merged_at: "2026-06-01T00:00:00Z",
  },
  {
    id: 100002,
    number: 2,
    title: "Fix bug B",
    state: "closed",
    user: { login: "alice-dev", id: 1001 },
    draft: false,
    created_at: "2026-06-15T00:00:00Z",
    updated_at: "2026-06-15T00:00:00Z",
    merged_at: "2026-06-15T00:00:00Z",
  },
  {
    id: 100003,
    number: 3,
    title: "Refactor C",
    state: "closed",
    user: { login: "bob-dev", id: 1002 },
    draft: false,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    merged_at: "2026-07-01T00:00:00Z",
  },
];

// alice-dev left one inline review comment on PR #3 (bob's PR).
const FIXTURE_REVIEW_COMMENTS = [
  {
    id: 3001,
    pull_request_url: "https://api.github.com/repos/acme-org/backend/pulls/3",
    pull_request_review_id: 2002,
    user: { login: "alice-dev", id: 1001 },
    body: "Looks good to me!",
    path: "src/index.ts",
    line: 42,
    side: "RIGHT",
    in_reply_to_id: null,
    created_at: "2026-07-02T10:00:00Z",
    updated_at: "2026-07-02T10:00:00Z",
  },
];

// Build a GraphQL response body for `aliasCount` PR aliases.
// The third alias (pr_2) carries alice-dev's APPROVED review so that the "Reviews given" KPI
// shows a non-zero value. databaseId 2002 matches the review comment's pull_request_review_id
// so the FK check in syncReviewCommentsForRepo accepts the inline comment row.
function buildGqlRepository(aliasCount: number): Record<string, unknown> {
  const repository: Record<string, unknown> = {};
  for (let i = 0; i < aliasCount; i++) {
    repository[`pr_${i}`] = {
      additions: 10 * (i + 1),
      deletions: 3 * (i + 1),
      changedFiles: i + 1,
      reviews: {
        nodes:
          i === 2
            ? [
                {
                  databaseId: 2002,
                  state: "APPROVED",
                  submittedAt: "2026-07-02T10:00:00Z",
                  author: { login: "alice-dev", databaseId: 1001 },
                },
              ]
            : [],
        pageInfo: { hasNextPage: false, endCursor: "" },
      },
    };
  }
  return repository;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString());
    });
    req.on("error", reject);
  });
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(json) });
  res.end(json);
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const urlPath = (req.url ?? "/").split("?")[0];
  const method = req.method ?? "GET";

  // GET /repos/:owner/:repo/pulls — PR listing (paginated)
  if (method === "GET" && /^\/repos\/[^/]+\/[^/]+\/pulls$/.test(urlPath)) {
    send(res, 200, FIXTURE_PRS);
    return;
  }

  // GET /repos/:owner/:repo/pulls/comments — repo-wide review comments
  if (method === "GET" && /^\/repos\/[^/]+\/[^/]+\/pulls\/comments$/.test(urlPath)) {
    send(res, 200, FIXTURE_REVIEW_COMMENTS);
    return;
  }

  // POST /graphql — batched PR details + reviews query
  if (method === "POST" && urlPath === "/graphql") {
    const body = await readBody(req);
    let aliasCount = FIXTURE_PRS.length;
    try {
      const parsed = JSON.parse(body) as { query?: string };
      const matches = [...(parsed.query ?? "").matchAll(/\bpr_(\d+):/g)];
      const distinct = new Set(matches.map((m) => m[1]));
      if (distinct.size > 0) aliasCount = distinct.size;
    } catch {
      // fall through: use default alias count
    }
    send(res, 200, { data: { repository: buildGqlRepository(aliasCount) } });
    return;
  }

  send(res, 404, { message: `No mock for ${method} ${urlPath}` });
}

export async function startGitHubMockServer(port: number): Promise<MockServer> {
  const server = http.createServer((req, res) => {
    void handleRequest(req, res);
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(port, "127.0.0.1", () => {
      resolve();
    });
    server.on("error", reject);
  });

  return {
    url: `http://localhost:${port}`,
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      }),
  };
}
