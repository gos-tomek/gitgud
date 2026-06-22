# Classification Batch — Implementation Plan

## Overview

Build F-03: a daily durable Cloudflare Workflow that incrementally syncs GitHub data (PRs, reviews, comments) for all active boards and classifies each review thread via Workers AI into 5 fields (intent, domain, constructiveness, knowledge direction, confidence). This replaces the current in-request sync (`POST /api/github/sync`) with a Cron-triggered pipeline that lifts the 200 PR cap via durable execution and adds AI classification as a post-sync step.

## Current State Analysis

The codebase has a working GitHub sync service (`src/lib/services/github-sync.ts`) that runs inside an API request handler, capped at 200 PRs per repo to avoid Worker timeouts. Review comments are stored verbatim in `github_review_comments.body`. Thread grouping uses `COALESCE(in_reply_to_id, id)` in `computeThreadMetrics()` (`impact-metrics.ts:498`). The `ThreadQualitySection` UI has a dormant `categoryBreakdown` slot on `MetricCard` — ready for classification data but never populated.

Zero Cloudflare Workflow, Cron Trigger, or AI binding infrastructure exists. `wrangler.jsonc` has only an `ASSETS` binding. The project uses `astro:env/server` for secrets; Workers AI requires the separate `cloudflare:workers` import pattern.

### Key Discoveries:

- `wrangler.jsonc:4` — entrypoint is `@astrojs/cloudflare/entrypoints/server`. Must switch to a custom `src/worker.ts` that re-exports Astro's `handle` alongside the Workflow class.
- `@astrojs/cloudflare` v13+ exposes `@astrojs/cloudflare/handler` with a `handle(request, env, ctx)` function — the official bridge for custom entrypoints.
- `src/lib/github.ts:4` — imports `GITHUB_TOKEN_ENCRYPTION_KEY` from `astro:env/server`. The Workflow runs outside Astro's request context, so it needs this secret from `this.env` (Worker binding) instead.
- `src/lib/services/github-sync.ts:7` — `MAX_PRS_PER_REPO = 200` with comment "F-03 (Workflows) will lift this cap".
- `supabase/migrations/20260531100000_github_ingestion_access.sql:92` — `get_board_id_for_pr()` helper already exists for RLS on review-related tables. Reusable for `thread_classifications`.
- Research settled the model: Workers AI Llama 3.3-70B fp8-fast, ~$0.74/month for active boards, all on user's own Cloudflare bill.

## Desired End State

A daily Cron Trigger fires a dispatcher that spawns one `ClassificationBatchWorkflow` per active board. Each Workflow instance:

1. Incrementally syncs GitHub data (PRs, reviews, comments) with no PR cap
2. Identifies unclassified root comment threads
3. Classifies each thread via Workers AI (Llama 3.3-70B fp8-fast) through AI Gateway
4. Stores 5 fields per thread in `thread_classifications`

The manual sync endpoint (`POST /api/github/sync`) triggers the same Workflow instead of running sync in-request. Bot comments are pre-filtered before classification. Knowledge direction is stored but not surfaced in UI (experimental). UI wiring is a follow-up change.

**Verification**: After the daily Cron fires, `thread_classifications` contains rows for all non-bot root comment threads, each with a valid intent/domain/constructive/knowledge_direction/confidence value. `wrangler tail` shows Workflow step logs. AI Gateway dashboard shows classification requests with caching and cost metrics.

## What We're NOT Doing

- UI integration (wiring `categoryBreakdown` into `ThreadQualitySection`) — follow-up change
- BYOK or external model providers — Workers AI on user's CF account is the sole classifier
- Full 17-subcategory Turzo & Bosu taxonomy — top-5 groups only
- Çağlar comment smell detection — empirically too inaccurate (F1 0.36-0.37)
- Thread resolution metadata extraction — already partially available via `github_reviews.state`; full extraction deferred
- Composite metrics (Feedback Quality ratio, CRQS, Noise ratio) — computed post-classification in a follow-up
- FR-013 (user correction flags) — dependency-constrained, ships only when correction pipeline exists
- AI Gateway Unified Billing or external provider fallback — unnecessary for self-hosted model

