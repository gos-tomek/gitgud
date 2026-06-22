---
change_id: classification-batch
title: Classification batch
status: archived
created: 2026-06-18
updated: 2026-06-22
archived_at: 2026-06-22T13:23:29Z
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

- Classification scope narrowed from the original 5-field schema (intent, domain, constructive, knowledge_direction, confidence) to 2 fields (intent, domain) — empirical prompt experiments (Open Risk #1) showed the LLM couldn't reliably populate the other 3 axes. `constructive`/`knowledge_direction`/`confidence` columns dropped outright in `20260621120000_classification_batch_voting_schema.sql` (table never shipped to production, so no expand/contract lag needed). `intent` enum also expanded (praise, joke, self-review added) and classification now uses batched majority-vote (3 repeats, batch size 4) for accuracy.
