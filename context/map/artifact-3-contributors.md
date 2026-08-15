# Contributors Map — Authorship & Expertise Analysis

> Generated: 2026-07-28 | Data range: 2026-05-21 – 2026-07-28 | 254 commits total
> Complements: `artifact-1-territory.md` (git activity), `artifact-2-structure.md` (static structure)

## 1. Contributor Roster

**Single human author.** All 254 commits originate from one person under three git identity variants:

| Identity | Commits | Context |
|---|---|---|
| `sierpinski.tomasz@gmail.com` / "Tomasz Sierpinski" | 162 | Local machine (ASCII) |
| `sierpinski.tomasz@gmail.com` / "Tomasz Sierpiński" | 79 | Local machine (Unicode) |
| `t.sierpinski@proprogres.org.pl` / "Tomasz Sierpiński" | 13 | Secondary environment/account |

**AI co-authors (filtered out):** 227 commits carry `Co-Authored-By: Claude` (Sonnet 4.6, Opus 4.6, Opus 4.7, Sonnet 5). No other humans appear in the commit graph.

## 2. Thematic Expertise Map

For each of the five risk areas identified in `artifact-1-territory.md` and `artifact-2-structure.md`, the depth of the sole contributor's knowledge and the onboarding risk for any future contributor.

### Area 1 — Hardcoded `fetch()` URL coupling (25 calls, 11 components)

**Depth: medium.** Author of all components with `fetch()` calls and the route that already changed once (PR #32: `boards/` → `board/` singular). Understands the mechanism; no tooling enforces safe renaming.

Representative commits: `feat: link board to GitHub org — 2-screen wizard + linked repos display (#22)`, `feat(manage-ic-roster): API Routes — settings, repos, contributors`.

### Area 2 — `boards.ts` (fan-in 14, zero dedicated tests)

**Depth: high; test gaps are deliberate.** The service evolved across 9 commits: basic CRUD (`feat: link board to GitHub org`), access control (`feat(access-control-and-membership): schema, RLS & app helpers`), invitations (`feat(S-03): invite contributors during board creation`), deletion (`feat(delete-board): API route + delete component`). Missing tests stem from Supabase query-chain mock complexity, not from lack of familiarity with the code.

Representative commits: `feat: link board to GitHub org (#22)`, `feat(access-control-and-membership)`, `feat(S-03): invite contributors during board creation (#28)`, `feat(delete-board)`.

### Area 3 — `types.ts` (invisible `import type` cascade across 19 files)

**Depth: high.** Types changed with every major feature: GitHub metrics (#32), classification (#33), PAT storage (#40), vote/flag (`flag-classification-inaccurate p2`). Author knows the semantic intent behind every exported shape. The risk is structural — tooling (`lint:deps`) does not catch type-cascade breaks; only `tsc --noEmit` does.

Representative commits: `feat: contribution profile with raw GitHub metrics (#32)`, `feat(classification-batch)`, `feat: per-user PAT storage, profile settings page (#40)`.

### Area 4 — `github.ts` + `SyncIndicator.tsx` (zero tests, security-critical)

**Depth: very high, especially PAT security.** The most security-sensitive area. PAT encryption/decryption, non-leakage testing, and Octokit retry strategy were built iteratively across multiple phases.

Key commit clusters:
- PAT storage & infrastructure: `feat(github-ingestion-access): schema & token infrastructure (p1)`, `feat(github-ingestion-access): GitHub API client factory with retry & rate-limit (p2)`, `feat(github-ingestion-access): fetch service & integration verification (p3)`
- PAT non-leakage tests: `feat(testing-access-boundary): PAT non-leakage tests (p3)`, `fix(testing-access-boundary): apply impl-review fixes`
- Leakage fix in Workflow: `fix(worker): prevent PAT leak in Workflow output + diagnostic logs`
- Throttle/retry: `fix(worker): add @octokit/plugin-throttling + adaptive GQL batch splitting (#66)`, `fix(github): remove AbortSignal override that broke GQL after step.sleep`

`SyncIndicator.tsx` has zero tests; the polling pattern requires `vi.useFakeTimers()` and has never been set up.

### Area 5 — `github-sync.ts` + `worker.ts` (67 changes, merge bottleneck)

**Depth: extremely high — and extremely hard to transfer.** Over 30 commits resolved a single compound problem: Cloudflare Workers constraints (50-subrequest budget per Workflow step, secondary GitHub rate limits, GraphQL batching timeouts). The iteration history encodes decisions that are not written down anywhere:

| Iteration | Commit |
|---|---|
| REST → GraphQL batching | `fix(worker): replace per-PR REST calls with GraphQL batching in syncPrBatch (#44)` |
| Supabase write batching | `fix(worker): batch Supabase writes, fix error serialization (#47, #48)` |
| Review overflow pagination | `fix(worker): paginate review comments by date (#49)`, `perf(worker): batch review overflow pages (#50)` |
| Subrequest budget resets | `fix(worker): reset subrequest budget with step.sleep between phases (#53, #54)` |
| Per-repo workflow splitting | `fix(worker): split workflow into chained per-repo instances (#55)` |
| GQL timeout tuning | `fix(github-sync): reduce GQL_PRS_PER_QUERY to 25 (#62)`, `set to 100 (#64)` |
| Adaptive throttle backoff | `fix(worker): adaptive GQL throttle backoff (#63)`, `add @octokit/plugin-throttling (#66)` |
| Poison batch splitting | `fix(worker): wall-clock deadline + single-PR splitting for poison GQL batches` |
| Full revert + rethink | `revert: undo PR #67 + disable Workflows retries (#68)` |
| Chunk orchestration rebuild | `feat(bugfix): rebuild workflow orchestration (p1)` |

Anyone working in this area needs a context transfer session — not just a code read.

## 3. Onboarding Risk Matrix

| Area | Sole contributor depth | Risk for a new contributor |
|---|---|---|
| Worker/sync orchestration | ★★★★★ | Very high — unwritten context, complex CF limits |
| PAT security / `github.ts` | ★★★★★ | High — security decisions undocumented |
| `types.ts` type cascade | ★★★★☆ | Low — structural problem, not knowledge gap |
| `boards.ts` (no tests) | ★★★★☆ | Medium — no safety net for changes |
| `fetch()` URL coupling | ★★★☆☆ | Low — tooling problem, not knowledge gap |

## 4. Operational Conclusion

There are no other contributors to contact. The project is solo-built. The relevant question for future scaling is: **in which areas does onboarding a new contributor require a knowledge transfer session vs. a tooling fix?**

- **Requires explicit knowledge transfer:** Areas 4 and 5 (Cloudflare Workers constraints, PAT security decisions, GQL tuning history).
- **Requires tooling fix first:** Areas 1 and 3 (`fetch()` URL registry, `tsc` enforcement in CI before type changes).
- **Requires test coverage before safe handoff:** Area 2 (`boards.ts` hermetic suite, `SyncIndicator.tsx` timer-based tests).