## Implementation Approach

Custom entrypoint (`src/worker.ts`) re-exports Astro's fetch handler alongside the Workflow class. The Workflow uses durable steps for fault tolerance: each PR sync and each thread classification is an independent step with retries. The classification service assembles thread payloads (root comment + replies + diff hunk + PR metadata), pre-filters bot comments, and calls Workers AI with a structured JSON output schema. AI Gateway provides caching (system prompt cached across threads in a batch) and analytics.

The sync logic is extracted from `github-sync.ts` into a reusable module that both the Workflow and any future callers can use. The Workflow passes Supabase credentials and encryption key from Worker bindings (`this.env`), not from `astro:env/server`.

## Critical Implementation Details

### Timing & lifecycle

The Workflow runs outside Astro's request lifecycle. It cannot use `astro:env/server` imports — it accesses secrets via `this.env` (Worker bindings declared in `wrangler.jsonc`). The `createGitHubClient` function in `src/lib/github.ts` currently imports `GITHUB_TOKEN_ENCRYPTION_KEY` from `astro:env/server` at module scope. The Workflow needs a parallel code path that accepts the encryption key as a parameter. This is the most load-bearing refactor in the plan — getting it wrong means the Workflow can't decrypt PATs.

### State sequencing

The sync step MUST complete before the classification step starts — classification queries for unclassified root comments, which include the comments just synced. Within classification, each thread is an independent durable step, so partial failures don't block other threads. The order of thread classification within a batch does not matter.

---

## Phase 1: Infrastructure & Custom Entrypoint

### Overview

Establish the Cloudflare Workflow + Workers AI + Cron Trigger infrastructure. Switch from the Astro adapter's built-in entrypoint to a custom `src/worker.ts` that exports both the Astro fetch handler and the Workflow class. Verify local dev and build still work.

### Changes Required:

#### 1. Custom Worker entrypoint

**File**: `src/worker.ts` (new)

**Intent**: Create the custom entrypoint that bridges Astro's fetch handler with the Workflow class export. Cloudflare requires Workflow classes to be named exports from the main module.

**Contract**: Default export has a `fetch` method calling `handle` from `@astrojs/cloudflare/handler`, plus a `scheduled` method for the Cron dispatcher. Named export `ClassificationBatchWorkflow` extends `WorkflowEntrypoint`. The Workflow class is a skeleton in this phase — full implementation in Phase 4.

#### 2. Wrangler configuration

**File**: `wrangler.jsonc`

**Intent**: Point the main entrypoint to `src/worker.ts`, add AI binding, Workflow binding, and Cron Trigger.

**Contract**:

- `"main"` changes from `"@astrojs/cloudflare/entrypoints/server"` to `"./src/worker.ts"`
- Add `"ai": { "binding": "AI" }`
- Add `"workflows": [{ "name": "classification-batch", "binding": "CLASSIFICATION_BATCH", "class_name": "ClassificationBatchWorkflow" }]`
- Add `"triggers": { "crons": ["0 3 * * *"] }` (daily at 03:00 UTC)

#### 3. Worker types

**File**: `package.json`

**Intent**: Install `@cloudflare/workers-types` for TypeScript support for `WorkflowEntrypoint`, `WorkflowStep`, `Ai` binding, etc.

**Contract**: Add `@cloudflare/workers-types` as devDependency. The `Env` type for the Worker is defined in `src/worker.ts` (or a shared `src/env.d.ts` update) including `AI`, `CLASSIFICATION_BATCH`, `SUPABASE_URL`, `SUPABASE_KEY`, `GITHUB_TOKEN_ENCRYPTION_KEY`.

#### 4. TypeScript configuration

