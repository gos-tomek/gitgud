---
title: "Anti-Corruption Layer — Supabase dependency isolation"
created: 2026-08-15
type: refactor-plan
status: draft
scope: "@supabase/supabase-js, @supabase/ssr"
target_files_today: 33
target_files_after: 8
depends-on:
  - 01-domain-distillation.md
  - 02-invariant-aggregate-refactor.md
terminology: 01-domain-distillation.md §1.1 Ubiquitous Language
---

# Anti-Corruption Layer: Supabase Dependency Isolation

> **Terminology.** This document follows the Ubiquitous Language established in
> `01-domain-distillation.md §1.1`: Supervisor (not EM), Contributor (not IC),
> Change Request (not Pull Request), Repository (not GitHub Repo),
> Contribution Profile, Thread, Thread Classification, Vote.

---

## 0. Context

**Stack**: Astro 6 SSR + React 19 + Supabase (auth + persistence + RLS) + Cloudflare Workers.

**Code layers** (de facto, not declared):

| Layer        | Directory               | Responsibility                                                   |
| ------------ | ----------------------- | ---------------------------------------------------------------- |
| Global types | `src/env.d.ts`          | Astro contracts (`App.Locals`)                                   |
| Middleware   | `src/middleware.ts`     | Auth guard, resolve user                                         |
| Pages (UI)   | `src/pages/*.astro`     | SSR, client creation, data forwarding to React                   |
| API routes   | `src/pages/api/**/*.ts` | Input validation, auth, delegation to services                   |
| Services     | `src/lib/services/*.ts` | Domain logic + persistence (no separation)                       |
| Helpers      | `src/lib/*.ts`          | Client factories, utils, GitHub SDK wrapper                      |
| Worker       | `src/worker.ts`         | Cloudflare Workflow — sync + classify orchestration              |
| Domain types | `src/types.ts`          | Value objects (Board, Change Request, Review, Classification...) |

**External dependencies** (from `package.json`): `@supabase/ssr`, `@supabase/supabase-js`, `@octokit/rest` + plugins, `@sentry/cloudflare`, `zod`, `recharts`, `react-markdown`.

**Swappability declarations** in foundation documents:

- `context/foundation/tech-stack.md:24`: _"The AI classification layer for FR-012 is not bundled but slots into Astro API routes cleanly as a **thin Anthropic or OpenAI SDK addition**."_ — signal that the AI provider should be swappable.
- No analogous declaration for Supabase swappability — but `prd.md` is database-agnostic in its language (no requirement references Supabase-specific APIs).

---

## 1. Leaking dependency identification

### 1.1 `@supabase/supabase-js` + `@supabase/ssr` — **30+ files, 5 layers**

**Direct package imports:**

| File                        | Line | Import                                                       |
| --------------------------- | ---- | ------------------------------------------------------------ |
| `src/env.d.ts`              | 3    | `import("@supabase/supabase-js").User` — global type         |
| `src/lib/supabase.ts`       | 1    | `createServerClient, parseCookieHeader` from `@supabase/ssr` |
| `src/lib/supabase-admin.ts` | 1    | `createClient` from `@supabase/supabase-js`                  |

**Indirect coupling: `type SupabaseClient = NonNullable<ReturnType<typeof createClient>>`** — 7 independent copies (also identified in `context/changes/refactor-opportunities/research.md` as C3):

| File                                  | Line |
| ------------------------------------- | ---- |
| `src/lib/github.ts`                   | 10   |
| `src/lib/token-status.ts`             | 3    |
| `src/lib/services/boards.ts`          | 10   |
| `src/lib/services/classification.ts`  | 6    |
| `src/lib/services/github-sync.ts`     | 22   |
| `src/lib/services/impact-metrics.ts`  | 23   |
| `src/pages/api/github/sync/status.ts` | 20   |

**Direct `createClient` usage from `@/lib/supabase` (15 pages + 15 API routes):**

Pages: `dashboard.astro`, `board/[id].astro`, `board/new.astro`, `board/[id]/settings.astro`, `board/[id]/impact/index.astro`, `board/[id]/impact/[githubLogin]/[...dateRange].astro`, `board/[id]/threads/index.astro`, `board/[id]/threads/[githubLogin]/[...dateRange].astro`, `board/[id]/activity/[...dateRange].astro`, `profile/settings.astro`.

