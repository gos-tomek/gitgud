---
change_id: edit-board-connection
title: Edit board connection
status: archived
created: 2026-06-25
updated: 2026-06-25
archived_at: 2026-06-25T19:57:44Z
---

## Notes

`boards.github_pat_encrypted` is deprecated after this change — all PAT read/write paths now go through `user_profiles.github_pat_encrypted`. The column is kept in place for rollback safety per expand/contract convention. Its removal is a separate future migration (contract phase).