**File**: `tsconfig.json`

**Intent**: Add `@cloudflare/workers-types` to the compiler's type roots so `WorkflowEntrypoint`, `Ai`, etc. are recognized.

**Contract**: Add `@cloudflare/workers-types` to `compilerOptions.types` array (or equivalent). Ensure it coexists with Astro's existing types.

### Success Criteria:

#### Automated Verification:

- `npm run build` succeeds with the new entrypoint
- `npm run dev` starts correctly (workerd runtime, Astro pages still serve)
- Type checking passes: `npx tsc --noEmit`
- `npx wrangler deploy --dry-run` succeeds (validates wrangler.jsonc bindings)

#### Manual Verification:

- Visit a page in the running dev server — Astro SSR still works
- `wrangler tail` (after deploy) shows the Cron Trigger firing at the scheduled time

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Database Schema

### Overview

Create the `thread_classifications` table to store per-thread classification results. Each row represents one classified root comment thread with 5 output fields from the LLM plus metadata. RLS follows the established pattern using `get_board_id_for_pr`.

### Changes Required:

#### 1. Migration file

**File**: `supabase/migrations/20260618120000_thread_classifications.sql` (new)

**Intent**: Create the classification storage table with RLS policies that mirror the existing `github_review_comments` access pattern.

**Contract**:

- Table `thread_classifications` with columns:
  - `thread_root_comment_id bigint PRIMARY KEY` — FK to `github_review_comments(id) ON DELETE CASCADE`. One classification per root comment thread.
  - `intent text NOT NULL` — CHECK constraint: `intent IN ('mentoring', 'architecture', 'bug-catch', 'nitpick', 'unblocking', 'question')`
  - `domain text NOT NULL` — CHECK constraint: `domain IN ('functional', 'refactoring', 'documentation', 'discussion', 'false-positive')`
  - `constructive boolean NOT NULL`
  - `knowledge_direction text NOT NULL` — CHECK constraint: `knowledge_direction IN ('mentoring-down', 'peer-exchange', 'challenge-up', 'self-clarification')`
  - `confidence real NOT NULL` — CHECK constraint: `confidence BETWEEN 0.0 AND 1.0`
  - `model_id text NOT NULL` — e.g. `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
  - `classified_at timestamptz NOT NULL DEFAULT now()`
  - `pull_request_id bigint NOT NULL` — FK to `github_pull_requests(id) ON DELETE CASCADE`. Denormalized for efficient per-board queries (avoids join through comments for RLS and aggregation).
- `REVOKE ALL ON thread_classifications FROM anon, authenticated;` before RLS policies (per lessons.md)
- RLS policies using `get_board_id_for_pr(pull_request_id)`:
  - SELECT: `is_board_member(get_board_id_for_pr(pull_request_id))`
  - INSERT/UPDATE/DELETE: `is_board_owner(get_board_id_for_pr(pull_request_id))`
- Index on `(pull_request_id)` for efficient per-PR/per-board aggregation

#### 2. TypeScript types

**File**: `src/types.ts`

**Intent**: Add the `ThreadClassification` type and the enum literal types for the 4 classification axes.

**Contract**:

- `IntentCategory` type: `"mentoring" | "architecture" | "bug-catch" | "nitpick" | "unblocking" | "question"`
- `TechnicalDomain` type: `"functional" | "refactoring" | "documentation" | "discussion" | "false-positive"`
- `KnowledgeDirection` type: `"mentoring-down" | "peer-exchange" | "challenge-up" | "self-clarification"`
- `ThreadClassification` interface with all DB columns mapped to camelCase

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db reset` (local)
- Type checking passes: `npx tsc --noEmit`
- No lint errors: `npm run lint`

#### Manual Verification:

- Query `thread_classifications` in Supabase Studio — table exists with correct columns and constraints
- RLS test: authenticated non-member cannot SELECT rows

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Classification Service