API routes: `api/auth/signin.ts`, `api/auth/signup.ts`, `api/auth/signout.ts`, `api/github/sync.ts`, `api/github/validate-pat.ts`, `api/github/validate-repo.ts`, `api/github/repos.ts`, `api/github/collaborators.ts`, `api/github/sync/status.ts`, `api/profile/password.ts`, `api/profile/pat.ts`, `api/board/index.ts`, `api/board/check-name.ts`, `api/board/[boardId]/contributors.ts`, `api/board/[boardId]/settings.ts`, `api/board/[boardId]/repos.ts`, `api/board/[boardId]/last-synced.ts`, `api/board/[boardId]/impact/*/`, `api/board/[boardId]/threads/*/`.

**Direct query builder calls (`supabase.from()`, `supabase.rpc()`, `supabase.auth.*`):**

- In services: `boards.ts` (10x), `impact-metrics.ts` (15x), `github-sync.ts` (8x), `classification.ts` (4x), `homepage-stats.ts` (1x), `token-status.ts` (1x).
- In API routes: `sync/status.ts`, `sync.ts` (indirectly via `getBoardWithRole`).
- In worker: `worker.ts` (7x direct `.from()` + `.rpc()` on `createServiceClient`).

### 1.2 `@octokit/rest` + plugins — **8 files, 3 layers**

| File                              | Line | What it imports                                                  |
| --------------------------------- | ---- | ---------------------------------------------------------------- |
| `src/lib/github.ts`               | 1-3  | `Octokit`, `retry`, `throttling` (direct import of 3 packages)   |
| `src/lib/services/github-sync.ts` | 1    | `import type { Octokit }` — type in 6 public function signatures |

Indirectly (via `makeOctokit` from `@/lib/github`):
`worker.ts`, `api/github/repos.ts`, `api/github/collaborators.ts`, `api/github/validate-pat.ts`, `api/github/validate-repo.ts`, `api/profile/pat.ts`.

Derived type: `PrItem = Awaited<ReturnType<Octokit["rest"]["pulls"]["list"]>>["data"][number]` (`github-sync.ts:66`) — Octokit type in a domain-level signature.

### 1.3 `@sentry/cloudflare` — **1 file, 1 layer**

Only `src/worker.ts:1`. Well isolated.

### 1.4 `zod` — **24 files, 2 layers** (API + service)

Used at system boundary (HTTP input validation). Correct placement — not a leak in the DDD sense.

---

## 2. Classification and #1 selection

| Dependency   | Layers                                    | Files  | Replacement cost                               | Signal from documents                      |
| ------------ | ----------------------------------------- | ------ | ---------------------------------------------- | ------------------------------------------ |
| **Supabase** | Types + MW + UI + API + Services + Worker | **33** | Critical — replacement touches entire codebase | PRD is DB-agnostic; no lock-in declaration |
| Octokit      | Services + API + Worker                   | 8      | Moderate — factory partially isolates          | GitHub is the only data source in v1       |
| Sentry       | Worker                                    | 1      | Low                                            | —                                          |
| Zod          | API (boundary)                            | 24     | Low — boundary usage is correct                | —                                          |

### Selection: `@supabase/supabase-js` + `@supabase/ssr`

**Rationale:**

1. **Highest coupling density:** 33 files across 6 layers. No other dependency is close.
2. **Dual role:** Supabase serves simultaneously as auth provider (`supabase.auth.*`) and persistence (`supabase.from()`). Replacing either role requires touching both — because both are addressed through the same client object.
3. **Library type in global contract:** `env.d.ts:3` exports `@supabase/supabase-js.User` as the `App.Locals.user` type. Every Astro page and API route reading `context.locals.user` receives a Supabase-specific type (with properties like `app_metadata`, `user_metadata`, `aud`, `identities`, `factors` — none of which have a domain equivalent in GitGud).
4. **Services = repositories:** The `src/lib/services/` layer does not separate domain logic from persistence. Functions like `getImpactSummary()` and `getAuthorMetrics()` interleave domain computations (percentiles, KPIs, merge rate) with query builder calls (`supabase.from("github_pull_requests").select(...).in(...)`). Replacing Supabase with Drizzle/Prisma/raw SQL would require rewriting EVERY service function.
5. **Confirmed in existing analysis:** `context/changes/refactor-opportunities/research.md` identifies C3 (7x hand-copied `SupabaseClient`) as "accidental complexity" — accumulated over 5 weeks with no historical defense (`plan.md` treats it as a template).

