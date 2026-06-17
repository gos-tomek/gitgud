---
date: 2026-06-15T18:00:00+02:00
researcher: Claude (AI)
git_commit: 4d56a4f7eb0e1fffe0707c91761f8a4cec7a0f51
branch: main
repository: gitgud
topic: "Profile metrics: internal inventory, competitive landscape, and cost mapping"
tags: [research, metrics, profile, competitive-analysis, s-04]
status: complete
last_updated: 2026-06-16
last_updated_by: Claude (AI)
last_updated_note: "Follow-up: data visualization library research — Recharts via shadcn/ui + custom SVG heatmap"
---

# Research: Profile Metrics — What to Show, What Competitors Show, What We Can Afford

**Date**: 2026-06-15T18:00:00+02:00
**Researcher**: Claude (AI)
**Git Commit**: 4d56a4f
**Branch**: main
**Repository**: gitgud

## Research Question

Three questions from the frame brief (`frame.md`):

1. What metrics do we already have defined (PRD + data in DB)?
2. What metrics does the competition show on individual developer profiles?
3. Which competitor metrics can we cheaply implement with data we already fetch or plan to fetch?

## Summary

**We can deliver a compelling profile with one small migration.** The existing 4 GitHub tables support 20+ derivable metrics — well beyond the PRD floor of 3. Competitors cluster into two tiers: throughput counters (GitHub native, Haystack, Athenian) and behavioral/quality analyzers (LinearB, Pluralsight Flow, Swarmia). GitGud's PRD positioning — semantic review quality, not throughput — aligns with the second tier.

**Key insight: threads, not comments.** Instead of counting individual comments (what all competitors do), GitGud measures _review threads_ — discussions anchored to a code location. A thread with 8 messages is an architectural debate; 8 single comments are nitpicks. Thread-level metrics (count, depth, discussion ratio, multi-person threads) tell a richer story about review quality and are unique to GitGud. This requires adding `in_reply_to_id` to `github_review_comments` — one column, already in the API response, not stored.

Adding `in_reply_to_id` + `additions`/`deletions`/`changed_files` in a single CHEAP migration unlocks both thread metrics and PR size (table stakes across all competitors).

---

## 1. Internal Metrics Inventory

### 1.1 PRD-defined metrics (the floor)

| PRD ref | Metric             | Spec         |
| ------- | ------------------ | ------------ |
| FR-009  | PRs authored       | count + list |
| FR-010  | Code reviews given | count + list |
| FR-011  | Review comments    | count        |

These three are the _must-have_ minimum. Everything below is expansion opportunity.

### 1.2 Data available in existing DB tables

Four tables populated by `syncBoardGitHubData()` (`src/lib/services/github-sync.ts`):

| Table                    | Key columns for metrics                                                                                                                           | Row count driver |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `github_pull_requests`   | `state`, `is_draft`, `author_github_id`, `created_at`, `merged_at`                                                                                | ≤200 per repo    |
| `github_reviews`         | `state` (APPROVED/CHANGES_REQUESTED/COMMENTED/DISMISSED), `reviewer_github_id`, `submitted_at`                                                    | per PR           |
| `github_review_comments` | `commenter_github_id`, `body`, `path`, `position_line`, `created_at`. **Missing:** `in_reply_to_id` (needed for thread reconstruction — see §1.4) | per PR           |
| `board_contributors`     | `github_id`, `github_login`, `avatar_url`                                                                                                         | per board        |

Join path: `board_contributors.github_id` → `github_pull_requests.author_github_id` / `github_reviews.reviewer_github_id` / `github_review_comments.commenter_github_id`.

### 1.3 Derivable metrics — FREE (no schema changes)

#### As PR author (submitter side)

| Metric                                    | Derivation                                | Comparable to                               |
| ----------------------------------------- | ----------------------------------------- | ------------------------------------------- |
| **PRs authored** (count)                  | `COUNT(gpr) WHERE author_github_id = :id` | LinearB PRs Opened, Flow, all               |
| **PRs by state** (open / merged / closed) | `GROUP BY state`                          | Flow Player Card, Haystack                  |
| **Draft PRs** (count)                     | `WHERE is_draft = true`                   | — (uncommon)                                |
| **Merge rate**                            | `merged / (merged + closed)`              | —                                           |
| **Time to merge** (median, P75, P90)      | `merged_at - created_at`                  | LinearB, Swarmia Cycle Time, Flow, Athenian |
| **PR activity timeline**                  | `created_at` histogram by week/month      | All competitors                             |
| **PRs per repository**                    | `GROUP BY repo_id`                        | LinearB Top Repos                           |

#### As reviewer

| Metric                                     | Derivation                                                  | Comparable to                                                                 |
| ------------------------------------------ | ----------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Reviews given** (count)                  | `COUNT(gr) WHERE reviewer_github_id = :id`                  | LinearB Reviews Conducted                                                     |
| **Reviews by verdict**                     | `GROUP BY state` (APPROVED / CHANGES_REQUESTED / COMMENTED) | — (few competitors break this down)                                           |
| **Unique PRs reviewed**                    | `COUNT(DISTINCT pull_request_id)`                           | —                                                                             |
| **Pickup time** (time to first review)     | `MIN(gr.submitted_at) - gpr.created_at` per PR              | LinearB Pickup Time, Swarmia Time to First Review, Flow Time to First Comment |
| **Review depth** (threads per reviewed PR) | `COUNT(threads) / COUNT(DISTINCT reviewed PRs)`             | LinearB Review Depth (but thread-based, richer)                               |
| **Involvement** (% of team PRs reviewed)   | reviewed PRs / total board PRs (excl. own)                  | Flow Involvement                                                              |
| **Review activity timeline**               | `submitted_at` histogram by week/month                      | All                                                                           |