### Overview

Build the classification service that assembles thread payloads, pre-filters bot comments, calls Workers AI via AI Gateway, and parses structured JSON responses. This is a pure library module — it doesn't know about Workflows or Cron.

### Changes Required:

#### 1. Classification service module

**File**: `src/lib/services/classification.ts` (new)

**Intent**: Encapsulate thread classification logic: payload assembly, bot filtering, LLM call, response parsing. Accepts an `Ai` binding and Supabase client as dependencies (no global imports of `astro:env`).

**Contract**:

- `classifyThreads(ai: Ai, supabase: SupabaseClient, threadRootIds: number[]): Promise<ClassificationResult[]>` — main entry point
- `assembleThreadPayload(rootComment: CommentDb, replies: CommentDb[], prMeta: PrMeta, diffHunk: string | null): ThreadPayload` — builds the LLM input for one thread
- `isBotComment(login: string): boolean` — heuristic bot detection: checks for `[bot]` suffix, `-bot` suffix, known bot logins (dependabot, renovate, codecov, etc.)
- `CLASSIFICATION_SYSTEM_PROMPT: string` — the system prompt constant with 4-axis definitions from research §C–F
- `CLASSIFICATION_MODEL: string` — `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
- Thread grouping reuses the `COALESCE(in_reply_to_id, id)` pattern from `computeThreadMetrics`
- Output parsed from `response_format: { type: "json_object" }` with zod validation against the 5-field schema
- Diff hunk: query `github_review_comments.path` + `position_line` for inline threads; pass `null` for general threads. The diff hunk itself is NOT stored in the DB — it must be fetched from the PR diff at classification time (or omitted in v1 if fetching is too complex).

#### 2. System prompt

**Intent**: Define the classification prompt with crisp category definitions, disambiguation rules, and structured output format. Content is specified in research §C–F.

**Contract**: The prompt follows the structure from research §G (flat single-call, multi-axis output). Key rules:

- Classify the THREAD as a whole, not individual comments
- If thread evolves, classify by DOMINANT intent
- `false-positive` domain only when reviewer's concern was conclusively refuted
- Confidence reflects certainty about intent specifically
- LGTM/approval-only threads: intent=nitpick, domain=discussion, constructive=false, direction=peer-exchange, confidence=0.9
- Output JSON schema: `{ intent, domain, constructive, knowledge_direction, confidence }`

#### 3. AI Gateway configuration

**Intent**: Route Workers AI calls through AI Gateway for caching and analytics.

**Contract**: Pass `gateway: { id: "gitgud-classification", collectLog: true, metadata: { board_id: "..." } }` as the third argument to `env.AI.run()`. The gateway ID is created on first request. System prompt caching reduces per-thread cost by ~43% (research finding).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- Lint passes: `npm run lint`
- Unit tests for `isBotComment()` cover: `dependabot[bot]`, `renovate[bot]`, `codecov-bot`, regular users, edge cases (`botuser`, `robot`)
- Unit tests for `assembleThreadPayload()` verify correct payload shape
- Unit tests for response parsing verify zod validation rejects malformed JSON

#### Manual Verification:

- Call `classifyThreads()` with a small batch of real comment IDs against Workers AI — verify JSON responses parse correctly and categories look reasonable

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Workflow Implementation

### Overview

Implement the full `ClassificationBatchWorkflow` with durable steps: sync GitHub data per board, then classify unclassified threads. The `scheduled` handler dispatches one Workflow instance per active board.

### Changes Required:

#### 1. Refactor GitHub client for Workflow context

**File**: `src/lib/github.ts`

**Intent**: Allow `createGitHubClient` to accept the encryption key as a parameter instead of always importing from `astro:env/server`. The Workflow runs outside Astro's request context and cannot use `astro:env` imports.

**Contract**: Add an overload or optional parameter: `createGitHubClient(supabase, boardId, encryptionKey?: string)`. When `encryptionKey` is provided, use it directly. When omitted, fall back to `GITHUB_TOKEN_ENCRYPTION_KEY` from `astro:env/server` (preserving backward compatibility for API routes).

#### 2. Refactor sync service for Workflow context

**File**: `src/lib/services/github-sync.ts`

**Intent**: Allow `syncBoardGitHubData` to accept an Octokit instance as a parameter instead of creating one internally (which requires `astro:env`). Also remove the 200 PR cap when called from the Workflow.

**Contract**: Add optional parameter for Octokit: `syncBoardGitHubData(supabase, boardId, options?: { since?: Date; octokit?: Octokit; maxPrsPerRepo?: number })`. When `octokit` is provided, skip internal `createGitHubClient` call. When `maxPrsPerRepo` is provided, use it instead of the 200 default. Existing API callers continue to work without changes.

#### 3. Workflow class implementation

**File**: `src/worker.ts` (expand skeleton from Phase 1)

**Intent**: Implement the full Workflow: sync step → identify unclassified threads → classify in batches → store results.

**Contract**: The Workflow receives `{ boardId: string }` as params. Steps:

1. `sync-github-data` — Create Supabase admin client from `this.env.SUPABASE_URL` + `this.env.SUPABASE_KEY`. Create Octokit via refactored `createGitHubClient` with `this.env.GITHUB_TOKEN_ENCRYPTION_KEY`. Call `syncBoardGitHubData` with no PR cap. Durable step with retries.
2. `fetch-unclassified` — Query root comments (`in_reply_to_id IS NULL`) that have no row in `thread_classifications`. Filter out bot comments via `isBotComment()`. Return list of thread root IDs.
3. `classify-batch-N` — For each batch of threads (batch size ~50), call `classifyThreads()`. Each batch is a durable step with retries. This groups classification into manageable steps rather than one step per thread (reduces Workflow step overhead) while keeping each step small enough to retry.
4. `store-results` — Upsert classification results into `thread_classifications`. Durable step.

#### 4. Scheduled handler (Cron dispatcher)

**File**: `src/worker.ts`

**Intent**: The `scheduled` handler fires on the daily Cron Trigger, queries all active boards, and dispatches a Workflow instance per board.

**Contract**: In the default export's `scheduled` method:

1. Create Supabase client from `env.SUPABASE_URL` + `env.SUPABASE_KEY`
2. Query all boards that have at least one `github_repos` row (active boards)
3. For each board, call `env.CLASSIFICATION_BATCH.create({ params: { boardId: board.id } })` with a deterministic ID (e.g., `board-${boardId}-${dateString}`) for deduplication

#### 5. Supabase client for Workflow context

**File**: `src/lib/supabase.ts` (or new `src/lib/supabase-admin.ts`)

**Intent**: The existing `createClient` requires request headers + cookies (it creates an SSR client). The Workflow needs a service-role client that doesn't depend on a user session.

**Contract**: New function `createServiceClient(url: string, key: string): SupabaseClient` that creates a Supabase client with the service role key. The Workflow uses `this.env.SUPABASE_URL` and `this.env.SUPABASE_KEY` — note: the existing `SUPABASE_KEY` in the codebase is the **anon** key (used with RLS). The Workflow may need the **service role** key to bypass RLS for inserting classifications. If so, add `SUPABASE_SERVICE_KEY` as a new Worker secret.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit` and `npm run test:typecheck`
- Lint passes: `npm run lint`
- Build succeeds: `npm run build`
- Dry-run deploy succeeds: `npx wrangler deploy --dry-run`
- Existing API routes still work: `npm test` (non-integration tests pass)

