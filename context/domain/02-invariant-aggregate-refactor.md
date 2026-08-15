---
title: "Invariant-Aggregate Refactor: Contribution Profile Access Scope"
created: 2026-08-15
type: refactor-plan
invariant: contribution-profile-access-scope
status: plan
depends-on: 01-domain-distillation.md
terminology: 01-domain-distillation.md §1.1 Ubiquitous Language
---

# Invariant-Aggregate Refactor: Contribution Profile Access Scope

> Terminology follows the Ubiquitous Language established in `01-domain-distillation.md §1.1`:
> Supervisor (not EM), Contributor (not IC), Change Request (not Pull Request),
> Repository (not GitHub Repo), Contribution Profile, Thread, Thread Classification, Vote.

---

## STEP 0 — Context

### Domain

GitGud makes invisible engineering contributions visible — mentoring, code review quality, unblocking peers — through semantic classification of Review Comments from code reviews. The core flow: a **Supervisor** creates a **Board** → links **Repositories** → adds **Contributors** → the system syncs Change Requests / Reviews / Review Comments → classifies Threads → displays each Contributor's **Contribution Profile**.

### Product vision (source: PRD §Vision)

> "Engineers who do this 'glue work' consistently cannot prove it at review time."

GitGud solves this through **transparency** — a Contributor and their Supervisor see identical data (**Data Parity**) — and **safety** — no rankings, no comparisons between Contributors. This is the trust proposition.

### Stack & business logic layers

| Layer       | Technology                          | Business logic                                                                  |
| ----------- | ----------------------------------- | ------------------------------------------------------------------------------- |
| UI          | React 19 islands + Astro 6 SSR      | Wizard state machine (`wizard-reducer.ts`), navigation guards in `.astro` pages |
| API routes  | Astro API routes (`src/pages/api/`) | Zod validation, auth, role-check, delegation to services                        |
| Services    | `src/lib/services/`                 | Board CRUD, AI classification, impact metrics, VCS sync                         |
| Persistence | Supabase (Postgres) + RLS           | `SECURITY DEFINER` RPCs, RLS policies, CHECK constraints                        |
| Worker      | Cloudflare Workflows (`worker.ts`)  | Classification Batch Workflow (sync + classification orchestration)             |

---

## STEP 1 — Identified business invariants

### INV-01: Atomic Board creation

A Board MUST be created atomically together with its Repositories and Board Contributors — no orphaned Boards.

- **Source**: PRD FR-001/002/003; `create_board_atomic` RPC (`20260625130000_create_board_read_user_pat.sql:12-55`).

### INV-02: Only the Supervisor mutates the Board

Only the `owner_user_id` (Supervisor) can: rename, add/remove Repositories, add/remove Board Contributors, trigger Sync, delete the Board.

- **Source**: RLS policies `boards_update/delete` (`20260529120000:73-82`); API routes each check `board.role !== "supervisor"`.

### INV-03: Board access derived from ownership OR Contributor-profile linkage

A user can see a Board if they own it OR their `user_profiles.github_id` matches a `board_contributors.github_id`.

- **Source**: `is_board_member()` (`20260623100000_derived_board_access.sql:10-27`).

### INV-04: Data Parity — Contributor sees identical data as Supervisor

- **Source**: PRD Non-Functional Requirements: "an IC viewing their own profile and an EM viewing that same profile see identical data."

### INV-05: No ranking or comparison between Contributors

- **Source**: PRD Guardrails: "No individual ranking or comparison across ICs — the tool must never present a comparative view."

### INV-06: Board requires a valid GitHub PAT

- **Source**: `create_board_atomic` RPC checks `v_has_pat` (`20260625130000:29-34`).

### INV-07: Thread Classification is per-Thread, anchored on root Review Comment

- **Source**: PK `thread_root_comment_id` (`20260618120000:4`); system prompt in `classification.ts:143`.

### INV-08: Unique Board name per Supervisor

- **Source**: constraint `boards_owner_name_unique` (referenced in error handling at `api/board/index.ts:69`).

### INV-09: Contributor can only view their own Contribution Profile

A non-Supervisor (Contributor role) can only view the Contribution Profile linked to their own `user_profiles.github_id`.

- **Source**: PRD Access Control: "IC sees their own data"; PRD Guardrails: "No comparative view."

### INV-10: Vote is scoped to Board members

- **Source**: `set_thread_classification_vote` RPC (`20260709120000:7-38`).

### INV-11: Bot Review Comments excluded from classification (Bot Filtering)