#### Collaboration / cross-table

| Metric                   | Derivation                                           | Comparable to                            |
| ------------------------ | ---------------------------------------------------- | ---------------------------------------- |
| **Engagement ratio**     | reviews given / PRs authored                         | Swarmia PR ratio                         |
| **Unique collaborators** | `COUNT(DISTINCT author_github_id)` from PRs reviewed | Swarmia Collaborators, Flow Review Radar |
| **Repo breadth**         | distinct repos reviewed across                       | LinearB Knowledge Areas (lighter)        |

**Total FREE metrics: 17** — far exceeding the PRD floor of 3.

### 1.4 Metrics available with CHEAP schema extension

One migration, two tables, zero extra API calls — all data is already in the GitHub API response but not stored.

#### On `github_pull_requests` (3 columns)

| Metric                            | What's needed                                                          | Comparable to                                                          |
| --------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **PR size** (lines added/deleted) | Add `additions int`, `deletions int`; on Octokit `pulls.list` response | LinearB PR Size, Swarmia Batch Size, Flow, Haystack — **table stakes** |
| **Changed files count**           | Add `changed_files int` (also on PR response)                          | Flow Impact (lighter version)                                          |

#### On `github_review_comments` (1 column → unlocks thread metrics)

| Column                  | What it does                                                                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `in_reply_to_id bigint` | References the root comment's ID. Present on every item from `pulls.listReviewComments`. A comment with `in_reply_to_id IS NULL` starts a thread; non-null means it's a reply. |

With `in_reply_to_id`, we reconstruct **review threads** — the natural unit of code review discussion. This replaces raw comment counts with richer signals:

#### Thread metrics (CHEAP — all derivable once `in_reply_to_id` is stored)

| #   | Metric                             | Derivation                                                                       | Signal                                                                                                                                                                                                      | Comparable to                                           |
| --- | ---------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| T1  | **Threads started**                | `COUNT(grc) WHERE in_reply_to_id IS NULL AND commenter = :id`                    | How many code discussions this person initiates as a reviewer                                                                                                                                               | FR-011 reinterpreted; LinearB Review Depth (richer)     |
| T2  | **Threads participated in**        | `COUNT(DISTINCT thread_root) WHERE commenter = :id`                              | Breadth of review engagement — includes replies to others' threads                                                                                                                                          | — (unique to GitGud)                                    |
| T3  | **Avg thread depth**               | `AVG(replies_per_thread)` across threads started by this person                  | Whether this person's reviews spark meaningful discussion or just one-liners                                                                                                                                | — (unique to GitGud)                                    |
| T4  | **Discussion-sparking ratio**      | threads with ≥1 reply / total threads started                                    | What fraction of review comments lead to actual conversation                                                                                                                                                | — (unique to GitGud)                                    |
| T5  | **Deep discussions** (3+ messages) | `COUNT(threads) WHERE message_count >= 3` involving this person                  | Substantive back-and-forth — architecture debates, design tradeoffs                                                                                                                                         | — (unique to GitGud)                                    |
| T6  | **Multi-person threads**           | threads with ≥2 distinct `commenter_github_id` involving this person             | Real discussion (multiple perspectives) vs monologue (reviewer talks to self)                                                                                                                               | — (unique to GitGud)                                    |
| T7  | **Thread resolution signal**       | threads on this person's PR where last message is by PR author                   | Indicates the author engaged with feedback (addressed, acknowledged, or pushed back). Heuristic — GitHub exposes true `isResolved` only via GraphQL (see §1.6); REST-based heuristic is good enough for MVP | Flow Receptiveness (lighter, no commit tracking needed) |
| T8  | **Avg first-reply time**           | `AVG(first_reply.created_at - root.created_at)` for threads on this person's PRs | How quickly the PR author responds to review feedback                                                                                                                                                       | Flow Responsiveness (equivalent)                        |
| T9  | **Inline thread ratio**            | threads with `path IS NOT NULL` / total threads                                  | Code-anchored discussion vs general comments — inline = more specific, higher signal                                                                                                                        | — (unique to GitGud)                                    |
| T10 | **Threads per reviewed PR**        | threads started / distinct PRs reviewed                                          | Thread-based review depth — richer than raw comment count                                                                                                                                                   | LinearB Review Depth, but thread-aware                  |

#### Why threads > comments

| Dimension                            | Raw comment count                       | Thread metrics                                                                          |
| ------------------------------------ | --------------------------------------- | --------------------------------------------------------------------------------------- |
| "Is this reviewer thorough?"         | 20 comments = thorough? Or 20 nitpicks? | 8 threads with avg depth 2.5 = substantive discussion                                   |
| "Does feedback get addressed?"       | Can't tell                              | Thread resolution signal (T7) + first-reply time (T8)                                   |
| "Is this real discussion?"           | Can't tell                              | Multi-person threads (T6) + deep discussions (T5)                                       |
| "Does this reviewer spark thinking?" | Can't tell                              | Discussion-sparking ratio (T4) = what % of feedback leads to conversation               |
| S-05 readiness                       | Category per comment (flat)             | Category per thread (richer — a thread about architecture vs a thread about nitpicking) |

**No competitor uses thread-level metrics.** LinearB and Flow measure "comments per PR" (flat count). GitGud's thread pivot is a genuine differentiator that aligns with the product's "semantic quality, not volume" positioning.

**Recommendation**: Add `in_reply_to_id` to `github_review_comments` and `additions`, `deletions`, `changed_files` to `github_pull_requests` in a single migration as part of S-04. All data is already in the API response — the sync service just doesn't store it.

### 1.5 Metrics that are EXPENSIVE (not for S-04)