#### Manual Verification:

- Trigger the Workflow manually via `wrangler workflows trigger classification-batch --params '{"boardId":"..."}'` — verify sync completes and classifications appear in DB
- Check `wrangler workflows instances list classification-batch` — verify instance completed successfully
- Check AI Gateway dashboard — verify classification requests logged with correct metadata
- Verify existing `POST /api/github/sync` still works (not yet refactored, but underlying functions unchanged)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: API Integration

### Overview

Refactor the manual sync endpoint to trigger the Workflow instead of running sync in-request. Handle deduplication for concurrent triggers.

### Changes Required:

#### 1. Refactor sync API route

**File**: `src/pages/api/github/sync.ts`

**Intent**: Replace direct `syncBoardGitHubData()` call with Workflow dispatch. The EM triggers a sync from the UI; it now kicks off the full sync+classify pipeline via the Workflow.

**Contract**: Instead of awaiting `syncBoardGitHubData`, call `env.CLASSIFICATION_BATCH.create(...)` with a deterministic ID for dedup. Access the Workflow binding via `context.locals.runtime.env.CLASSIFICATION_BATCH` (requires `getRuntime` from `@astrojs/cloudflare`). Return the Workflow instance ID so the client can poll status. Response changes from `SyncResult` to `{ instanceId: string; status: "queued" }`.

