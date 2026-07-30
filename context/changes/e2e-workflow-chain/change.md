---
change_id: e2e-workflow-chain
title: E2e workflow chain
status: implementing
created: 2026-07-11
updated: 2026-07-30
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

- 2026-07-30: Phase 1 manual verification surfaced that `wrangler dev` cannot run this project's `src/worker.ts` at all (unresolvable Astro/Vite virtual modules). Researched and replanned: the local E2E runtime is `astro dev` + `CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH=./wrangler.e2e.jsonc`, not a separate `wrangler dev` process. See `research.md` and the corrected `plan.md`/`plan-brief.md`.
