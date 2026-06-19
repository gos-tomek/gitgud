import { z } from "zod";
import type { createClient } from "@/lib/supabase";
import type { IntentCategory, TechnicalDomain, KnowledgeDirection } from "@/types";
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
    prTitle: prMeta.title,
    isInline: rootComment.path !== null,
    path: rootComment.path,
    diffHunk,
    comments: ordered.map((c) => ({ role: roleFor(c.commenter_login), body: c.body })),
  };
}

const ClassificationOutputSchema = z.object({
  intent: z.enum(["mentoring", "architecture", "bug-catch", "nitpick", "unblocking", "question"]),
  domain: z.enum(["functional", "refactoring", "documentation", "discussion", "false-positive"]),
  constructive: z.boolean(),
  knowledge_direction: z.enum(["mentoring-down", "peer-exchange", "challenge-up", "self-clarification"]),
  confidence: z.number().min(0).max(1),
});

export type ClassificationOutput = z.infer<typeof ClassificationOutputSchema>;

export function parseClassificationOutput(raw: unknown): ClassificationOutput {
  return ClassificationOutputSchema.parse(raw);
}

// Some Workers AI models wrap JSON output in markdown code fences (```json ... ```) despite
// response_format: json_object. Slice out the {...} body before JSON.parse.
export function extractJsonObject(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return text;
  return text.slice(start, end + 1);
}

export interface ClassificationResult {
  thread_root_comment_id: number;
  pull_request_id: number;
  intent: IntentCategory;
  domain: TechnicalDomain;
  constructive: boolean;
  knowledge_direction: KnowledgeDirection;
  confidence: number;
  model_id: string;
}