- **Source**: `isBotComment()` (`classification.ts:23-29`).

### INV-12: Thread Classification uses Majority Vote (3 repeats)

- **Source**: `CLASSIFICATION_VOTE_REPEATS = 3` (`classification.ts:184`); `classifyBatch()` (`classification.ts:404-432`).

---

## STEP 2 — Classification & selection

| #          | Invariant                             | (a) Core to product | (b) Spread across layers     | (c) Enforcement quality                          |
| ---------- | ------------------------------------- | ------------------- | ---------------------------- | ------------------------------------------------ |
| INV-01     | Atomic Board creation                 | High                | Low — consolidated in DB RPC | **Strong** — single SECURITY DEFINER transaction |
| INV-02     | Supervisor-only mutation              | High                | Medium — per-route           | Medium — pattern, not centralized                |
| INV-03     | Derived Board access                  | High                | Low — single DB function     | **Strong** — RLS + SECURITY DEFINER              |
| INV-04     | Data Parity                           | Critical            | Medium — multiple endpoints  | **Weak** — coincidental, no assertion            |
| INV-05     | No Contributor ranking                | Critical            | Low — route-level            | Medium — API guards                              |
| INV-06     | PAT required                          | High                | Low — DB-enforced            | **Strong**                                       |
| INV-07     | Thread Classification per root        | High                | Medium — DB + service        | **Strong** — PK constraint                       |
| INV-08     | Unique Board name                     | Low                 | Low — DB constraint          | **Strong**                                       |
| **INV-09** | **Contributor sees ONLY own profile** | **Critical**        | **High — 9 sites, 7 files**  | **Weak — copy-paste**                            |
| INV-10     | Vote scoped to Board member           | Medium              | Low — DB RPC                 | **Strong**                                       |
| INV-11     | Bot Filtering                         | Medium              | Low — service function       | Medium                                           |
| INV-12     | Majority Vote                         | Medium              | Low — service internal       | **Strong**                                       |

### Selected invariant: INV-09 — "Contributor can only view their own Contribution Profile"

**Rationale:**

1. **Most core to the product's purpose.** The PRD declares: "the absence of comparison is a design constraint, not a UX omission — it is what makes the tool safe to use transparently." If INV-09 is violated, a Contributor sees another Contributor's data — the product becomes a surveillance tool, destroying the trust proposition that IS the product.

2. **Most spread across layers.** The same 4-step pattern (Board lookup → BoardRole check → own User Profile lookup → githubId comparison) is duplicated across:
   - 5 API routes in `src/pages/api/board/[boardId]/impact/[login]/` (summary, author, reviewer, activity, classifications)
   - 2 API routes in `src/pages/api/board/[boardId]/threads/` ([login].ts, [login]/[threadId].ts)
   - 2 Astro SSR pages (impact/[githubLogin]/[...dateRange].astro, threads/[githubLogin]/[...dateRange].astro)

   A total of **9 independent sites** across **7 files** in **2 layers**.

3. **Weakest enforcement.** No structural guarantee. A new endpoint added by a developer who forgets to copy the 4-step pattern silently exposes all Contributors' data to any Board member. The failure mode is invisible — 200 OK with forbidden data instead of a visible error. RLS does NOT enforce this invariant — `is_board_member` allows any Board member to read ALL Board data at the DB level.

---

## STEP 3 — Diagnosis of the selected invariant

### Where the rule lives today — full map

#### API layer — 7 independent copies of the same pattern

Each of these endpoints repeats an identical sequence:

```typescript
// 1. Resolve Board + BoardRole
const board = await getBoardWithRole(supabase, boardId, user.id);
if (!board) return json({ error: "Board not found" }, 404);

// 2. Resolve Board Contributor
const { data: contributor } = await supabase
  .from("board_contributors")
  .select("github_id")
  .eq("board_id", boardId)
  .eq("github_login", login)
  .maybeSingle();
if (!contributor) return json({ error: "Contributor not found" }, 404);

// 3. If not Supervisor, check own User Profile match
if (board.role !== "supervisor") {
  const ownProfile = await getUserProfile(supabase, user.id).catch(() => null);
  if (ownProfile?.githubId !== contributor.github_id) return json({ error: "Forbidden" }, 403);
}
```