| Metric                                      | What's needed                                           | Why expensive                        | Competitor                           |
| ------------------------------------------- | ------------------------------------------------------- | ------------------------------------ | ------------------------------------ |
| Code churn / rework / efficiency            | Commit-level diff analysis over time, HALOC computation | Heavy compute, new data model        | Flow only                            |
| Knowledge Areas (file-level expertise)      | File-level commit history per contributor               | New table + heavy backfill           | LinearB                              |
| DORA Deploy Frequency / MTTR                | CI/CD deployment event integration                      | External system                      | LinearB, Swarmia, Haystack, Athenian |
| Sprint metrics (velocity, predictability)   | Jira integration                                        | Out of scope (PRD non-goal)          | Haystack, Swarmia                    |
| Investment balance                          | Issue categorization (Jira/Linear)                      | Out of scope                         | Swarmia, Haystack                    |
| Active Days (commit-level)                  | Store individual commits, not just PRs                  | New table + API calls                | Flow                                 |
| Receptiveness / follow-on commits           | Track commits that happen after review comments         | New data model                       | Flow only                            |
| Wellness Workload (concurrent work streams) | Branch-level work tracking                              | New data model                       | LinearB only                         |
| Developer Experience surveys                | Survey infrastructure                                   | Completely different product surface | Swarmia, DX                          |

### 1.6 Thread resolution: REST heuristic vs GraphQL `isResolved`

GitHub's UI has a "Resolve conversation" button on review threads. The resolved state is available **only via GraphQL** (`PullRequestReviewThread.isResolved` + `resolvedBy`). The REST API (`pulls.listReviewComments`) does not expose it.

**Decision: stay on REST for S-04.** The current sync uses `octokit.rest.pulls.listReviewComments`. Adding `in_reply_to_id` (already on every REST response item) is a 1-column, 1-line change. Thread resolution (T7) uses a heuristic: "last comment in thread is by the PR author" ≈ author engaged with the feedback.

**Future option (not S-04):** Add a supplementary GraphQL query after REST sync to fetch `reviewThreads { isResolved, resolvedBy }` per PR and store a `is_resolved boolean` column. This gives true resolved status but adds API complexity and a new query path. Alternatively, migrate the entire comment sync to GraphQL where threads are first-class objects (`pullRequest.reviewThreads.comments`). Either option is a follow-up — the heuristic is sufficient for MVP and the UI won't need to change when true `isResolved` is added later.

---

## 2. Competitive Landscape

### 2.1 Platform profiles compared

| Platform             | Has individual profile?        | Philosophy                             | Strongest signal                                    |
| -------------------- | ------------------------------ | -------------------------------------- | --------------------------------------------------- |
| **Pluralsight Flow** | Yes ("Player Card")            | Behavioral analysis for 1:1 coaching   | Review quality (Influence, Receptiveness, Coverage) |
| **LinearB**          | Yes ("Developer Coaching")     | Comprehensive measurement + automation | Submitter/Reviewer radar chart                      |
| **Swarmia**          | Partial ("Developer Overview") | Privacy-first, team autonomy           | Collaborators, investment balance                   |
| **Haystack**         | No (team-filtered)             | Team empowerment, actionable DORA      | Sprint diagnostics, custom boards                   |
| **Athenian**         | No (team-filtered)             | Pipeline optimization                  | 4-stage PR cycle time decomposition                 |
| **GitHub native**    | Yes (contribution profile)     | Public activity signal                 | Contribution calendar heatmap                       |

### 2.2 What the best profiles show (tier 2 — behavioral analyzers)

**Pluralsight Flow Player Card** (richest individual profile):

- Submit fundamentals: Time to Merge, Responsiveness, Comments Addressed, Receptiveness, Unreviewed PRs
- Review fundamentals: Time to First Comment, Reaction Time, Involvement, Influence, Review Coverage
- Coding: Active Days, Commits/Day, Impact, Efficiency, Churn, New Work, Rework, Legacy Refactor
- Visualizations: Quartile positioning vs team, activity heatmap, Review Radar (scatter plot)

**LinearB Developer Coaching** (most actionable):

- DevEx wait times: Pickup, Merge, Deploy wait times with period-over-period comparison
- Radar chart: 6-axis (PRs Opened, PR Size, PR Maturity × Reviews Conducted, Review Depth, Pickup Time)
- Wellness Workload: concurrent work stream timeline (burnout detector)
- Knowledge Areas: codebase expertise map

**Swarmia Developer Overview** (most privacy-conscious):

- Activity: projects/epics contributed to, work log timeline
- Focus: investment balance (features / improvements / productivity / KTLO)
- Pull Requests: authored vs reviewed ratio
- Collaborators: who this person works with most (designed for 360 feedback)
- Individual data visible only to that developer — managers see team-level only

### 2.3 Common patterns across all competitors

Every platform with a contributor profile shows:

1. **PR count** (authored and/or merged)
2. **Review count** (given)
3. **Some form of cycle time** (PR open → merge)
4. **Activity over time** (trend chart or timeline)

Most also show: 5. **PR size** (lines changed) — table stakes 6. **Time to first review** (pickup time) 7. **Comments per PR** (review depth) — all competitors use flat comment counts; none reconstruct threads

Differentiators (only 1-2 platforms each): 8. Review quality behavioral metrics (Flow: Influence/Receptiveness, LinearB: Radar) 9. Collaboration graph (Swarmia: Collaborators, Flow: Review Radar) 10. Workload/wellness signals (LinearB: Wellness Workload) 11. Code quality signals (Flow: Churn/Efficiency/Rework)

### 2.4 GitGud's positioning gap

From `context/archive/discovery/market-research.md`:

> "Most tools only count quantity of comments rather than semantic quality or pedagogical value."

No competitor classifies review comments by intent, and **no competitor thinks in threads**. Every tool counts flat comments. GitGud has two stacked differentiators:

1. **S-04 differentiator — thread metrics**: Discussion-sparking ratio, deep discussions, multi-person threads, thread resolution. These surface review _quality_ from structure alone, without AI.
2. **S-05 differentiator — semantic classification**: Classifying threads (not individual comments) by intent (mentoring, architecture, bug-catch, nitpick, unblocking, question). The thread is the natural unit of classification — one topic per thread.

S-04's thread metrics profile becomes the **foundation** that S-05 overlays with per-thread semantic categories.

---

## 3. Cost Mapping — Competitor Metrics vs Our Data

### 3.1 Full mapping table

| Metric                               | Seen in                                             | Our cost      | Notes                                                |
| ------------------------------------ | --------------------------------------------------- | ------------- | ---------------------------------------------------- |
| PRs authored (count + list)          | All                                                 | **FREE**      | FR-009                                               |
| PRs by state (open/merged/closed)    | Flow, Haystack                                      | **FREE**      |                                                      |
| Reviews given (count + list)         | All                                                 | **FREE**      | FR-010                                               |
| Reviews by verdict                   | — (unique)                                          | **FREE**      | APPROVED/CHANGES_REQUESTED/COMMENTED                 |
| Time to merge (median/P75/P90)       | All                                                 | **FREE**      | `merged_at - created_at`                             |
| Pickup time (time to first review)   | LinearB, Swarmia, Flow, Athenian                    | **FREE**      | `MIN(review.submitted_at) - pr.created_at`           |
| Review depth (threads/reviewed PR)   | LinearB, Flow (comment-based; ours is thread-based) | **FREE**      | Requires `in_reply_to_id` (CHEAP) for thread version |
| Involvement (% team PRs reviewed)    | Flow                                                | **FREE**      |                                                      |
| Unique collaborators                 | Swarmia, Flow                                       | **FREE**      |                                                      |
| Engagement ratio (reviews/PRs)       | Swarmia                                             | **FREE**      |                                                      |
| Repo breadth                         | LinearB (lighter)                                   | **FREE**      |                                                      |
| Merge rate                           | —                                                   | **FREE**      |                                                      |
| Draft PRs                            | —                                                   | **FREE**      |                                                      |
| Activity timeline (PR/review/thread) | All                                                 | **FREE**      | Histogram by week/month                              |
| PR size (lines added/deleted)        | All except GitHub native                            | **CHEAP**     | `additions`/`deletions` on `github_pull_requests`    |
| Changed files count                  | Flow (Impact, lighter)                              | **CHEAP**     | Same migration                                       |
| Threads started                      | — (unique)                                          | **CHEAP**     | `in_reply_to_id` on `github_review_comments`         |
| Avg thread depth                     | — (unique)                                          | **CHEAP**     | Same column                                          |
| Discussion-sparking ratio            | — (unique)                                          | **CHEAP**     | Same column                                          |
| Deep discussions (3+ msgs)           | — (unique)                                          | **CHEAP**     | Same column                                          |
| Multi-person threads                 | — (unique)                                          | **CHEAP**     | Same column                                          |
| Thread resolution signal             | Flow Receptiveness (lighter)                        | **CHEAP**     | Same column                                          |
| Avg first-reply time                 | Flow Responsiveness (equivalent)                    | **CHEAP**     | Same column                                          |
| Inline thread ratio                  | — (unique)                                          | **CHEAP**     | Same column                                          |
| Threads per reviewed PR              | LinearB Review Depth (richer)                       | **CHEAP**     | Same column                                          |
| Code churn / rework / efficiency     | Flow only                                           | **EXPENSIVE** | Commit-level diff analysis                           |
| Knowledge Areas (file expertise)     | LinearB                                             | **EXPENSIVE** | File-level commit history                            |
| DORA (Deploy Freq, MTTR, CFR)        | LinearB, Swarmia, Haystack, Athenian                | **EXPENSIVE** | CI/CD integration                                    |
| Sprint metrics                       | Haystack, Swarmia                                   | **EXPENSIVE** | Jira integration (PRD non-goal)                      |
| Wellness Workload                    | LinearB                                             | **EXPENSIVE** | Branch-level tracking                                |
| Receptiveness / Influence (full)     | Flow only                                           | **EXPENSIVE** | Follow-on commit tracking                            |
| Investment balance                   | Swarmia                                             | **EXPENSIVE** | Issue categorization                                 |

### 3.2 Cost summary

| Cost tier                      | Count       | Coverage                                                           |
| ------------------------------ | ----------- | ------------------------------------------------------------------ |
| **FREE** (existing data)       | 14 metrics  | PR author + reviewer behavioral signals + collaboration            |
| **CHEAP** (4-column migration) | +12 metrics | PR size (table stakes) + 10 thread metrics (GitGud differentiator) |
| **EXPENSIVE**                  | 7+ metrics  | External-data metrics — not S-04 scope                             |

The CHEAP tier is where GitGud's differentiation lives. One migration adds both table-stakes coverage (PR size) and a unique signal layer (thread metrics) that no competitor has.

---

## 4. Recommendations for S-04

### 4.1 Proposed metrics list for the contribution profile

**Tier 1 — Must-have (PRD floor + table stakes):**

| #   | Metric                                       | PRD ref | Cost  | Justification                                              |
| --- | -------------------------------------------- | ------- | ----- | ---------------------------------------------------------- |
| 1   | PRs authored (count + list by state)         | FR-009  | FREE  | PRD must-have                                              |
| 2   | Code reviews given (count + list by verdict) | FR-010  | FREE  | PRD must-have                                              |
| 3   | Review threads started (count)               | FR-011  | CHEAP | FR-011 reinterpreted as threads; requires `in_reply_to_id` |
| 4   | PR size (lines added/deleted)                | —       | CHEAP | Table stakes across all competitors                        |
| 5   | Time to merge (median)                       | —       | FREE  | Common pattern #3                                          |
| 6   | Activity timeline                            | —       | FREE  | Common pattern #4                                          |