---

## 3. Diagnosis

### 3.1 Library type in global contract

```typescript
// src/env.d.ts:3
declare namespace App {
  interface Locals {
    user: import("@supabase/supabase-js").User | null; // ← library in Astro contract
  }
}
```

The `User` type from `@supabase/supabase-js` contains ~20 Supabase-specific fields (including `app_metadata`, `user_metadata`, `aud`, `identities`, `factors`, `is_anonymous`, `phone`, `phone_confirmed_at`). GitGud uses only `id` (UUID) and `email` (optionally, in `api/auth/signup.ts`). The rest is dead type weight that nonetheless pulls the dependency into the global scope.

**Propagation:** Every reference to `Astro.locals.user` or `context.locals.user` — in 6 pages and 15+ API routes — is typed as `@supabase/supabase-js.User | null`. Replacing the auth provider requires changing `env.d.ts` + auditing each of those 21+ sites for Supabase-specific field access.

### 3.2 Duplicated `SupabaseClient` type

Seven files independently define:

```typescript
type SupabaseClient = NonNullable<ReturnType<typeof createClient>>;
```

Each copy imports `createClient` from `@/lib/supabase`, then extracts its return type. This means:

- Changing the `createClient` signature requires verifying 7 files.
- There is no single place defining "what is the persistence client" for the rest of the application.

Locations:

- `src/lib/github.ts:10`
- `src/lib/token-status.ts:3`
- `src/lib/services/boards.ts:10`
- `src/lib/services/classification.ts:6`
- `src/lib/services/github-sync.ts:22`
- `src/lib/services/impact-metrics.ts:23`
- `src/pages/api/github/sync/status.ts:20`

### 3.3 No logic/persistence separation in services

Example — `src/lib/services/boards.ts:32-41`:

```typescript
export async function getUserBoards(supabase: SupabaseClient, userId: string): Promise<UserBoard[]> {
  const { data, error } = await supabase
    .from("boards") // ← table name in service
    .select("id,name,owner_user_id,created_at,updated_at") // ← columns in service
    .order("created_at", { ascending: false }); // ← query builder API in service
  if (error) throw error;
  return (data as BoardRow[]).map((row) => toUserBoard(row, userId));
}
```

The function **is** a repository but **pretends** to be a domain service. Domain computations (`toUserBoard` with the `supervisor`/`contributor` role derivation) are interleaved with PostgREST queries.

The same pattern repeats 30+ times in: `boards.ts`, `impact-metrics.ts`, `github-sync.ts`, `classification.ts`, `homepage-stats.ts`, `token-status.ts`.

### 3.4 Dual-role client: auth + persistence

In `src/pages/api/github/validate-pat.ts:19-27`:

```typescript
const supabase = createClient(context.request.headers, context.cookies);
// ...
const {
  data: { user },
} = await supabase.auth.getUser(); // ← auth
// ...
const octokit = makeOctokit(pat);
const { data, headers } = await octokit.rest.users.getAuthenticated();
```

A single `supabase` object handles both auth (`.auth.getUser()`) and queries (`.from()...`). This makes it impossible to replace only the auth provider (e.g. with Auth.js, Clerk, Lucia) without touching persistence.

---

## 4. ACL Design

### 4.1 Domain value object: `AppUser`

Instead of `@supabase/supabase-js.User`, the domain operates on a minimal type:

```typescript
// src/types.ts (extending the existing file)

export interface AppUser {
  readonly id: string; // UUID — the only identifier used in GitGud
  readonly email: string; // needed in the signup flow
}
```