| #   | File                                                              | Lines | Enforces? | Notes                          |
| --- | ----------------------------------------------------------------- | ----- | --------- | ------------------------------ |
| 1   | `src/pages/api/board/[boardId]/impact/[login]/summary.ts`         | 39-57 | YES       | Full pattern                   |
| 2   | `src/pages/api/board/[boardId]/impact/[login]/author.ts`          | 39-57 | YES       | Identical copy                 |
| 3   | `src/pages/api/board/[boardId]/impact/[login]/reviewer.ts`        | 39-57 | YES       | Identical copy                 |
| 4   | `src/pages/api/board/[boardId]/impact/[login]/activity.ts`        | 39-57 | YES       | Identical copy                 |
| 5   | `src/pages/api/board/[boardId]/impact/[login]/classifications.ts` | 39-57 | YES       | Identical copy                 |
| 6   | `src/pages/api/board/[boardId]/threads/[login].ts`                | 77-95 | YES       | Identical copy, + query params |
| 7   | `src/pages/api/board/[boardId]/threads/[login]/[threadId].ts`     | 36-54 | YES       | Identical copy                 |

#### Astro SSR layer — 2 independent copies (slightly different shape)

<!-- prettier-ignore -->
```astro
const ownContributor = ownProfile
  ? contributors.find((c) => c.githubId === ownProfile.githubId)
  : null;
if (board.role !== "supervisor" && ownContributor?.githubLogin !== githubLogin) {
  return Astro.redirect(...);
}
```

| #   | File                                                              | Lines | Enforces? | Notes                   |
| --- | ----------------------------------------------------------------- | ----- | --------- | ----------------------- |
| 8   | `src/pages/board/[id]/impact/[githubLogin]/[...dateRange].astro`  | 41-43 | YES       | Redirect instead of 403 |
| 9   | `src/pages/board/[id]/threads/[githubLogin]/[...dateRange].astro` | 41-43 | YES       | Identical copy          |

#### DB / RLS layer — DOES NOT enforce

- `is_board_member(p_board_id)` (`20260623100000:10-27`): checks `boards.owner_user_id = auth.uid()` OR `board_contributors.github_id → user_profiles.user_id = auth.uid()`. Admits **every** Board member — no distinction about whose Contribution Profile is being queried.
- All RLS policies on `github_pull_requests`, `github_review_comments`, `github_reviews`, `thread_classifications` use `is_board_member` — meaning any Contributor on a Board can read ALL data for that Board at the DB level.

#### Middleware layer — DOES NOT enforce

- `src/middleware.ts:4-29`: checks authentication and protects `PROTECTED_ROUTES`. Does not touch Contributor scope.

#### UI layer — DOES NOT enforce (defense-in-depth, not a guard)

- React components receive `visibleContributors` pre-filtered on the server (Astro). The UI does not render a dropdown with other Contributors for the Contributor role. But this is a presentation layer — the API is publicly accessible and is not protected by the UI.

### Key weaknesses

1. **No centralization**: 9 independent sites. Every new endpoint with a `[login]` parameter must remember to add the same pattern.

2. **Silent failure mode**: Omitting the pattern returns 200 OK with another Contributor's data. The system does not "scream."

3. **Shape inconsistency**: The pattern in API routes returns JSON 403; the pattern in Astro pages does a redirect. Two different shapes of the same invariant.

4. **Redundant DB queries**: Each endpoint independently queries `board_contributors` and `user_profiles` — the same data, with the same queries, N times per page load (the Contribution Profile loads 5 endpoints in parallel → 5x the same Board Contributor lookup + 5x the same User Profile lookup).

5. **RLS does not help**: Even if someone bypassed the API (e.g. direct Supabase client in the browser), RLS does not block reading another Contributor's data on the Board.

---

## STEP 4 — Guardian-aggregate design

### Aggregate: `ContributorProfileAccess`

An aggregate root that is the SOLE enforcement point for the rule "a Contributor can only view their own Contribution Profile." No layer enforces this invariant independently — all logic flows through this aggregate.

### 4.1 Domain errors

```typescript
// src/lib/domain/errors.ts

export class ContributorNotFoundError extends Error {
  readonly code = "CONTRIBUTOR_NOT_FOUND" as const;
  constructor(boardId: string, login: string) {
    super(`Contributor "${login}" not found on board ${boardId}`);
    this.name = "ContributorNotFoundError";
  }
}

export class ContributorAccessDeniedError extends Error {
  readonly code = "CONTRIBUTOR_ACCESS_DENIED" as const;
  constructor(boardId: string, requestedLogin: string) {
    super(`Access denied to contributor "${requestedLogin}" on board ${boardId}`);
    this.name = "ContributorAccessDeniedError";
  }
}

export class BoardNotFoundError extends Error {
  readonly code = "BOARD_NOT_FOUND" as const;
  constructor(boardId: string) {
    super(`Board ${boardId} not found or access denied`);
    this.name = "BoardNotFoundError";
  }
}
```