**Tier 2 — High value (reviewer behavioral signals):**

| #   | Metric                                           | Cost  | Justification                                                     |
| --- | ------------------------------------------------ | ----- | ----------------------------------------------------------------- |
| 7   | Pickup time (time to first review)               | FREE  | Measures responsiveness; seen in LinearB, Swarmia, Flow, Athenian |
| 8   | Threads per reviewed PR (review depth)           | CHEAP | Thread-based depth — richer than raw comment count                |
| 9   | Involvement (% of board PRs reviewed)            | FREE  | Shows breadth of contribution; seen in Flow                       |
| 10  | Unique collaborators (people whose PRs reviewed) | FREE  | Collaboration signal; seen in Swarmia, Flow                       |

**Tier 3 — Thread quality signals (GitGud differentiator):**

| #   | Metric                         | Cost  | Justification                                                                            |
| --- | ------------------------------ | ----- | ---------------------------------------------------------------------------------------- |
| 11  | Avg thread depth               | CHEAP | Does this person's feedback spark discussion or just ack?                                |
| 12  | Discussion-sparking ratio      | CHEAP | What % of threads get a reply — measures feedback quality                                |
| 13  | Deep discussions (3+ messages) | CHEAP | Substantive back-and-forth — architecture debates, design tradeoffs                      |
| 14  | Multi-person threads           | CHEAP | Real discussion (multiple perspectives) vs monologue                                     |
| 15  | Thread resolution signal       | CHEAP | Does the PR author engage with the feedback? Lighter alternative to Flow's Receptiveness |
| 16  | Avg first-reply time           | CHEAP | How quickly the PR author responds to review threads                                     |

**Tier 4 — Nice-to-have (additional signals):**

| #   | Metric                                          | Cost  | Justification                                             |
| --- | ----------------------------------------------- | ----- | --------------------------------------------------------- |
| 17  | Engagement ratio (reviews given / PRs authored) | FREE  | Quick "multiplier" signal                                 |
| 18  | Reviews by verdict breakdown                    | FREE  | Shows review style (approve-heavy vs feedback-heavy)      |
| 19  | Repo breadth (distinct repos reviewed)          | FREE  | Cross-team contribution signal                            |
| 20  | Inline thread ratio                             | CHEAP | Code-anchored threads vs general — inline = more specific |

### 4.2 Persona alignment

| Metric                    | Marta (EM) value                      | Marek (Senior IC) value          | Ania (Junior IC) value                                  |
| ------------------------- | ------------------------------------- | -------------------------------- | ------------------------------------------------------- |
| PRs authored              | Context for workload                  | Self-eval evidence               | Growth tracking                                         |
| Reviews by verdict        | Sees review engagement                | Proves quality focus             | Not primary                                             |
| Threads per PR (depth)    | Surfaces hidden mentoring             | Auto-documents "glue work"       | Learns what "good" looks like                           |
| Discussion-sparking ratio | Sees who drives real discussion       | Proves feedback quality          | Not primary                                             |
| Deep discussions          | Identifies architectural debates      | Evidence of high-impact review   | Not primary                                             |
| Multi-person threads      | Maps team knowledge-sharing           | Shows collaborative review style | Learning signal — involved in multi-person discussions? |
| Thread resolution signal  | Sees whether ICs engage with feedback | Evidence of receptiveness        | Growth signal — am I engaging?                          |
| Avg first-reply time      | Identifies bottlenecks                | Shows responsiveness to feedback | Not primary                                             |
| Pickup time               | Identifies review bottlenecks         | Shows responsiveness as reviewer | Not primary                                             |
| Involvement               | Sees who carries review load          | Proves breadth                   | Not primary                                             |
| Unique collaborators      | Maps team dynamics                    | Shows mentoring reach            | Not primary                                             |
| Activity timeline         | Preparation for 1:1s                  | Combats recency bias             | Shows growth trajectory                                 |

### 4.3 Design considerations for /10x-plan

1. **Classification-ready affordances**: The thread metrics section should be designed so S-05 can later overlay semantic categories per thread (e.g., "8 architecture threads, 3 mentoring threads") without restructuring the UI. Classifying a thread (not individual comments) is more natural — the thread topic is the unit of intent.

2. **Progressive load (NFR)**: Each metric section should render independently. Consider a section-based layout where each card loads its own data — matches the NFR and enables streaming.

3. **Data parity (NFR)**: IC and EM see identical data. No hidden fields. The profile URL should work the same for both roles (RLS handles access control).

4. **Empty states (US-01 AC)**: Each metric section needs its own empty state ("No PRs in this period", "No reviews given yet") — not a single page-level empty state.

5. **No ranking** (PRD guardrail): No percentiles, no quartile positioning, no "top reviewer" badges. Pluralsight Flow's quartile benchmarking is explicitly against GitGud's design values.

6. **Period filtering**: Most competitors allow filtering by time period (last 30 days, last quarter, custom range). Consider whether S-04 needs this or if "all time since board creation" is sufficient for MVP.

---

## Code References

- `src/lib/services/github-sync.ts:29-48` — PR upsert (columns available for metrics derivation)
- `src/lib/services/github-sync.ts:50-67` — Review upsert (state/verdict data)
- `src/lib/services/github-sync.ts:69-88` — Comment upsert (body, path, position data)
- `src/types.ts:1-69` — All TypeScript types for GitHub data entities
- `supabase/migrations/20260531100000_github_ingestion_access.sql:24-69` — Table schemas
- `supabase/migrations/20260602120000_board_contributors.sql` — Contributor schema + RLS
- `src/lib/services/boards.ts` — `getBoardContributors()`, `getBoardRepos()`