> **`AppUser` vs `UserProfile` — relationship.**
> `AppUser` is the **auth identity** — the authenticated user's id and email,
> mapped from whatever auth provider is in use. It replaces
> `@supabase/supabase-js.User` in `App.Locals` and carries no
> provider-specific fields.
>
> `UserProfile` (`src/types.ts:49-55`, domain concept #16 in
> `01-domain-distillation.md`) is the **GitHub-linked profile** — `githubId`,
> `githubLogin`, `avatarUrl`, `tokenExpiresAt`. It is loaded separately (via
> `getUserProfile`) and is not always present (a user can exist in auth without
> having linked a GitHub identity yet).
>
> The two are complementary, not overlapping: `AppUser.id` is the FK into
> `UserProfile.userId`. `AppUser` lives on every request (set by middleware);
> `UserProfile` is loaded on demand by services that need GitHub identity.

**Single conversion point** — middleware:

```typescript
// src/middleware.ts — mapping Supabase User → AppUser
import type { AppUser } from "@/types";

// ... in middleware:
const supabaseUser = await supabase.auth.getUser();
context.locals.user = supabaseUser.data.user
  ? { id: supabaseUser.data.user.id, email: supabaseUser.data.user.email ?? "" }
  : null;
```

**Change in `env.d.ts`:**

```typescript
// BEFORE:
user: import("@supabase/supabase-js").User | null;

// AFTER:
user: import("./types").AppUser | null;
```

After this change, no page or API route sees the `@supabase/supabase-js.User` type.

### 4.2 Port: `AuthPort`

Narrow domain interface for auth operations:

```typescript
// src/lib/ports/auth.ts

import type { AppUser } from "@/types";

export interface AuthPort {
  getUser(): Promise<AppUser | null>;
  signUp(email: string, password: string): Promise<{ user: AppUser | null; error: string | null }>;
  signIn(email: string, password: string): Promise<{ error: string | null }>;
  signOut(): Promise<void>;
  updatePassword(newPassword: string): Promise<{ error: string | null }>;
  signInWithPassword(email: string, password: string): Promise<{ error: string | null }>;
}
```

### 4.3 Port: `PersistencePort`

Interface for persistence operations. Instead of a single mega-port (anti-pattern), one port per aggregate root:

```typescript
// src/lib/ports/boards-repository.ts

import type { UserBoard, BoardContributor } from "@/types";

export interface BoardsRepository {
  getUserBoards(userId: string): Promise<UserBoard[]>;
  getBoardWithRole(boardId: string, userId: string): Promise<UserBoard | null>;
  getBoardRepos(boardId: string): Promise<{ repoOwner: string; repoName: string; connectedAt: string }[]>;
  getBoardContributors(boardId: string): Promise<BoardContributor[]>;
  renameBoard(boardId: string, name: string): Promise<void>;
  addBoardRepo(boardId: string, repoOwner: string, repoName: string): Promise<{ id: string }>;
  removeBoardRepo(boardId: string, repoOwner: string, repoName: string): Promise<void>;
  addBoardContributors(
    boardId: string,
    contributors: { githubId: number; githubLogin: string; avatarUrl?: string | null }[],
  ): Promise<void>;
  removeBoardContributor(boardId: string, githubId: number): Promise<void>;
}
```

```typescript
// src/lib/ports/impact-repository.ts

import type {
  ImpactSummary,
  AuthorMetrics,
  ReviewerMetrics,
  ActivityData,
  DateRange,
  ClassificationAggregates,
  ClassifiedThreadsPage,
  ThreadMessage,
  IntentCategory,
  TechnicalDomain,
} from "@/types";

export interface ImpactRepository {
  getImpactSummary(boardId: string, githubId: number, dateRange: DateRange): Promise<ImpactSummary>;
  getAuthorMetrics(boardId: string, githubId: number, dateRange: DateRange): Promise<AuthorMetrics>;
  getReviewerMetrics(boardId: string, githubId: number, dateRange: DateRange): Promise<ReviewerMetrics>;
  getActivityData(boardId: string, githubId: number, dateRange: DateRange): Promise<ActivityData>;
  getClassificationAggregates(
    boardId: string,
    githubId: number,
    dateRange: DateRange,
  ): Promise<ClassificationAggregates>;
  getClassifiedThreads(
    boardId: string,
    githubId: number,
    dateRange: DateRange,
    filters: {
      intent?: IntentCategory;
      domain?: TechnicalDomain;
      pullRequestId?: number;
      role?: string;
      vote?: string;
    },
    page: number,
    pageSize: number,
  ): Promise<ClassifiedThreadsPage>;
  isThreadInBoard(boardId: string, threadRootCommentId: number): Promise<boolean>;
  getThreadMessages(threadRootCommentId: number): Promise<ThreadMessage[]>;
}
```

