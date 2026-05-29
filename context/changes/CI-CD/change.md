---
change_id: CI-CD
title: Branch/PR workflow + automated deploy-on-merge to Cloudflare with board updates
status: implementing
created: 2026-05-29
updated: 2026-05-29
archived_at: null
---

## Notes

Process + delivery change (not a roadmap slice). Moves GitGud from manual `wrangler deploy` on a
single `main` branch to a protected-trunk model: every change on a `change/<id>` branch → PR →
CI gate → merge → auto-deploy → project board issue set to `done`.

Decisions: PR required + CI status check + 0 approvals (solo self-merge); fully automatic deploy on
merge (PR is the human gate — supersedes `infrastructure.md`'s "production publish is human-only by
hand" posture); board auto-updated from CI; DB migrations auto-applied via `supabase db push` before deploy with an
enforced expand/contract (backward-compatible) discipline; release tagging deferred.

See `plan.md` for the full plan.
