# Classification Batch (F-03) — Plan Brief

> Full plan: `context/changes/classification-batch/plan.md`
> Frame brief: `context/changes/classification-batch/frame.md`
> Research: `context/changes/classification-batch/research.md`

## What & Why

Build a daily durable Cloudflare Workflow that incrementally syncs GitHub data and classifies each review thread into semantic categories via Workers AI. This is the foundation that makes "glue work" visible — the PRD's product wedge. The current in-request sync is capped at 200 PRs and has no classification; this change lifts both limitations via durable execution and adds AI-powered intent labeling.

## Starting Point

GitHub sync exists as `syncBoardGitHubData()` running inside an API request handler, capped at 200 PRs/repo. Review comments are stored verbatim in `github_review_comments.body`. Thread grouping works via `COALESCE(in_reply_to_id, id)`. Zero Workflow/AI/Cron infrastructure exists — `wrangler.jsonc` has only an `ASSETS` binding. The `ThreadQualitySection` UI has a dormant `categoryBreakdown` slot ready for classification data.

## Desired End State

A daily Cron Trigger dispatches one Workflow per active board. Each Workflow syncs all GitHub data (no PR cap), classifies every unclassified thread via Workers AI (Llama 3.3-70B fp8-fast), and stores 5 fields per thread: intent, domain, constructiveness, knowledge direction, confidence. The manual sync endpoint triggers the same Workflow. Bot comments are pre-filtered. All inference runs on the user's own Cloudflare account (~$0.74/month for an active board).

## Key Decisions Made

| Decision                    | Choice                                                                             | Why (1 sentence)                                                                                                          | Source           |
| --------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| LLM provider                | Workers AI (user's CF account)                                                     | Data never leaves the user's Cloudflare network; cost lands on their existing bill with zero key management.              | Research         |
| Model                       | Llama 3.3-70B fp8-fast                                                             | Nearly identical input price to 8B but 9× more parameters — 33% more cost for dramatically better classification quality. | Research         |
| Primary classification axis | Reviewer intent (6 categories)                                                     | PRD's explicit product wedge; makes "how" the reviewer contributed visible.                                               | Frame            |
| Supplementary axes          | Domain (5), constructiveness (binary), knowledge direction (4), confidence (float) | All extractable from a single LLM call at near-zero marginal cost.                                                        | Frame / Research |
| Knowledge direction         | Store but don't surface in UI                                                      | Weakest axis (can't infer seniority from text); collect data for future validation without risking trust.                 | Plan             |
| Workflow granularity        | Per-board instances via Cron dispatcher                                            | Board isolation — one failing board doesn't block others; natural parallelism and per-board retry.                        | Plan             |
| Sync scope                  | Full incremental sync + classification in one Workflow                             | Daily task must load all data additively, not just classify — replaces in-request sync entirely.                          | Plan             |
| Manual sync                 | Refactored to trigger Workflow                                                     | Preserves EM's manual re-sync UX while routing through durable execution (no timeout cap).                                | Plan             |
| Pre-filtering               | Filter bots, classify all humans                                                   | Bot comments have no reviewer intent; human LGTMs correctly classified via prompt rules.                                  | Plan             |
| Backfill                    | Classify all unclassified on first run                                             | Natural — the "fetch unclassified" query picks up historical threads; cost is <$9 even for 1 year of history.             | Plan             |
| UI integration              | Follow-up change                                                                   | Keep this change focused on infrastructure + classification; the UI slot already exists.                                  | Plan             |

## Scope

**In scope:**

- Custom Worker entrypoint (`src/worker.ts`) with Astro handler + Workflow export
- AI binding, Workflow binding, Cron Trigger in `wrangler.jsonc`
- `thread_classifications` DB table with RLS
- Classification service (bot filter, thread assembly, system prompt, Workers AI call, JSON parsing)
- Full Workflow: sync → classify → store
- Refactored manual sync endpoint → Workflow trigger

**Out of scope:**

- UI wiring (follow-up change)
- BYOK / external model providers
- Full 17-subcategory Turzo & Bosu taxonomy
- Çağlar comment smell detection
- Thread resolution metadata extraction
- Composite metrics (Feedback Quality, CRQS, Noise ratio)
- FR-013 (user correction flags)

## Architecture / Approach

```
Cron (daily 03:00 UTC) → scheduled handler → query active boards
                                            → create ClassificationBatchWorkflow per board
                                               │
                                               ├─ step: sync GitHub data (incremental, no PR cap)
                                               ├─ step: fetch unclassified root threads (filter bots)
                                               ├─ step: classify batch via Workers AI → AI Gateway
                                               │        (Llama 3.3-70B, structured JSON output)
                                               └─ step: upsert results → thread_classifications
```

Custom `src/worker.ts` exports both `default { fetch, scheduled }` (Astro + Cron) and `ClassificationBatchWorkflow` (Workflow class). Workers AI accessed via `env.AI.run()`, routed through AI Gateway for caching and analytics.

## Phases at a Glance

| Phase                                 | What it delivers                                                          | Key risk                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1. Infrastructure & Custom Entrypoint | `src/worker.ts`, AI/Workflow/Cron bindings, types                         | Custom entrypoint breaks Astro dev or build                                       |
| 2. Database Schema                    | `thread_classifications` table with RLS                                   | None (purely additive)                                                            |
| 3. Classification Service             | Bot filter, thread assembly, system prompt, Workers AI call, JSON parsing | Workers AI classification quality is unvalidated                                  |
| 4. Workflow Implementation            | Full sync → classify pipeline with durable steps                          | `astro:env` vs `cloudflare:workers` import boundary; service role key requirement |
| 5. API Integration                    | Manual sync triggers Workflow; dedup                                      | Response shape change may break existing client code                              |

**Prerequisites:** Workers Paid plan ($5/mo) recommended for Workflow/Cron support. Local Supabase for migration testing. Docker for `supabase start`.
**Estimated effort:** ~5-7 sessions across 5 phases.

## Open Risks & Assumptions

- **Classification quality** (highest risk): Llama 3.3-70B fp8-fast accuracy on the 6-intent taxonomy is unvalidated. Must test empirically before trusting results.
- **Diff hunk availability**: Not stored in DB. V1 may classify from text + PR metadata alone, omitting code context for inline threads.
- **Service role key**: Workflow likely needs `SUPABASE_SERVICE_KEY` to bypass RLS for inserts — new secret to manage.
- **`astro:env` / `cloudflare:workers` boundary**: Workflow code must never import from `astro:env/server`; mixing will fail at runtime.

## Success Criteria (Summary)

- Daily Cron fires, Workflow runs unattended, `thread_classifications` populated with valid labels for all non-bot threads
- Manual sync triggers Workflow with dedup; no Worker timeouts
- Existing contribution profile pages load without regression