### 4.4 Adapter: `SupabaseAuthAdapter`

```typescript
// src/lib/adapters/supabase-auth.ts

import type { AuthPort } from "@/lib/ports/auth";
import type { AppUser } from "@/types";
import type { SupabaseClient } from "@/lib/supabase"; // ← only place that knows the type

export class SupabaseAuthAdapter implements AuthPort {
  constructor(private readonly client: SupabaseClient) {}

  async getUser(): Promise<AppUser | null> {
    const {
      data: { user },
    } = await this.client.auth.getUser();
    if (!user) return null;
    return { id: user.id, email: user.email ?? "" };
  }

  async signUp(email: string, password: string) {
    const { data, error } = await this.client.auth.signUp({ email, password });
    return {
      user: data.user ? { id: data.user.id, email: data.user.email ?? "" } : null,
      error: error?.message ?? null,
    };
  }

  async signIn(email: string, password: string) {
    const { error } = await this.client.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }

  async signOut() {
    await this.client.auth.signOut();
  }

  async updatePassword(newPassword: string) {
    const { error } = await this.client.auth.updateUser({ password: newPassword });
    return { error: error?.message ?? null };
  }

  async signInWithPassword(email: string, password: string) {
    const { error } = await this.client.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }
}
```

### 4.5 Adapter: `SupabaseBoardsRepository`

```typescript
// src/lib/adapters/supabase-boards.ts

import type { BoardsRepository } from "@/lib/ports/boards-repository";
import type { SupabaseClient } from "@/lib/supabase";

// All logic from today's boards.ts moved here —
// this adapter is the ONLY place that calls supabase.from("boards")
export class SupabaseBoardsRepository implements BoardsRepository {
  constructor(private readonly client: SupabaseClient) {}

  async getUserBoards(userId: string) {
    const { data, error } = await this.client
      .from("boards")
      .select("id,name,owner_user_id,created_at,updated_at")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data as BoardRow[]).map((row) => toUserBoard(row, userId));
  }
  // ... remaining methods from boards.ts
}
```

### 4.6 Single `SupabaseClient` type export

Instead of 7 copies, one place exports the type:

```typescript
// src/lib/supabase.ts (extension)

export type SupabaseClient = NonNullable<ReturnType<typeof createClient>>;
```

Adapters import from `@/lib/supabase`. The rest of the code does not see this type.

---

## 5. Isolation proof — before/after

### 5.1 Files knowing `@supabase/*` — BEFORE vs AFTER