### 4.2 Aggregate

```typescript
// src/lib/domain/contributor-profile-access.ts

import type { BoardRole } from "@/types";
import { ContributorNotFoundError, ContributorAccessDeniedError, BoardNotFoundError } from "./errors";

export interface ResolvedContributor {
  boardId: string;
  boardRole: BoardRole;
  githubId: number;
  githubLogin: string;
}

interface BoardInfo {
  id: string;
  role: BoardRole;
}

interface ContributorRow {
  githubId: number;
}

interface CallerGitHubIdentity {
  githubId: number;
}

export class ContributorProfileAccess {
  private constructor(
    readonly boardId: string,
    readonly boardRole: BoardRole,
    readonly contributorGithubId: number,
    readonly contributorLogin: string,
  ) {}

  /**
   * Resolve access to a Contributor's Contribution Profile on a Board.
   * This is the SINGLE enforcement point for INV-09.
   *
   * Preconditions checked (throws named domain error on violation):
   *   1. Board exists and caller is a Board member → BoardNotFoundError
   *   2. Board Contributor exists on the Board → ContributorNotFoundError
   *   3. Non-Supervisor can only access own profile → ContributorAccessDeniedError
   */
  static resolve(
    board: BoardInfo | null,
    boardId: string,
    contributor: ContributorRow | null,
    login: string,
    callerProfile: CallerGitHubIdentity | null,
  ): ContributorProfileAccess {
    // Precondition 1: Board must exist and caller must be a member
    if (!board) {
      throw new BoardNotFoundError(boardId);
    }

    // Precondition 2: Board Contributor must exist on the Board
    if (!contributor) {
      throw new ContributorNotFoundError(board.id, login);
    }

    // Precondition 3: non-Supervisor can only view own Contribution Profile (INV-09)
    if (board.role !== "supervisor") {
      if (!callerProfile || callerProfile.githubId !== contributor.githubId) {
        throw new ContributorAccessDeniedError(board.id, login);
      }
    }

    return new ContributorProfileAccess(board.id, board.role, contributor.githubId, login);
  }

  /** The resolved Contributor identity, ready for service calls. */
  get resolved(): ResolvedContributor {
    return {
      boardId: this.boardId,
      boardRole: this.boardRole,
      githubId: this.contributorGithubId,
      githubLogin: this.contributorLogin,
    };
  }
}
```

### 4.3 Repository

```typescript
// src/lib/domain/contributor-profile-repo.ts

import type { createClient } from "@/lib/supabase";
import { getBoardWithRole, getUserProfile } from "@/lib/services/boards";
import { ContributorProfileAccess } from "./contributor-profile-access";

type SupabaseClient = NonNullable<ReturnType<typeof createClient>>;

/**
 * Loads all inputs needed by ContributorProfileAccess.resolve() in one place.
 * Replaces the 3-query boilerplate duplicated across 7 API routes.
 */
export async function resolveContributorAccess(
  supabase: SupabaseClient,
  boardId: string,
  login: string,
  userId: string,
): Promise<ContributorProfileAccess> {
  const [board, contributorResult, callerProfile] = await Promise.all([
    getBoardWithRole(supabase, boardId, userId),
    supabase
      .from("board_contributors")
      .select("github_id")
      .eq("board_id", boardId)
      .eq("github_login", login)
      .maybeSingle(),
    getUserProfile(supabase, userId).catch(() => null),
  ]);

  const contributor = contributorResult.data ? { githubId: contributorResult.data.github_id as number } : null;

  if (contributorResult.error) {
    throw contributorResult.error;
  }

  return ContributorProfileAccess.resolve(
    board ? { id: board.id, role: board.role } : null,
    boardId,
    contributor,
    login,
    callerProfile ? { githubId: callerProfile.githubId } : null,
  );
}
```

### 4.4 Domain error → HTTP response mapping

```typescript
// src/lib/domain/http-error-map.ts

import { BoardNotFoundError, ContributorNotFoundError, ContributorAccessDeniedError } from "./errors";

export function mapDomainError(err: unknown): { status: number; body: { error: string } } | null {
  if (err instanceof BoardNotFoundError) {
    return { status: 404, body: { error: "Board not found" } };
  }
  if (err instanceof ContributorNotFoundError) {
    return { status: 404, body: { error: "Contributor not found" } };
  }
  if (err instanceof ContributorAccessDeniedError) {
    return { status: 403, body: { error: "Forbidden" } };
  }
  return null;
}
```