#### 2. Runtime environment access

**File**: `src/env.d.ts` (or equivalent Astro type extension)

**Intent**: Extend `Astro.locals` (or use `getRuntime`) to provide access to Cloudflare Worker bindings from Astro routes.

**Contract**: API routes that need Worker bindings (Workflow trigger, potentially AI in the future) access them via `getRuntime(Astro).env`. The `Env` type is shared with `src/worker.ts`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- Lint passes: `npm run lint`
- Build succeeds: `npm run build`
- Existing tests pass: `npm test`

#### Manual Verification:

- Trigger sync from the UI (or via curl to `POST /api/github/sync`) — verify it returns quickly with a Workflow instance ID
- Check `wrangler workflows instances list` — verify the instance was created
- Trigger sync twice rapidly — verify dedup prevents duplicate Workflow instances
- After Workflow completes, verify fresh classifications appear in the DB

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `isBotComment()`: known bots (dependabot[bot], renovate[bot], codecov-bot), regular users, edge cases (user named "botuser", user named "robot")
- `assembleThreadPayload()`: correct shape for inline thread (with path/line), general thread (no path), single-comment thread, multi-reply thread
- Response parsing: valid JSON → correct type, malformed JSON → error, missing fields → error, out-of-range confidence → error, invalid enum value → error
- Bot filtering integration: given a list of comments, verify bot comments are excluded and human comments are retained

### Integration Tests:

- Full classification pipeline: seed comments → run `classifyThreads()` against Workers AI → verify stored results have valid enum values and confidence in range
- Workflow end-to-end: trigger Workflow for a board with seeded GitHub data → verify sync runs and classifications are stored
- Backfill: board with pre-existing unclassified threads → first Workflow run classifies all of them

### Manual Testing Steps:

1. Deploy to Cloudflare, wait for Cron Trigger to fire — verify Workflow runs unattended
2. Check AI Gateway dashboard for classification requests and caching behavior
3. Trigger manual sync via API — verify Workflow dispatches and dedup works
4. Verify existing contribution profile pages still load (no regression from entrypoint change)
5. Query `thread_classifications` — spot-check that intent labels make sense for known threads

## Performance Considerations

- **Batch size**: Classify ~50 threads per durable step. Too few = excessive step overhead. Too many = long step duration (risk of timeout, though Workflows have generous limits).
- **AI Gateway caching**: The 800-token system prompt is cached after the first call in each batch run, reducing per-thread cost by ~43%.
- **Free tier**: Small boards (<500 threads/month) likely fit within Cloudflare's 10,000 Neurons/day free tier — $0 AI cost.
- **Backfill**: Even 1 year of history on an active board costs <$9 on the 70B model. No special backfill budgeting needed.
- **Sync optimization**: The `since` parameter on `syncBoardGitHubData` enables incremental sync — only PRs updated since the last run are fetched. The Workflow should store the last sync timestamp (e.g., in the Workflow params or a DB column on `boards`).