| File                                  | Before                                         | After                                     | Change                                    |
| ------------------------------------- | ---------------------------------------------- | ----------------------------------------- | ----------------------------------------- |
| `src/env.d.ts`                        | `@supabase/supabase-js.User`                   | `import("./types").AppUser`               | **Cut off**                               |
| `src/lib/supabase.ts`                 | `@supabase/ssr`                                | `@supabase/ssr` + export `SupabaseClient` | Adapter (OK)                              |
| `src/lib/supabase-admin.ts`           | `@supabase/supabase-js`                        | `@supabase/supabase-js`                   | Adapter (OK)                              |
| `src/middleware.ts`                   | `createClient`, `.auth.getUser()`              | `SupabaseAuthAdapter` + `AppUser`         | **Cut off**                               |
| `src/lib/github.ts`                   | `SupabaseClient` (copy)                        | Import from `@/lib/supabase`              | **Cut off** (after extraction to adapter) |
| `src/lib/token-status.ts`             | `SupabaseClient` (copy)                        | Port `BoardsRepository` or inline         | **Cut off**                               |
| `src/lib/services/boards.ts`          | `SupabaseClient` (copy) + `.from()`            | `SupabaseBoardsRepository`                | **Moved to adapter**                      |
| `src/lib/services/impact-metrics.ts`  | `SupabaseClient` (copy) + `.from()` + `.rpc()` | `SupabaseImpactRepository`                | **Moved to adapter**                      |
| `src/lib/services/github-sync.ts`     | `SupabaseClient` (copy) + `.from()`            | `SupabaseSyncRepository`                  | **Moved to adapter**                      |
| `src/lib/services/classification.ts`  | `SupabaseClient` (copy) + `.from()` + `.rpc()` | `SupabaseClassificationRepository`        | **Moved to adapter**                      |
| `src/lib/services/homepage-stats.ts`  | `ServiceClient` (copy) + `.rpc()`              | `SupabaseStatsRepository`                 | **Moved to adapter**                      |
| `src/pages/api/github/sync/status.ts` | `SupabaseClient` (copy)                        | Port                                      | **Cut off**                               |
| ~10 `.astro` pages                    | `createClient` + `.from()`                     | Port injection                            | **Cut off**                               |
| ~15 API routes                        | `createClient` + `.auth.*` + `.from()`         | Port injection                            | **Cut off**                               |
| `src/worker.ts`                       | `createServiceClient` + `.from()` + `.rpc()`   | `SupabaseSyncRepository`                  | **Moved to adapter**                      |

**After the refactor, grep `@supabase/` returns only:**

1. `src/lib/supabase.ts` — cookie-based client factory (adapter)
2. `src/lib/supabase-admin.ts` — service-role client factory (adapter)
3. `src/lib/adapters/supabase-*.ts` — port implementations (adapters)

### 5.2 Before/after — UI layer (Astro page)

**BEFORE** (`src/pages/dashboard.astro`):

```astro
---
import { createClient } from "@/lib/supabase"; // ← knows Supabase
const supabase = createClient(Astro.request.headers, Astro.cookies);
if (!supabase) return Astro.redirect("/auth/signin"); // ← knows how to create client
const boards = await getUserBoards(supabase, user.id); // ← passes SupabaseClient
---
```

**AFTER**:

```astro
---
import type { BoardsRepository } from "@/lib/ports/boards-repository";
const repo = Astro.locals.boardsRepo; // ← port, not Supabase
const boards = await repo.getUserBoards(user.id); // ← domain data
---
```

### 5.3 Before/after — API layer

**BEFORE** (`src/pages/api/auth/signin.ts`):

```typescript
import { createClient } from "@/lib/supabase";
const supabase = createClient(context.request.headers, context.cookies);
const { error } = await supabase.auth.signInWithPassword({ email, password });
```

**AFTER**:

```typescript
const auth = context.locals.auth; // AuthPort
const { error } = await auth.signIn(email, password);
```

### 5.4 Before/after — service layer

**BEFORE** (`src/lib/services/impact-metrics.ts:131`):

```typescript
export async function getImpactSummary(
  supabase: SupabaseClient, // ← knows Supabase
  boardId: string,
  githubId: number,
  dateRange: DateRange,
): Promise<ImpactSummary> {
  const { data, error } = await supabase
    .from("github_repos") // ← table name in domain layer
    .select("id")
    .eq("board_id", boardId);
  // ... 100+ lines of domain logic interleaved with .from()/.rpc()
}
```

**AFTER** — domain logic in service, queries in adapter:

```typescript
// Port (src/lib/ports/impact-repository.ts):
export interface ImpactRepository {
  getImpactSummary(boardId: string, githubId: number, dateRange: DateRange): Promise<ImpactSummary>;
}

// Service (src/lib/services/impact-metrics.ts):
export function getImpactSummary(
  repo: ImpactRepository, // ← port, not Supabase
  boardId: string,
  githubId: number,
  dateRange: DateRange,
): Promise<ImpactSummary> {
  return repo.getImpactSummary(boardId, githubId, dateRange);
}

// Adapter (src/lib/adapters/supabase-impact.ts):
// ... all query builder logic moved here
```

### 5.5 Library replacement — what changes