### 4.5 Thin API route — before / after

**BEFORE** (e.g. `summary.ts` — 72 lines, 18 of which are invariant boilerplate):

```typescript
// Lines 33-57 — the entire block is manual invariant enforcement
const board = await getBoardWithRole(supabase, boardId, user.id);
if (!board) return json({ error: "Board not found" }, 404);
// ... Board Contributor lookup ...
if (board.role !== "supervisor") {
  const ownProfile = await getUserProfile(supabase, user.id).catch(...);
  if (ownProfile?.githubId !== contributor.github_id) return json({ error: "Forbidden" }, 403);
}
// Line 60+ — actual business logic
const result = await getImpactSummary(supabase, boardId, contributor.github_id, ...);
```

**AFTER** (same `summary.ts`):

```typescript
import { resolveContributorAccess } from "@/lib/domain/contributor-profile-repo";
import { mapDomainError } from "@/lib/domain/http-error-map";

export const GET: APIRoute = async (context) => {
  // ... supabase + user auth (unchanged) ...
  // ... params validation (unchanged) ...

  let access;
  try {
    access = await resolveContributorAccess(supabase, boardId, login, user.id);
  } catch (err) {
    const mapped = mapDomainError(err);
    if (mapped) return json(mapped.body, mapped.status);
    throw err;
  }

  try {
    const { githubId } = access.resolved;
    const result = await getImpactSummary(supabase, boardId, githubId, parsePeriodSlug(periodSlug));
    return json(result);
  } catch (err) {
    logger.error("[impact/summary] service error", err);
    return json({ error: "Failed to compute metrics" }, 500);
  }
};
```

### 4.6 Bonus: query parallelization

The current pattern executes sequentially: `getBoardWithRole` → Board Contributor lookup → `getUserProfile`. The repository (`resolveContributorAccess`) runs all three queries **in parallel** (`Promise.all`), reducing latency by ~2 DB roundtrips per request. With 5 parallel endpoints loading a Contribution Profile page, that saves ~10 redundant roundtrips per page load.

---

## STEP 5 — Before/after, phased plan, tests

### 5.1 Before/after for every current enforcement site

| #   | File                                               | Today                               | After refactor                                              |
| --- | -------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------- |
| 1   | `impact/[login]/summary.ts:39-57`                  | 18-line copy-paste block            | `resolveContributorAccess()` + `mapDomainError()`           |
| 2   | `impact/[login]/author.ts:39-57`                   | Identical copy                      | ditto                                                       |
| 3   | `impact/[login]/reviewer.ts:39-57`                 | Identical copy                      | ditto                                                       |
| 4   | `impact/[login]/activity.ts:39-57`                 | Identical copy                      | ditto                                                       |
| 5   | `impact/[login]/classifications.ts:39-57`          | Identical copy                      | ditto                                                       |
| 6   | `threads/[login].ts:77-95`                         | Identical copy with query params    | ditto                                                       |
| 7   | `threads/[login]/[threadId].ts:36-54`              | Identical copy                      | ditto                                                       |
| 8   | `impact/[githubLogin]/[...dateRange].astro:29-44`  | Inline contributors.find + redirect | `resolveContributorAccess()` in try/catch; catch → redirect |
| 9   | `threads/[githubLogin]/[...dateRange].astro:29-44` | Identical copy                      | ditto                                                       |

### 5.2 Phased refactor plan

#### Phase 1 — Domain layer (test-first)

**Files to create:**

- `src/lib/domain/errors.ts`
- `src/lib/domain/contributor-profile-access.ts`
- `src/lib/domain/contributor-profile-repo.ts`
- `src/lib/domain/http-error-map.ts`

**Test-first.** Test cases (see §5.3) are written BEFORE the implementation. The project uses Vitest 4.x (`tests/unit/`).

#### Phase 2 — API route migration (after Phase 1 tests are green)

Migrate the 7 API routes one by one. Each commit:

1. Replaces the 18-line block with `resolveContributorAccess()` + `mapDomainError()`.
2. Existing hermetic/integration tests pass unchanged (behavior is identical).

Order: `summary.ts` (pilot) → `author.ts` → `reviewer.ts` → `activity.ts` → `classifications.ts` → `threads/[login].ts` → `threads/[login]/[threadId].ts`.