## Migration Notes

- The `thread_classifications` table is purely additive — no existing tables are modified.
- The custom entrypoint (`src/worker.ts`) replaces the default Astro adapter entrypoint but preserves all existing behavior via `handle` re-export.
- The `createGitHubClient` refactor adds an optional parameter — existing callers are unaffected.
- The sync service refactor adds optional parameters — existing callers are unaffected.
- `POST /api/github/sync` response shape changes from `SyncResult` to `{ instanceId, status }` — any client-side code consuming the response must be updated. Check `src/components/` for sync trigger usage.

## Open Risks & Assumptions

1. **Workers AI classification quality is unvalidated**. Llama 3.3-70B fp8-fast may not distinguish the 6 intent categories accurately enough. If accuracy is <85% agreement with human labels, consider upgrading the prompt or falling back to a different Workers AI model. This is the single highest risk.
2. **Diff hunk availability at classification time**. The diff hunk is not stored in the DB — only `path` and `position_line`. Fetching the diff from GitHub at classification time adds API calls and complexity. V1 may omit diff hunks and classify from comment text + PR metadata alone, at the cost of some accuracy on inline threads.
3. **Service role key requirement**. The Workflow may need `SUPABASE_SERVICE_KEY` (service role, bypasses RLS) to insert classifications, since it doesn't run as an authenticated user. This is a new secret to manage.
4. **`astro:env` vs `cloudflare:workers` coexistence**. Both import patterns must work in the same codebase. The Workflow code path must never import from `astro:env/server`; the Astro route code path continues to use it. Mixing them in the same module will fail.
5. **Knowledge direction accuracy**. This axis is experimental — LLM cannot reliably infer seniority. Data will be stored but not surfaced in UI until validated.
6. **DOM lib / `@cloudflare/workers-types` global type conflict (deferred)**. Root `tsconfig.json` loads `@cloudflare/workers-types` globally via `compilerOptions.types`, while TypeScript also defaults in the DOM lib (needed by client-side React components for `window`/`document`/`HTMLElement`). Both declare incompatible global `Response`/`Body` (and ~80 other) types; `skipLibCheck: true` hides the resulting duplicate-identifier conflict instead of resolving it — confirmed empirically: setting `skipLibCheck: false` surfaces ~869 errors project-wide. This causes a cold `tsc --noEmit` build and `typescript-eslint`'s `projectService` (incremental, tsserver-style resolution) to resolve `Response.json()`'s return type differently (`unknown` vs `any`), producing false-positive `@typescript-eslint/no-unnecessary-type-assertion` errors on `(await res.json()) as T` patterns in client components. Worked around with targeted `eslint-disable-next-line` comments in `src/components/CreateBoardForm.tsx` (pre-existing file, unrelated to this change) — removing the assertions instead breaks the authoritative `tsc` build with `TS18046`. Cloudflare's own templates exclude `"dom"` from `lib` when using `workers-types`, but that's not viable project-wide since client components genuinely need DOM types. The real fix requires splitting into two TypeScript programs (separate tsconfig for client vs. Worker-context files), touching `package.json` scripts, the CI `validate` job, and the Lefthook pre-commit hook — out of scope for this change. **Relevant to Phase 4/5**: today only `src/worker.ts` and `src/env.d.ts` reference Workers ambient globals; Phase 4 (Workflow steps) and Phase 5 (API route dispatching the Workflow via `env` bindings) will grow this footprint, making the tsconfig split increasingly worth revisiting. `skipLibCheck` stays `true` (unchanged) — flipping it blocks the entire build until the split is done.

## References