| Scenario                                 | Before ACL                                                   | After ACL                                      |
| ---------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------- |
| Replace Supabase Auth with Clerk/Auth.js | `env.d.ts` + `middleware.ts` + `supabase.ts` + 15 API routes | `src/lib/adapters/clerk-auth.ts` (new adapter) |
| Replace PostgREST with Drizzle ORM       | 6 services + `worker.ts` + 10 pages                          | `src/lib/adapters/drizzle-*.ts` (new adapters) |
| Replace Supabase with Firebase           | All 33 files                                                 | 3 adapter files                                |

---

## 6. Coordination with `02-invariant-aggregate-refactor.md`

### 6.1 The tension

Document `02` proposes a new domain module `src/lib/domain/contributor-profile-repo.ts` that **directly imports Supabase** and introduces an 8th copy of the `SupabaseClient` type alias:

```typescript
// 02-invariant-aggregate-refactor.md §4.3, lines 334-338
import type { createClient } from "@/lib/supabase";
type SupabaseClient = NonNullable<ReturnType<typeof createClient>>;
```

It also calls the query builder directly inside the domain layer:

<!-- prettier-ignore -->
```typescript
// §4.3, line 357
supabase.from("board_contributors").select("github_id")...
```

This contradicts the goal of this document: Supabase should not exist outside adapters. Creating a NEW file in `src/lib/domain/` with a Supabase dependency deepens the very problem this ACL plan aims to solve.

However, the contradiction is **structural, not logical**. The `ContributorProfileAccess.resolve()` aggregate itself is pure domain logic — it accepts plain interfaces (`BoardInfo`, `ContributorRow`, `CallerGitHubIdentity`) and knows nothing about Supabase. The problem is only in the repository (`contributor-profile-repo.ts`), which is de facto a Supabase adapter placed in the domain directory.

### 6.2 Resolution: Path A (02 first, then ACL)

The recommended sequencing:

1. **Implement 02 as designed** — its immediate value is security: centralizing INV-09 ("Contributor can only view their own Contribution Profile") from 9 copy-paste sites into one aggregate. This is a higher-priority fix than dependency isolation.

2. **Then implement this ACL plan.** During Phase 3 (persistence ports + adapters), refactor `contributor-profile-repo.ts`:
   - Move it from `src/lib/domain/` to `src/lib/adapters/supabase-profile-access.ts`.
   - Replace the inline `SupabaseClient` copy with the canonical export from `@/lib/supabase`.
   - Have `ContributorProfileAccess.resolve()` (pure domain, stays in `src/lib/domain/`) be called by the adapter.

This way:

- 02 ships fast with its security win (INV-09 centralization).
- This ACL plan later absorbs 02's repository into the adapter layer, closing the Supabase leak.
- No work is thrown away — the aggregate code from 02 is kept intact, only the repository's location and import style change.

---

## 7. Verification and phased plan

### 7.1 Success criterion

```bash
grep -rn "@supabase/" src/ --include="*.ts" --include="*.tsx" --include="*.astro" \
  | grep -v "src/lib/supabase" \
  | grep -v "src/lib/adapters/"
# Expected result: 0 lines
```

### 7.2 Files knowing Supabase today vs after refactor

**Today (33 files):**
`env.d.ts`, `supabase.ts`, `supabase-admin.ts`, `middleware.ts`, `github.ts`, `token-status.ts`, `boards.ts`, `classification.ts`, `github-sync.ts`, `impact-metrics.ts`, `homepage-stats.ts`, `sync/status.ts`, `worker.ts`, ~10 pages, ~15 API routes.

**After refactor (8 files — factories + adapters):**
`supabase.ts` (factory), `supabase-admin.ts` (admin factory), `src/lib/adapters/supabase-auth.ts`, `src/lib/adapters/supabase-boards.ts`, `src/lib/adapters/supabase-impact.ts`, `src/lib/adapters/supabase-sync.ts`, `src/lib/adapters/supabase-classification.ts`, `src/lib/adapters/supabase-stats.ts`.

Total 8 files (factories + adapters), instead of 33 files scattered across the entire codebase.

### 7.3 Phased plan

Following project conventions (branch `change/<id>`, PR to `main`), migration in 4 phases, each with its own PR:

#### Phase 1: `AppUser` type + `SupabaseClient` export (PR #1, low difficulty)

1. Add `AppUser` to `src/types.ts`.
2. Export `SupabaseClient` from `src/lib/supabase.ts` — remove 7 copies.
3. Change `src/env.d.ts:3` to `import("./types").AppUser`.
4. Change `src/middleware.ts` — map `supabase.auth.getUser()` → `AppUser`.
5. Update pages/API routes that read `user.id` (no changes — `AppUser.id` is a string as before).
6. Verification: `tsc --noEmit` + `npm test` (no regressions).

**Risk:** Low — type changes only, no logic changes. Backward-compatible with existing tests.

#### Phase 2: `AuthPort` port + adapter (PR #2, medium difficulty)

1. Create `src/lib/ports/auth.ts` with `AuthPort`.
2. Create `src/lib/adapters/supabase-auth.ts` with `SupabaseAuthAdapter`.
3. Add `auth: AuthPort` to `App.Locals` (alongside `user`).
4. Middleware creates adapter and attaches to `locals`.
5. Migrate auth API routes (`signin`, `signup`, `signout`, `password`) to `context.locals.auth`.
6. Verification: hermetic auth tests + `tsc --noEmit`.

#### Phase 3: Persistence ports + adapters (PR #3, high difficulty)

1. Create ports: `BoardsRepository`, `ImpactRepository`, `SyncRepository`, `ClassificationRepository`.
2. Create adapters in `src/lib/adapters/supabase-*.ts` — move query builder logic from `src/lib/services/`.
3. Services become a thin layer delegating to the port.
4. Middleware/worker create adapters and inject into services.
5. If `02-invariant-aggregate-refactor.md` has been implemented: move `contributor-profile-repo.ts` from `src/lib/domain/` to `src/lib/adapters/supabase-profile-access.ts` (see §6.2).
6. Verification: full `npm test` + `npm run build`.

**Note:** This phase is the largest. It can be split into sub-PRs per service (boards → impact → sync → classification).

#### Phase 4: Page migration and cleanup (PR #4, medium difficulty)

1. Astro pages no longer create `supabase = createClient(...)` — they use ports from `Astro.locals`.
2. API routes no longer import `createClient` — they use ports from `context.locals`.
3. `worker.ts` creates adapters at the `createServiceClient` point.
4. Final verification: `grep "@supabase/" src/` returns only factories + adapters.
5. Remove dead imports, update CLAUDE.md.

### 7.4 Open questions

1. **Port injection in Astro**: Astro has no built-in DI container. Middleware can create adapters and attach them to `context.locals` — the simplest pattern (already used with `user`). Requires extending `App.Locals` in `env.d.ts`.

2. **Worker context**: `worker.ts` uses `createServiceClient` (admin client), not the cookie-based client. Needs a separate adapter creation point in `WorkflowEntrypoint.run()`.

3. **`homepage-stats.ts`**: Uses `ServiceClient` (admin), not `SupabaseClient` (user). Separate port/adapter with its own factory.

4. **Relationship with C1 and C2 from refactor-opportunities**: C1 (Workflow contract) and C2 (row-shape type bridge) are orthogonal refactors. The ACL neither blocks nor is blocked by them. C3 (7x `SupabaseClient`) is **subsumed** by Phase 1 of this plan.

---

## Summary

Supabase is the worst leaking dependency in GitGud — 33 files across 6 layers, with the `@supabase/supabase-js.User` type in the global contract and the query builder penetrating the service layer. The lack of auth/persistence separation through the same client object doubles the coupling. The ACL design introduces a domain `AppUser` (distinct from `UserProfile` — see §4.1), ports (`AuthPort`, `BoardsRepository`, `ImpactRepository`), and Supabase adapters — after migration, grep `@supabase/` returns only 8 adapter files instead of 33 scattered across the entire codebase. The plan splits work into 4 phases (type → auth → persistence → cleanup), with Phase 1 as a low-risk Quick Win that already eliminates C3 from the existing refactor analysis. The plan coordinates with `02-invariant-aggregate-refactor.md` via Path A (§6): implement 02 first for its security win, then absorb its Supabase-dependent repository into the adapter layer during Phase 3.