#### Phase 3 — Astro page migration

Migrate 2 Astro pages. Catch the domain error → redirect instead of JSON.

#### Phase 4 — Dead code removal

Verify that no file still contains the old inline pattern (inline Board Contributor lookup + User Profile match). Codebase-wide `grep`.

### 5.3 Test cases for the invariant (test-first, Phase 1)

File: `tests/unit/domain/contributor-profile-access.test.ts`

#### Legal transitions (should return a `ContributorProfileAccess` instance):

| #   | Description                                           | Conditions                                                                           |
| --- | ----------------------------------------------------- | ------------------------------------------------------------------------------------ |
| T1  | Supervisor views any Contributor                      | `board.role = "supervisor"`, login = any Board Contributor                           |
| T2  | Contributor views themselves                          | `board.role = "contributor"`, callerProfile.githubId === contributor.githubId        |
| T3  | Supervisor without a User Profile views a Contributor | `board.role = "supervisor"`, callerProfile = null (GitHub PAT not linked to profile) |

#### Illegal transitions (should throw a named domain error):

| #   | Description                                   | Conditions                                                                                      | Expected error                 |
| --- | --------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------ |
| T4  | Board does not exist                          | board = null                                                                                    | `BoardNotFoundError`           |
| T5  | Board Contributor does not exist on Board     | contributor = null                                                                              | `ContributorNotFoundError`     |
| T6  | Contributor tries to view another Contributor | board.role = "contributor", callerProfile.githubId !== contributor.githubId                     | `ContributorAccessDeniedError` |
| T7  | Contributor without a User Profile            | board.role = "contributor", callerProfile = null                                                | `ContributorAccessDeniedError` |
| T8  | Contributor with a profile but not matching   | board.role = "contributor", callerProfile.githubId !== contributor.githubId, contributor exists | `ContributorAccessDeniedError` |

#### Repository tests (`resolveContributorAccess`):

| #   | Description                                                                                                                   |
| --- | ----------------------------------------------------------------------------------------------------------------------------- |
| T9  | Success — returns `ContributorProfileAccess` with correct data                                                                |
| T10 | DB error on Board Contributor lookup — propagates error (does not swallow)                                                    |
| T11 | User Profile lookup fails — treats callerProfile as null → access check still works (Supervisor passes, Contributor → denied) |

#### HTTP mapping tests:

| #   | Description                                      |
| --- | ------------------------------------------------ |
| T12 | `BoardNotFoundError` → 404                       |
| T13 | `ContributorNotFoundError` → 404                 |
| T14 | `ContributorAccessDeniedError` → 403             |
| T15 | Unknown error → null (caller decides what to do) |

### 5.4 New load-bearing names

| Name                           | Kind                   | Purpose                                                   |
| ------------------------------ | ---------------------- | --------------------------------------------------------- |
| `ContributorProfileAccess`     | Class (aggregate root) | Sole guardian of INV-09                                   |
| `ContributorNotFoundError`     | Error class            | Fail-fast: Board Contributor does not exist               |
| `ContributorAccessDeniedError` | Error class            | Fail-fast: Contributor has no access to requested profile |
| `BoardNotFoundError`           | Error class            | Fail-fast: Board does not exist or caller is not a member |
| `resolveContributorAccess`     | Function (repository)  | Loads data and calls `ContributorProfileAccess.resolve()` |
| `mapDomainError`               | Function               | Maps domain errors to HTTP responses                      |

Location: `src/lib/domain/` — new domain module directory, as recommended in `01-domain-distillation.md §5` ("No dedicated domain layer: business logic is spread across services, SQL RPCs, and API routes. There is no domain module in the DDD sense.").

---

## Summary

**INV-09 ("Contributor can only view their own Contribution Profile")** is the most core and the weakest-enforced invariant in GitGud. It is scattered across 9 sites in 7 files and 2 layers, enforced solely by copy-paste discipline. Violating it is invisible (200 OK with forbidden data) and destroys the product's trust proposition. The proposed `ContributorProfileAccess` aggregate centralizes enforcement in a single `resolve()` method — an illegal operation throws a named domain error (`ContributorAccessDeniedError`) instead of silently returning data. The `resolveContributorAccess` repository replaces duplicated queries with a single `Promise.all`, saving ~10 DB roundtrips per Contribution Profile page load. The 4-phase plan with test-first on the domain layer covers 15 test cases (legal and illegal transitions). After the refactor, no endpoint enforces the invariant on its own — only the aggregate does.