export const CLASSIFICATION_SYSTEM_PROMPT = `You classify code review discussion threads from GitHub pull requests.

You will receive a JSON payload describing one thread: the PR title, whether the thread is anchored to a specific line of code (inline) or general, the file path and diff hunk (if inline), and the thread's comments in chronological order with author roles (pr-author, reviewer, other).

Classify the THREAD as a whole — not individual comments — on 4 independent axes. If the thread evolves (e.g. starts as a question, becomes a bug report), classify by the DOMINANT intent that drove the discussion. Return JSON only, matching this exact schema:

{
  "intent": "mentoring" | "architecture" | "bug-catch" | "nitpick" | "unblocking" | "question",
  "domain": "functional" | "refactoring" | "documentation" | "discussion" | "false-positive",
  "constructive": true | false,
  "knowledge_direction": "mentoring-down" | "peer-exchange" | "challenge-up" | "self-clarification",
  "confidence": 0.0-1.0
}

## Intent (pick the single best fit)

- mentoring: The reviewer is teaching, explaining a concept, sharing institutional knowledge, or explaining WHY a pattern exists, aimed at the PR author's growth. e.g. "in our codebase we do X because…", explanations of design patterns with rationale.
- architecture: The reviewer proposes changes to system structure, component boundaries, API surface, data flow, or design patterns. Addresses HOW the system is organized, not a specific bug or style issue. e.g. "this should be extracted to a separate service", "consider the strategy pattern here".
- bug-catch: The reviewer identifies a concrete defect, logic error, missing edge case, race condition, or security issue — they ASSERT something is wrong or will break. e.g. "this will NPE when input is null", "this SQL is injectable".
- nitpick: Style, formatting, naming, import ordering, or trivial cleanliness issues that don't affect behavior. The code would pass all tests identically either way. e.g. "nit: rename to camelCase".
- unblocking: A concrete, actionable solution to move the PR forward right now — a code suggestion or specific fix. Purpose is to resolve the issue NOW, not to teach or critique. e.g. inline code suggestions, "you can fix this by…".
- question: A genuine question seeking to understand the author's reasoning or clarify an ambiguous choice. Does NOT assert a defect. e.g. "why did you choose X over Y?", "is this intentional?".

Disambiguation:
- mentoring vs architecture: would this comment exist if the PR author were a principal engineer? Yes -> architecture. No (exists because the author is learning) -> mentoring.
- bug-catch vs question: does the comment assert something is wrong? -> bug-catch. Does it seek to understand? -> question.
- unblocking vs mentoring: does it contain a concrete code change or specific next step? -> unblocking. Does it explain a principle? -> mentoring.
- nitpick vs architecture: would the code pass all tests identically regardless of approach? -> nitpick. Would it change how components interact? -> architecture.

## Domain (top-level category only)

- functional: bugs, logic errors, resource management, timing/concurrency, interface/API misuse, input validation, security. Concern is CORRECTNESS.
- refactoring: alternative implementations, naming, structure, formatting. Concern is CODE QUALITY without changing behavior.
- documentation: inline comments, docstrings, README, changelog. Concern is whether the code is EXPLAINED.
- discussion: questions, design deliberation, praise, high-level architectural debate. Concern is UNDERSTANDING and DECISION-MAKING.
- false-positive: the reviewer's concern was conclusively refuted by another participant with evidence, and the reviewer withdrew or was overruled. Only use when the thread demonstrably shows this; otherwise classify by the reviewer's original intent.

## Constructive (boolean)

- true: the comment provides at least one of: concrete evidence of a problem, an alternative approach or code suggestion, or an actionable next step. It moves the PR forward.
- false: the comment raises an objection WITHOUT evidence, alternative, or actionable direction — vague criticism, unfounded concerns, or repetition of points already made. Note: praise ("great approach!") is non-constructive by this definition but is NOT harmful — non-constructive does not mean negative.

## Knowledge direction (experimental — best-effort from linguistic signals only, never infer from usernames or metadata)

- mentoring-down: a more experienced participant teaches or guides the other. Explanatory tone, references to past decisions, longer explanations of concepts the author likely doesn't know.
- peer-exchange: both participants appear to have similar expertise. Balanced discussion, collaborative problem-solving.
- challenge-up: a participant questions or proposes an alternative to an established decision or pattern. "Have we considered…?", disagreement with the status quo.
- self-clarification: the reviewer asks for their own understanding, not teaching or challenging. Genuine uncertainty, no position yet formed.

## Confidence

Reflects YOUR certainty about the intent classification specifically (not the other axes). 0.0 = pure guess, 1.0 = unambiguous.

## Special case

If the thread is a single "LGTM" or approval with no substantive content, classify as intent:"nitpick", domain:"discussion", constructive:false, knowledge_direction:"peer-exchange", confidence:0.9.`;

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

  const results: ClassificationResult[] = [];
  for (const root of humanRoots) {
    const prMeta = prMetaMap.get(root.pull_request_id);
    if (!prMeta) continue;

    const humanReplies = (repliesByRoot.get(root.id) ?? []).filter((reply) => !isBotComment(reply.commenter_login));
    // Diff hunks are not stored in the DB (Open Risk #2) — v1 classifies from comment text + PR metadata alone.
    const payload = assembleThreadPayload(root, humanReplies, prMeta, null);

    try {
      const aiResult = await ai.run(
        CLASSIFICATION_MODEL,
        {
          messages: [
            { role: "system", content: CLASSIFICATION_SYSTEM_PROMPT },
            { role: "user", content: JSON.stringify(payload) },
          ],
          response_format: { type: "json_object" },
        },
        { gateway: { id: "default", collectLog: true } },
      );

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

      const parsed = parseClassificationOutput(JSON.parse(extractJsonObject(rawText)));

      results.push({
        thread_root_comment_id: root.id,
        pull_request_id: root.pull_request_id,
        intent: parsed.intent,
        domain: parsed.domain,
        constructive: parsed.constructive,
        knowledge_direction: parsed.knowledge_direction,
        confidence: parsed.confidence,
        model_id: CLASSIFICATION_MODEL,
      });
    } catch (err) {
      logger.warn(
        `[classification] Failed to classify thread ${root.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return results;
}
