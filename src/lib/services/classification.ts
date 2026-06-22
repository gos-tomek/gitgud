import { z } from "zod";
import type { createClient } from "@/lib/supabase";
import type { IntentCategory, TechnicalDomain } from "@/types";
import { logger } from "@/lib/logger";

type SupabaseClient = NonNullable<ReturnType<typeof createClient>>;

export const CLASSIFICATION_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as const;

// Known bot accounts seen on GitHub review threads, beyond the `[bot]` / `-bot` suffix convention.
const KNOWN_BOT_LOGINS = new Set([
  "dependabot",
  "dependabot[bot]",
  "renovate",
  "renovate[bot]",
  "codecov",
  "codecov-bot",
  "codecov-commenter",
  "github-actions",
  "github-actions[bot]",
]);

export function isBotComment(login: string): boolean {
  const normalized = login.toLowerCase();
  if (KNOWN_BOT_LOGINS.has(normalized)) return true;
  if (normalized.endsWith("[bot]")) return true;
  if (normalized.endsWith("-bot")) return true;
  return false;
}

// Raw DB row shape — only fields needed to assemble a thread payload.
interface CommentRow {
  id: number;
  pull_request_id: number;
  in_reply_to_id: number | null;
  commenter_login: string;
  body: string;
  path: string | null;
  position_line: number | null;
  created_at: string;
}

interface PrRow {
  id: number;
  title: string;
  author_login: string;
}

export interface PrMeta {
  title: string;
  authorLogin: string;
}

export type ThreadCommentRole = "pr-author" | "reviewer" | "other";

export interface ThreadPayload {
  thread_id: number;
  prTitle: string;
  isInline: boolean;
  path: string | null;
  diffHunk: string | null;
  comments: { role: ThreadCommentRole; body: string }[];
}

export function assembleThreadPayload(
  rootComment: CommentRow,
  replies: CommentRow[],
  prMeta: PrMeta,
  diffHunk: string | null,
): ThreadPayload {
  const orderedReplies = [...replies].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  const ordered = [rootComment, ...orderedReplies];

  const roleFor = (login: string): ThreadCommentRole => {
    if (login === prMeta.authorLogin) return "pr-author";
    if (login === rootComment.commenter_login) return "reviewer";
    return "other";
  };

  return {
    thread_id: rootComment.id,
    prTitle: prMeta.title,
    isInline: rootComment.path !== null,
    path: rootComment.path,
    diffHunk,
    comments: ordered.map((c) => ({ role: roleFor(c.commenter_login), body: c.body })),
  };
}

// Wire schema for one item of the batched classification response. "unknown" is a valid intent
// (CI/process noise, unclassifiable) but deliberately not a valid domain — there is no DB row to
// store a thread under an "unknown" domain, so a domain vote that lands there is treated as a
// classification failure for that thread (see classifyBatch) rather than a real category.
const ClassificationItemSchema = z.object({
  thread_id: z.number(),
  intent: z.enum([
    "mentoring",
    "architecture",
    "bug-catch",
    "nitpick",
    "unblocking",
    "question",
    "praise",
    "joke",
    "self-review",
    "unknown",
  ]),
  domain: z.enum(["functional", "refactoring", "documentation", "discussion", "false-positive"]),
});

export type ClassificationItem = z.infer<typeof ClassificationItemSchema>;

export function parseClassificationItem(raw: unknown): ClassificationItem {
  return ClassificationItemSchema.parse(raw);
}

// Some Workers AI models wrap JSON output in markdown code fences (```json ... ```) despite
// response_format: json_object. Slice out the [...] body before JSON.parse.
export function extractJsonArray(text: string): string {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return text;
  return text.slice(start, end + 1);
}

export interface ClassificationResult {
  thread_root_comment_id: number;
  pull_request_id: number;
  intent: IntentCategory;
  domain: TechnicalDomain;
  model_id: string;
}

