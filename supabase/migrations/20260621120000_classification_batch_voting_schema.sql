-- F-03: Classification batch — switch to batched majority-vote classification (intent + domain
-- only). Expand the intent CHECK to the new category set. The constructive/knowledge_direction/
-- confidence columns are dropped outright (not deprecated one release behind, per the usual
-- expand/contract rule) because thread_classifications has never shipped to production — this
-- whole table is still mid-development on an unmerged branch, so there's no deployed Worker
-- version a `wrangler rollback` could fall back to that still writes these fields.

ALTER TABLE public.thread_classifications
  DROP CONSTRAINT thread_classifications_intent_check;

ALTER TABLE public.thread_classifications
  ADD CONSTRAINT thread_classifications_intent_check
  CHECK (intent IN (
    'mentoring', 'architecture', 'bug-catch', 'nitpick', 'unblocking', 'question',
    'praise', 'joke', 'self-review', 'unknown'
  ));

ALTER TABLE public.thread_classifications
  DROP COLUMN constructive,
  DROP COLUMN knowledge_direction,
  DROP COLUMN confidence;