- Frame brief: `context/changes/classification-batch/frame.md`
- Research: `context/changes/classification-batch/research.md`
- Discovery (taxonomies): `context/changes/classification-batch/discovery/Research-CommentsTypes.md`
- Discovery (good code review): `context/changes/classification-batch/discovery/Research-GoodCodeReview.md`
- PRD: `context/foundation/prd.md` §Business Logic (line 172–178), FR-012 (line 144)
- Roadmap: `context/foundation/roadmap.md` F-03 (line 100–113)
- Infrastructure: `context/foundation/infrastructure.md` (Cloudflare Workflows + Cron Triggers)
- Lessons: `context/foundation/lessons.md` (REVOKE ALL before RLS, consola logger)
- Codebase: `src/lib/services/github-sync.ts` (sync service), `src/lib/services/impact-metrics.ts:498` (thread grouping), `src/types.ts` (types), `src/lib/github.ts` (PAT decryption), `wrangler.jsonc` (current config)
- Memory: `gitgud-ai-classification-approach.md` (Workers AI, self-hosted)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Infrastructure & Custom Entrypoint

#### Automated

- [x] 1.1 `npm run build` succeeds with new entrypoint — 63e0667
- [x] 1.2 `npm run dev` starts correctly — 63e0667
- [x] 1.3 Type checking passes: `npx tsc --noEmit` — 63e0667
- [x] 1.4 `npx wrangler deploy --dry-run` succeeds — 63e0667

#### Manual

- [x] 1.5 Astro SSR pages serve correctly in dev — 63e0667
- [ ] 1.6 Cron Trigger fires at scheduled time (after deploy)

### Phase 2: Database Schema

#### Automated

- [x] 2.1 Migration applies cleanly: `npx supabase db reset` — 817b8d1
- [x] 2.2 Type checking passes: `npx tsc --noEmit` — 817b8d1
- [x] 2.3 Lint passes: `npm run lint` — 817b8d1

#### Manual

- [x] 2.4 `thread_classifications` table visible in Supabase Studio with correct columns — 817b8d1
- [x] 2.5 RLS test: non-member cannot SELECT rows — 817b8d1

### Phase 3: Classification Service

#### Automated

- [x] 3.1 Type checking passes: `npx tsc --noEmit` — 187189a
- [x] 3.2 Lint passes: `npm run lint` — 187189a
- [x] 3.3 Unit tests pass for `isBotComment()` — 187189a
- [x] 3.4 Unit tests pass for `assembleThreadPayload()` — 187189a
- [x] 3.5 Unit tests pass for response parsing / zod validation — 187189a

#### Manual

- [x] 3.6 Test `classifyThreads()` against Workers AI with real comments — valid results returned — 187189a

### Phase 4: Workflow Implementation

#### Automated

- [x] 4.1 Type checking passes: `npx tsc --noEmit` and `npm run test:typecheck` — b5c186a
- [x] 4.2 Lint passes: `npm run lint` — b5c186a
- [x] 4.3 Build succeeds: `npm run build` — b5c186a
- [x] 4.4 Dry-run deploy succeeds: `npx wrangler deploy --dry-run` — b5c186a
- [x] 4.5 Existing tests pass: `npm test` — b5c186a

#### Manual

- [x] 4.6 Manual Workflow trigger: sync + classification completes for a test board — b5c186a
- [x] 4.7 Workflow instances list shows completed instance — b5c186a
- [x] 4.8 AI Gateway dashboard shows classification requests — b5c186a
- [x] 4.9 Existing sync endpoint still works — b5c186a

### Phase 5: API Integration

#### Automated

- [x] 5.1 Type checking passes: `npx tsc --noEmit`
- [x] 5.2 Lint passes: `npm run lint`
- [x] 5.3 Build succeeds: `npm run build`
- [x] 5.4 Existing tests pass: `npm test`

#### Manual

- [x] 5.5 Manual sync from UI/curl returns Workflow instance ID
- [x] 5.6 Workflow instance created on trigger
- [x] 5.7 Dedup prevents duplicate Workflow instances
- [x] 5.8 Classifications appear in DB after Workflow completes