// Validated empirically against ~100 real threads (with manual ground truth on a curated
// hard/ambiguous subset) across multiple A/B/C rounds — batch size, override-rule placement, and
// prompt length were each independently tested; this is the structure and wording that held up.
export const CLASSIFICATION_SYSTEM_PROMPT = `You are a JSON-only classifier for GitHub code review threads. Output ONLY a raw JSON array — no markdown, no preamble, no text outside the array.

Each thread's intent is anchored on its FIRST comment (the root). Later replies are context only — a long or technical reply does not override what the root was clearly about, unless it reveals the root meant something else entirely.

Input: a JSON array of threads.

Output: a JSON array, same order, thread_id copied exactly:
[{"thread_id":<copied>,"intent":"...","domain":"..."}]

intent: mentoring | architecture | bug-catch | nitpick | unblocking | question | praise | joke | self-review | unknown
domain: functional | refactoring | documentation | discussion | false-positive

## OVERRIDE RULES — check in this order; stop at the first match

1. ALL comments in the thread are from "pr-author" (including a single comment with no reviewer reply) -> self-review, regardless of content, even if it reads like a detailed explanation.
2. (else) Any comment contains a \`\`\`suggestion block -> bug-catch, however minor the edit.
3. (else) A comment cross-references elsewhere ("same here"/"same above") AND adds a description of the problem or fix -> bug-catch. A bare "same here"/"+1"/"ditto" with no elaboration is NOT covered here — see SPECIAL CASES.

## INTENT (when no override applies) — each with its deciding test

- mentoring: explains a concept, convention, or WHY, aimed at the author's growth. Test: would this comment exist if the author were a principal engineer? If no -> mentoring.
- architecture: structural/component/API/data-flow change, OR a FIRM objection to duplicating existing functionality ("don't recreate this" — even hedged: "90% sure"). Test: does it object outright with no escape clause? If the comment explicitly allows keeping the current code anyway ("otherwise it's fine to leave it") -> mentoring instead, not architecture.
- bug-catch: asserts a concrete defect, wrong behavior, or broken/incorrect link — a claim that something IS currently wrong, not just a suggestion. (Most threads land here via override rules 2-3 above.)
- nitpick: trivial style/naming/formatting, in prose. Tests would pass identically either way. A "nit:"-labeled comment that actually asks for real engineering work (extract a function, add tests) is unblocking, not nitpick — judge by scope, not the label.
- unblocking: a concrete next step in prose, for an issue NOT asserted as broken by this comment itself.
- question: MUST be grammatically interrogative ("?", or "why/how/is/are/does/can/isn't it"). A hedge ("I think...") without question form is NOT a question — judge by form, not tone.
- praise: approval or thanks, no code change requested. Only counts when said BY the reviewer — a pr-author's thanks in a reply does not count as praise.
- joke: humor or banter with no review substance, only when humor is the entire comment.
- unknown: CI/bot noise, merge/process logistics, or genuinely unclassifiable. Not for merely borderline cases — pick the closer real category instead.

## DOMAIN (what area the concern targets, independent of intent)

functional (correctness, bugs, security) | refactoring (code quality, no behavior change) | documentation (comments/docs/README) | discussion (questions, design, praise) | false-positive (concern conclusively withdrawn/refuted — only if the thread demonstrably shows this)

## SPECIAL CASES

- Bare "LGTM"/"+1"/"ditto"/"same here" with no elaboration, or a thumbs-up: {"intent":"praise","domain":"discussion"}
- Bot-generated noise (CI status, linter output, coverage report): {"intent":"unknown","domain":"functional"}

Output ONLY the raw JSON array, nothing else.`;

// Validated empirically: 4 threads/call balances call volume against output-concentration loss
// (larger batches measurably degraded accuracy). 3 independent repeats per batch + majority vote
// smooths per-call noise; ties or every-repeat failure fall back to "unknown" below.
const CLASSIFICATION_BATCH_INPUT_SIZE = 4;
const CLASSIFICATION_VOTE_REPEATS = 3;

// AI Gateway intermittently 504s on longer (multi-item-batch) completions — observed empirically
// to be transient backend congestion, not a deterministic failure.
const CLASSIFICATION_MAX_RETRY_ATTEMPTS = 5;
const CLASSIFICATION_RETRY_DELAY_MS = 1000;