## Architecture Insights

1. **Data is already persisted, not on-demand** — The sync service writes to DB; the profile view reads from DB. This means profile queries are pure SQL aggregations, no GitHub API calls at page load.

2. **RLS handles access control** — Board member check on all `github_*` tables means the profile API endpoint only needs to pass the Supabase client; RLS enforces data parity automatically.

3. **No aggregation service exists** — The gap between raw tables and profile view is a query/aggregation layer. This is normal implementation work, not a design problem.

4. **PR size data is in the API response but not stored** — The Octokit `pulls.list` response includes `additions`, `deletions`, and `changed_files`. The `upsertPullRequests` function at `github-sync.ts:29` maps PR fields but skips these three. Adding them is a 3-line change in the mapper + a migration.

5. **Thread reconstruction via `in_reply_to_id`** — The GitHub API `pulls.listReviewComments` response includes `in_reply_to_id` on every comment. The `upsertComments` function at `github-sync.ts:69` skips it. Adding one column to the table and one line to the mapper enables thread reconstruction: `WHERE in_reply_to_id IS NULL` = thread roots; `GROUP BY in_reply_to_id` = thread membership. All thread metrics (T1–T10) are pure SQL aggregations on this structure.

6. **Thread = natural unit for S-05 classification** — Classifying a thread (the conversation topic) rather than individual comments is more natural and more accurate. A thread about architecture is one "architecture" signal regardless of how many replies it has. This makes the S-04 → S-05 transition cleaner: S-04 shows thread counts/depth; S-05 adds a category label per thread.

## Historical Context

- `context/archive/discovery/market-research.md` — Competitive analysis confirming the "glue work" gap. Key finding: "most tools only count quantity of comments rather than semantic quality or pedagogical value." Positions GitGud as the "Semantic Review Assistant."
- `context/archive/discovery/user-personas.md` — Persona-specific needs: Marta (EM) wants invisible contributions surfaced; Marek (Senior IC) wants review quality auto-documented; Ania (Junior IC) needs contextualized metrics, not raw comparison. Design constraint: "If the tool only surfaces productivity metrics, it will actively harm Ania."
- `context/archive/discovery/market-research.md` — Proposed Composite Impact Index: `(0.3 × Mentorship_Density) + (0.25 × Arch_Oversight) + (0.2 × Unblock)`. This is S-05+ territory, not S-04.

## Related Research

- `context/changes/profile-raw-github-metrics/frame.md` — Frame brief confirming S-04 needs research + design before implementation.
- GitHub Issue #7 — `[S-04] Contribution profile: PRs, reviews, comment counts` (open, created 2026-06-02).

## Open Questions

1. **Period filtering for MVP**: Should S-04 support time-period filtering (last 30d, last quarter, custom range), or is "all synced data" sufficient? Competitors universally support period filtering. Impact: adds query complexity + UI controls.

2. **Migration timing**: Should the 4-column migration (`additions`/`deletions`/`changed_files` on PRs + `in_reply_to_id` on comments) be a separate prerequisite change or part of S-04? Adding to S-04 is simpler but mixes schema changes with UI work. Existing synced data will have NULLs in the new columns until the next sync runs — the profile must handle this gracefully.

3. **Sync trigger UX**: Currently sync is manual (`POST /api/github/sync`). Should the profile page trigger a sync if data is stale, or show a "last synced at" indicator with a manual refresh button? Impacts data freshness perception.

4. **Aggregation approach**: Pre-computed materialized views vs. on-the-fly SQL aggregations? For MVP data volumes (≤200 PRs per repo, small teams), on-the-fly is likely sufficient. Materialized views are a scaling optimization.

5. **GraphQL `isResolved` follow-up**: When should we add true thread resolved status via GraphQL? The REST heuristic (T7) works for MVP, but `isResolved` is more accurate and also gives us `resolvedBy` (who resolved the thread — author or reviewer). Candidate for a post-S-04 enhancement or as part of a broader GraphQL migration.

---

## Follow-up Research: Data Visualization Library — 2026-06-16

### Research Question

The dashboard prototype (`context/prototype/dashboard.html`) shows two chart types:

1. **Activity line/area chart** — 3 series (PRs authored, Reviews given, Threads started) over weekly time buckets, ~52 data points, with filled area, gridlines, legends, and dot markers.
2. **GitHub-style contribution heatmap** — 52 weeks × 7 days grid, 5 intensity levels (purple scale matching the product's accent color).

No charting library exists in the project yet. What's the right approach given the stack (Astro 6 SSR + React 19 islands + Tailwind 4 + shadcn/ui + Cloudflare Workers)?

### Summary

**Recommendation: Recharts via shadcn/ui `chart` component + custom SVG heatmap.**

The line/area chart uses shadcn/ui's chart wrappers (which wrap Recharts), giving zero design-system drift and ~15 lines of declarative JSX. The heatmap is built as a custom React + SVG component (~60 lines) because no library provides a good GitHub-style heatmap that integrates with shadcn/ui theming. Both render inside a single React island with `client:only="react"`.

### 1. Candidate Libraries Evaluated

Six libraries were evaluated across bundle size, SSR compatibility, heatmap support, React 19 compatibility, and Tailwind theming.

| Criterion                        | **Recharts** (shadcn/ui)                                     | **visx** (Airbnb)                               | **nivo**                                  | **Custom SVG**                      | **uPlot**      | **Chart.js**                      |
| -------------------------------- | ------------------------------------------------------------ | ----------------------------------------------- | ----------------------------------------- | ----------------------------------- | -------------- | --------------------------------- |
| **Bundle (min+gz, tree-shaken)** | ~50 kB                                                       | ~30-40 kB                                       | ~80-140 kB                                | 0 kB                                | ~48 kB         | ~70 kB                            |
| **React 19**                     | Yes (peerDep ^19); edge cases in v3.x with `defaultProps`    | Yes (v4.0.0 stable, June 2026)                  | Yes (v0.89.0+)                            | Yes                                 | Untested       | Yes (v5.3.0+)                     |
| **SSR (Astro `client:load`)**    | Broken in 3.x (useEffect/Redux)                              | Low-level: works. `@visx/xychart`: broken       | Fixed-size SVG: works. Responsive: broken | Works                               | No (canvas)    | No (canvas)                       |
| **Heatmap/calendar**             | CalendarChart added April 2026 (very new, stability unclear) | `@visx/heatmap` primitives (manual grid layout) | `@nivo/calendar` (best out-of-box)        | ~60 lines of `<rect>`               | No built-in    | Via `chartjs-chart-matrix` plugin |
| **Line/area chart**              | Excellent (declarative, ~15 lines)                           | Good (~80 lines with xychart)                   | Good                                      | Feasible (~150 lines with d3-shape) | Excellent      | Good                              |
| **Tailwind/CSS var theming**     | Via shadcn/ui `ChartContainer` config + CSS variables        | Direct `className` on SVG elements              | JS theme object (can map CSS vars)        | Best (full className control)       | JS config only | JS config only                    |
| **shadcn/ui integration**        | Native (shadcn ships chart wrappers for Recharts)            | None — separate design system                   | None                                      | Manual — can use cn() + Tailwind    | None           | None                              |
| **Dev effort (2 charts)**        | Low (~100 lines)                                             | Medium (~140 lines)                             | Low (~80 lines)                           | High (~250 lines)                   | High           | Medium                            |

### 2. Decisive Constraints

#### 2.1 Cloudflare Workers bundle — NOT a constraint

Chart library JS goes into **client-side static assets**, not the Worker script bundle. Astro's island architecture bundles React islands as client JS chunks served as Workers Static Assets (25 MiB per file limit). The Worker script limit (3 MB free / 10 MB paid, gzipped) applies only to `dist/_worker.js/`. A charting library in a React island never touches this limit.

#### 2.2 SSR — a constraint, but uniformly

Recharts 3.x SSR is broken — it moved state management to Redux + `useEffect`, which don't run during server rendering. Charts render as empty `<div>`s on the server. This means `client:only="react"` is required, not `client:load`.

However, this is true for **most options**: nivo's responsive components, visx's xychart, and all canvas-based libraries (uPlot, Chart.js) also need `client:only`. Only visx low-level primitives and nivo fixed-size SVG variants work with `client:load`.

**Practical impact is minimal.** The chart island is below the fold (the prototype shows metric summary cards above the activity chart). Using `client:only="react"` with `client:visible` means the chart JS only loads when the user scrolls to it. The skeleton/loading state is a static Astro-rendered card with a shimmer placeholder — no SSR HTML from the chart library is needed.

#### 2.3 shadcn/ui alignment — the strongest argument for Recharts

The project uses shadcn/ui for all UI components (`src/components/ui/`). shadcn/ui's chart system provides:

- **`ChartContainer`** — wraps Recharts charts, injects CSS variable-based theming via a `config` prop
- **`ChartTooltip` + `ChartTooltipContent`** — themed tooltips matching the design system
- **`ChartLegend` + `ChartLegendContent`** — themed legends
- **`ChartStyle`** — injects CSS for chart color variables

Colors use `oklch` via CSS custom properties (`--chart-1` through `--chart-5`), consistent with Tailwind v4 and the rest of the shadcn/ui theme. Dark mode support is built in.

Installation: `npx shadcn@latest add chart` → creates `src/components/ui/chart.tsx` + adds `recharts` dependency.

Using visx or nivo instead means building a parallel theming system for charts — a maintenance burden that grows with every future chart type. Recharts via shadcn/ui gives theme-consistent charts with no custom theming code.

#### 2.4 Heatmap — no library wins, custom SVG is best

No evaluated library provides a GitHub-style contribution heatmap that integrates cleanly with shadcn/ui theming:

| Option                     | Issue                                                                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Recharts CalendarChart     | Added April 2026, very new, stability/API unclear                                                              |
| `@nivo/calendar`           | Best out-of-box, but nivo SSR is broken + separate theme system                                                |
| `@visx/heatmap`            | Provides rect primitives but you still build the 52×7 grid layout manually                                     |
| `shadcn-heatmap` (rutopio) | Community package, MIT, Tailwind v4 tokens, shadcn copy-paste philosophy — viable but adds external dependency |

The prototype's heatmap is fundamentally simple: a 52×7 grid of colored `<rect>` SVGs with 5 intensity levels. The prototype already implements this in ~50 lines of `React.createElement("rect", ...)` calls. A custom component using Tailwind classes via `cn()` is:

- Zero additional bundle size
- Full Tailwind/shadcn theming (uses `--chart-3` or similar CSS variables for intensity scale)
- SSR-safe (pure SVG)
- Trivial to maintain (no library API to track)

### 3. Recommended Approach

#### 3.1 Line/area chart → Recharts via shadcn/ui

```
npx shadcn@latest add chart
```

Compose the activity chart using Recharts primitives inside `ChartContainer`:

```tsx
<ChartContainer config={chartConfig} className="h-[240px] w-full">
  <AreaChart data={weeklyData}>
    <CartesianGrid vertical={false} />
    <XAxis dataKey="week" tickLine={false} axisLine={false} />
    <ChartTooltip content={<ChartTooltipContent />} />
    <ChartLegend content={<ChartLegendContent />} />
    <Area
      dataKey="reviews"
      type="monotone"
      fill="var(--color-reviews)"
      stroke="var(--color-reviews)"
      fillOpacity={0.15}
    />
    <Area
      dataKey="prs"
      type="monotone"
      fill="var(--color-prs)"
      stroke="var(--color-prs)"
      fillOpacity={0}
      strokeWidth={2}
    />
    <Area
      dataKey="threads"
      type="monotone"
      fill="var(--color-threads)"
      stroke="var(--color-threads)"
      fillOpacity={0}
      strokeWidth={1.75}
    />
  </AreaChart>
</ChartContainer>
```

Chart config maps series to CSS variables from the shadcn/ui theme:

```tsx
const chartConfig = {
  prs: { label: "PRs authored", color: "var(--chart-1)" }, // dark
  reviews: { label: "Reviews given", color: "var(--chart-2)" }, // muted
  threads: { label: "Threads started", color: "var(--chart-3)" }, // accent
} satisfies ChartConfig;
```

#### 3.2 Heatmap → Custom React + SVG component

Build `ContributionHeatmap.tsx` as a React component rendering a `<svg>` with:

- 52 columns × 7 rows of `<rect>` elements
- 5 intensity levels mapped to opacity steps of the accent color CSS variable
- Day labels (Mon, Wed, Fri) and month labels
- Tooltip on hover showing date + count

This component lives alongside the chart island. It uses `cn()` for className merging and reads colors from CSS variables to match the shadcn/ui theme.

#### 3.3 Island structure

Both charts live in a single React island on the profile page:

```text
---
// src/pages/boards/[id]/contributors/[login].astro
const { weeklyData, heatmapData } = await getContributorMetrics(...)
---
<ProfileCharts
  client:only="react"
  weeklyData={weeklyData}
  heatmapData={heatmapData}
/>
```

Using `client:only="react"` because Recharts 3.x cannot SSR. The Astro page renders a skeleton card server-side; the React island renders charts client-side on load.

Data is fetched server-side (Astro frontmatter) and passed as serialized props — no client-side API calls for chart data.

### 4. Trade-offs and Alternatives

| Decision           | Chosen                                                                   | Alternative                          | Why chosen                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Line chart library | Recharts (via shadcn/ui)                                                 | visx v4                              | shadcn/ui alignment > 20 kB bundle savings. Theme consistency with all other UI components                                                 |
| Heatmap            | Custom SVG                                                               | `@nivo/calendar` or `shadcn-heatmap` | Zero dependency, trivial to implement, full theme control. Nivo adds SSR issues + ~80 kB. Community package adds external maintenance risk |
| Hydration          | `client:only="react"`                                                    | `client:load`                        | Recharts 3.x SSR is broken. `client:only` avoids hydration mismatches. Chart is below fold anyway                                          |
| Island count       | Single island (both charts)                                              | Separate islands per chart           | Shared React runtime. One hydration boundary. Props from same server query                                                                 |
| Responsiveness     | Recharts `ResponsiveContainer` + CSS `width:100%` on heatmap SVG viewBox | Fixed dimensions                     | Prototype uses full-width layout; responsive is expected                                                                                   |

**If Recharts React 19 stability becomes a problem** (the v3.x `defaultProps` edge cases), the fallback is visx v4 with a thin theming adapter that reads shadcn/ui CSS variables. visx v4 has confirmed React 19 support (stable June 2026) and SSR-safe SVG primitives. The line/area chart would be ~80 lines instead of ~15, but the migration path is clean since both render SVG.

### 5. Bundle Impact

| Component                                                                | Gzipped size |
| ------------------------------------------------------------------------ | ------------ |
| React 19 runtime (already in project)                                    | ~45 kB       |
| Recharts (tree-shaken: AreaChart, XAxis, CartesianGrid, Tooltip, Legend) | ~50 kB       |
| shadcn/ui chart.tsx wrappers                                             | ~2 kB        |
| Custom heatmap component                                                 | ~1 kB        |
| **Total chart island**                                                   | **~98 kB**   |

For a lazy-loaded island (`client:visible` or `client:only`), ~98 kB gzipped is reasonable. Parse time on mobile: ~50-60ms. Download on 3G: ~300ms. This is the profile page's only significant JS — the rest of the page is server-rendered Astro HTML.

### 6. Open Questions (updated)

6. **Recharts 3.x stability**: Monitor Recharts v3.x releases for React 19 `defaultProps` fixes. If issues surface during implementation, fall back to visx v4. Pin the Recharts version in `package.json` (no caret range) to avoid surprise breakage.

7. **`client:visible` vs `client:only`**: The prototype places the activity chart below the fold. Using `client:visible` instead of `client:only="react"` would delay JS load until scroll — better initial page load. However, `client:visible` combined with `client:only` semantics (no SSR) may require Astro 6's `client:only` + `loading="visible"` pattern. Verify in Astro 6 docs during implementation.

8. **Heatmap tooltip**: The prototype shows a simple hover tooltip on heatmap cells. Should this use shadcn/ui's `Tooltip` component (Radix-based, accessible) or a lightweight CSS-only tooltip? Radix Tooltip adds ~5 kB but gives keyboard accessibility and positioning logic.

### Code References

- `context/prototype/dashboard.html` — Prototype with inline SVG line chart (hand-drawn `<path>` elements) and heatmap (`React.createElement("rect", ...)` grid)
- `src/components/ui/` — Existing shadcn/ui components (card, button, badge, etc.)
- shadcn/ui chart docs — `ChartContainer`, `ChartTooltip`, `ChartLegend` wrappers over Recharts
- Recharts v3.8.1 — Current stable, React 19 peerDep supported, SSR broken (must use `client:only`)
- visx v4.0.0 — Fallback option, React 19 stable, SSR-safe SVG primitives
