---
change_id: e2e-workflow-chain
title: E2e workflow chain
status: implementing
created: 2026-07-11
updated: 2026-07-31
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

- 2026-07-30: Phase 1 manual verification surfaced that `wrangler dev` cannot run this project's `src/worker.ts` at all (unresolvable Astro/Vite virtual modules). Researched and replanned: the local E2E runtime is `astro dev` + `CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH=./wrangler.e2e.jsonc`, not a separate `wrangler dev` process. See `research.md` and the corrected `plan.md`/`plan-brief.md`.
- 2026-07-31: Phase 2 sync-chain.spec.ts surfaced that the sync Workflow was silently broken end-to-end: `get_user_github_pat`, `get_unclassified_root_comments_for_board`, and `batch_update_pr_sizes` were never granted `EXECUTE` to `service_role` in their migrations (only `authenticated`). Production already carried the `get_user_github_pat` grant applied out-of-band; the other two were real, previously-unnoticed gaps. Fixed via three additive migrations (commit 3a816f0). Also found and fixed a local-only environment issue: the local `supabase` CLI devDependency (`^2.23.4`) had drifted to 2.109.0, which resolves a Postgres image that doesn't bootstrap `service_role`'s default table grants — confirmed via Supabase's own docs that this is a platform regression, not an intentional convention change. Pinned to `2.101.0` to match CI's `supabase/setup-cli@v2` version.