// ai.run() has no built-in timeout — a hung Workers AI backend would otherwise block a batch
// until the Worker runtime's own (much longer) limit fires. Bounding it here lets the existing
// retry loop treat a hang the same as any other transient failure.
const CLASSIFICATION_AI_RUN_TIMEOUT_MS = 30_000;

const VALID_DOMAINS = new Set<TechnicalDomain>([
  "functional",
  "refactoring",
  "documentation",
  "discussion",
  "false-positive",
]);
function isValidDomain(value: string): value is TechnicalDomain {
  return VALID_DOMAINS.has(value as TechnicalDomain);
}

function majorityVote(votes: string[]): string {
  const counts = new Map<string, number>();
  for (const v of votes) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | undefined;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  // 2 of 3 votes agree -> use it. Otherwise (3-way tie, or every repeat failed) -> "unknown".
  return best !== undefined && bestCount >= 2 ? best : "unknown";
}

// Structural subset of the Workers AI `Ai` binding actually used here. Defined locally (instead
// of importing the ambient `Ai` type from @cloudflare/workers-types) so this module — and any
// test file importing it — never needs workers-types in scope. The real `env.AI` binding
// satisfies this shape structurally.
export interface AiBinding {
  run(model: string, inputs: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
}

export async function classifyThreads(
  ai: AiBinding,
  supabase: SupabaseClient,
  threadRootIds: number[],
): Promise<ClassificationResult[]> {
  if (threadRootIds.length === 0) return [];

  const commentColumns = "id,pull_request_id,in_reply_to_id,commenter_login,body,path,position_line,created_at";
  const [{ data: roots, error: rootsError }, { data: replyRows, error: repliesError }] = await Promise.all([
    supabase.from("github_review_comments").select(commentColumns).in("id", threadRootIds),
    supabase.from("github_review_comments").select(commentColumns).in("in_reply_to_id", threadRootIds),
  ]);
  if (rootsError) throw rootsError;
  if (repliesError) throw repliesError;

  const repliesByRoot = new Map<number, CommentRow[]>();
  for (const reply of replyRows as CommentRow[]) {
    if (reply.in_reply_to_id === null) continue;
    const bucket = repliesByRoot.get(reply.in_reply_to_id);
    if (bucket) bucket.push(reply);
    else repliesByRoot.set(reply.in_reply_to_id, [reply]);
  }

  const humanRoots = (roots as CommentRow[]).filter((root) => !isBotComment(root.commenter_login));
  if (humanRoots.length === 0) return [];

  const prIds = [...new Set(humanRoots.map((root) => root.pull_request_id))];
  const { data: prs, error: prsError } = await supabase
    .from("github_pull_requests")
    .select("id,title,author_login")
    .in("id", prIds);
  if (prsError) throw prsError;
  const prMetaMap = new Map((prs as PrRow[]).map((pr) => [pr.id, { title: pr.title, authorLogin: pr.author_login }]));

  const pullRequestIdByThreadId = new Map<number, number>();
  const payloads: ThreadPayload[] = [];
  for (const root of humanRoots) {
    const prMeta = prMetaMap.get(root.pull_request_id);
    if (!prMeta) continue;

    const humanReplies = (repliesByRoot.get(root.id) ?? []).filter((reply) => !isBotComment(reply.commenter_login));
    // Diff hunks are not stored in the DB (Open Risk #2) — v1 classifies from comment text + PR metadata alone.
    payloads.push(assembleThreadPayload(root, humanReplies, prMeta, null));
    pullRequestIdByThreadId.set(root.id, root.pull_request_id);
  }

  const results: ClassificationResult[] = [];
  for (let i = 0; i < payloads.length; i += CLASSIFICATION_BATCH_INPUT_SIZE) {
    const batch = payloads.slice(i, i + CLASSIFICATION_BATCH_INPUT_SIZE);
    const votesByThreadId = await classifyBatch(ai, batch);
    for (const [threadId, vote] of votesByThreadId) {
      const pullRequestId = pullRequestIdByThreadId.get(threadId);
      if (pullRequestId === undefined) continue;
      results.push({
        thread_root_comment_id: threadId,
        pull_request_id: pullRequestId,
        intent: vote.intent,
        domain: vote.domain,
        model_id: CLASSIFICATION_MODEL,
      });
    }
  }

  return results;
}

async function callClassificationBatch(
  ai: AiBinding,
  batch: ThreadPayload[],
): Promise<Map<number, ClassificationItem>> {
  const aiResult = await Promise.race([
    ai.run(
      CLASSIFICATION_MODEL,
      {
        messages: [
          { role: "system", content: CLASSIFICATION_SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(batch) },
        ],
        response_format: { type: "json_object" },
      },
      { gateway: { id: "default", collectLog: true } },
    ),
    new Promise<never>((_, reject) =>
      setTimeout(() => {
        reject(new Error("Workers AI call timed out"));
      }, CLASSIFICATION_AI_RUN_TIMEOUT_MS),
    ),
  ]);

  const rawText =
    typeof aiResult === "string"
      ? aiResult
      : typeof aiResult === "object" &&
          aiResult !== null &&
          "response" in aiResult &&
          typeof aiResult.response === "string"
        ? aiResult.response
        : undefined;
  if (!rawText) throw new Error("Workers AI response did not include text output");

  const parsedArray: unknown = JSON.parse(extractJsonArray(rawText));
  if (!Array.isArray(parsedArray)) throw new Error("Workers AI response was not a JSON array");

  // Per-item validation: one malformed item degrades only that thread's vote, not the whole
  // batch's retry — a single bad item shouldn't throw away 3 other valid classifications.
  const byThreadId = new Map<number, ClassificationItem>();
  for (const item of parsedArray) {
    const result = ClassificationItemSchema.safeParse(item);
    if (result.success) byThreadId.set(result.data.thread_id, result.data);
  }
  return byThreadId;
}

async function callClassificationBatchWithRetry(
  ai: AiBinding,
  batch: ThreadPayload[],
): Promise<Map<number, ClassificationItem>> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= CLASSIFICATION_MAX_RETRY_ATTEMPTS; attempt++) {
    try {
      return await callClassificationBatch(ai, batch);
    } catch (err) {
      lastError = err;
      if (attempt < CLASSIFICATION_MAX_RETRY_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, CLASSIFICATION_RETRY_DELAY_MS));
      }
    }
  }
  // Exhausted retries (e.g. repeated AI Gateway 504s) — this repeat contributes no votes; the
  // other repeats (and majorityVote's "unknown" fallback) absorb the loss.
  const threadIds = batch.map((p) => p.thread_id).join(",");
  logger.warn(
    `[classification] Batch call failed after ${CLASSIFICATION_MAX_RETRY_ATTEMPTS} attempts for threads ${threadIds}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
  return new Map();
}

async function classifyBatch(
  ai: AiBinding,
  batch: ThreadPayload[],
): Promise<Map<number, { intent: IntentCategory; domain: TechnicalDomain }>> {
  const repeats = await Promise.all(
    Array.from({ length: CLASSIFICATION_VOTE_REPEATS }, () => callClassificationBatchWithRetry(ai, batch)),
  );

  const result = new Map<number, { intent: IntentCategory; domain: TechnicalDomain }>();
  for (const payload of batch) {
    const intentVotes = repeats.map((r) => r.get(payload.thread_id)?.intent ?? "unknown");
    const domainVotes = repeats.map((r) => r.get(payload.thread_id)?.domain ?? "unknown");

    const intent = majorityVote(intentVotes) as IntentCategory;
    const domain = majorityVote(domainVotes);

    if (!isValidDomain(domain)) {
      // Majority vote can land on "unknown" for domain (3-way tie, or every repeat failed) but
      // "unknown" is not a valid TechnicalDomain — there's no row to store this thread under.
      // Skip it; get_unclassified_root_comments_for_board offers it again on the next run.
      logger.warn(
        `[classification] No valid domain majority for thread ${payload.thread_id} (votes: ${domainVotes.join(",")})`,
      );
      continue;
    }
    result.set(payload.thread_id, { intent, domain });
  }
  return result;
}
