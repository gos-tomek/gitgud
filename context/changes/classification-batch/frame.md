# Frame Brief: Classification Batch — What Should It Produce?

> Framing step before /10x-plan. This document captures what is _actually_
> at issue, separated from what was initially assumed.

## Reported Observation

Classification-batch (F-03) is the next foundation to build. It needs to analyze code review threads from GitHub and produce metrics/labels for the dashboard. The question is: what classification outputs should it produce?

## Initial Framing (preserved)

- **User's stated cause or approach**: Two metrics via AI: (1) "subject focus" — qualitative measure of what the thread was about (topic/category), and (2) "usefulness" — whether the thread was resolved.
- **User's proposed direction**: Validate these two metrics against the discovery research; possibly replace or supplement with alternatives.
- **Pre-dispatch narrowing**: User confirmed (a) thread-level is the right unit of analysis, (b) "usefulness"/resolution is a separate metadata layer (not AI classification), (c) for the classification axis itself — wants 5–10 candidate options proposed from the discovery material to validate during research.

## Dimension Map

The question "what should the batch produce?" can originate at any of these dimensions:

1. **Reviewer intent** — WHY did the reviewer comment? (mentoring, architecture, bug-catch, nitpick, unblocking, question). This is the PRD's explicit choice and the product wedge.
2. **Technical domain** — WHAT engineering area does the thread touch? (Functional, Refactoring, Documentation, Discussion — Turzo & Bosu taxonomy). ← user's "subject focus" lands closest here.
3. **Communication quality** — HOW well was the feedback delivered? (comment smells vs useful intents — Çağlar et al. 2026 taxonomy).
4. **Thread resolution** — Did the thread lead to a code change? (Addressed/Unaddressed/Rejected). ← user confirmed as separate layer, not AI.
5. **Thread complexity** — How deep and multi-party was the discussion? Already computed at query time in `impact-metrics.ts`.

## Hypothesis Investigation

| Hypothesis                                                         | Evidence                                                                                                                                                                                | Verdict |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| H1: Reviewer intent is the primary classification axis             | PRD §Business Logic names 6 intent categories explicitly; roadmap §Vision says the wedge is "comments classified by intent"; `ThreadQualitySection` has unused `categoryBreakdown` slot | STRONG  |
| H2: Technical domain (Turzo & Bosu) is a useful supplementary axis | Discovery `Research-CommentsTypes.md` §Turzo: 5 groups / 17 subcategories with empirical frequencies; top-level groups are cheap for LLM to assign hierarchically                       | STRONG  |
| H3: Communication quality (Çağlar smells) is worth classifying     | Discovery `Research-CommentsTypes.md` §Çağlar: zero-shot macro-F1 only 0.360–0.374 even with GPT-5-mini / DeepSeek-R1; accuracy too low for production                                  | WEAK    |
| H4: Thread resolution is a separate metadata signal                | User confirmed; GitHub API exposes `resolved` flag on review threads; `github_reviews.state` already captures APPROVED / CHANGES_REQUESTED                                              | STRONG  |
| H5: Thread complexity is metadata, not classification              | `impact-metrics.ts:computeThreadMetrics()` already computes depth, multi-person ratio, author engagement, inline ratio                                                                  | STRONG  |

## Narrowing Signals

- User explicitly separated "usefulness" (resolution) from AI classification — this eliminates one of the two proposed AI metrics and redirects it to metadata extraction.
- User asked for 5–10 candidate options, signaling openness to a richer taxonomy than the two originally proposed.
- PRD's intent categories (mentoring, architecture, bug-catch, nitpick, unblocking, question) are the load-bearing product decision — any alternative must serve the same goal of making "glue work" visible.
- Discovery research's cascading hybrid approach (cheap operational signals → communication quality → deep intent taxonomy) maps well to a two-tier model routing architecture: cheap model for bulk triage, expensive model for nuanced intent.

## Cross-System Check

The PRD's 6 intent categories are a **custom taxonomy** — not directly borrowed from any academic framework. The closest match in the literature:

- Turzo & Bosu's 17 subcategories are more granular and domain-specific (Resource, Timing, Support issues) — better for engineering analytics than for "glue work" visibility.
- The PRD categories feel like a deliberate simplification oriented toward the _contribution profile_ use case: an IC or EM should immediately understand what kind of work the reviewer did, not what technical domain they touched.

The product wedge holds: intent classification is the right primary axis for the stated product goal. Technical domain is an interesting supplement (tells you WHERE the reviewer contributed) but doesn't replace intent (which tells you HOW they contributed).

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: The classification batch must produce a per-thread intent label from the PRD's taxonomy (or a validated refinement of it), with thread resolution status derived separately from GitHub API metadata — not two equal AI metrics as originally framed.

The initial framing proposed two AI metrics ("subject focus" + "usefulness"). The reframe splits these into:

1. **One primary AI classification axis** — reviewer intent per thread (the product wedge)
2. **One metadata-derived signal** — thread resolution (Addressed/Unaddressed/Rejected from API state)
3. **A set of candidate supplementary axes** to validate during /10x-research (below)

## Proposed Classification / Metric Options (for research validation)

These are the 5–10 candidate outputs the batch could produce, organized by whether they need AI or can be derived from metadata:

### AI-classified (per thread, via hosted LLM)

| #   | Option                           | Description                                                                                                                         | Source                                           | MVP priority                                                           |
| --- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------- |
| 1   | **Reviewer intent**              | Classify thread into: mentoring, architecture, bug-catch, nitpick, unblocking, question                                             | PRD §Business Logic                              | Must-have (product wedge)                                              |
| 2   | **Technical domain (top-level)** | Classify thread into: Functional, Refactoring, Documentation, Discussion, False Positive                                            | Turzo & Bosu (discovery)                         | Candidate — enriches "where" alongside "how"                           |
| 3   | **Comment constructiveness**     | Binary: constructive (provides evidence, alternative, or actionable suggestion) vs non-constructive (vague objection, no direction) | Çağlar useful-intents subset (discovery)         | Candidate — simpler than full smell taxonomy, higher expected accuracy |
| 4   | **Knowledge transfer direction** | Classify thread as: mentoring-down (senior→junior), peer-exchange, challenge-up (junior→senior), or self-clarification              | Bacchelli & Bird / discovery §Knowledge Transfer | Candidate — directly maps to PRD's "who unblocked a peer"              |
| 5   | **Confidence score**             | LLM self-reported confidence in its intent classification (0–1)                                                                     | Standard LLM practice                            | Candidate — enables accuracy monitoring without human labels           |

### Metadata-derived (no AI needed)

| #   | Option                        | Description                                                                              | Source                                   | MVP priority                                                     |
| --- | ----------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------- |
| 6   | **Thread resolution**         | Addressed / Unaddressed / Rejected — from GitHub thread `resolved` state + review state  | Outcomes-first framework (discovery)     | Should-have (user confirmed as separate layer)                   |
| 7   | **Thread depth & complexity** | Iteration count, multi-person flag, author engagement %                                  | Already computed in `impact-metrics.ts`  | Already done                                                     |
| 8   | **Inline vs general**         | Whether thread is anchored to a specific code line or is a PR-level comment              | `github_review_comments.path` NULL check | Already done                                                     |
| 9   | **Review verdict context**    | The formal review state (APPROVED, CHANGES_REQUESTED, etc.) that the comment belongs to  | `github_reviews.state`                   | Already stored                                                   |
| 10  | **Review Coverage**           | % of PRs on the board that have at least one substantive review thread (not just "lgtm") | Discovery §Pipeline Applications         | Candidate — metadata-derivable once intent classification exists |

### Composite / derived metrics (computed from classification + metadata)

These are higher-level metrics that combine AI classification results with metadata signals. They don't require separate AI calls — they're computed post-classification.

| #   | Option                                | Description                                                                                                          | Source                                                       | MVP priority                                                                                                 |
| --- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| 11  | **Feedback Quality ratio**            | % of threads classified as substantive (Functional + Refactoring intent) vs shallow (Documentation, Praise, Nitpick) | Discovery §Quantifying "Good MCR"                            | Candidate — direct indicator of review process health                                                        |
| 12  | **Code Review Quality Score**         | Composite metric combining feedback quality + defect detection rate + review coverage/timeliness                     | Discovery §Quantifying "Good MCR"                            | Candidate — single "health of review" number for the board                                                   |
| 13  | **Noise ratio**                       | % of non-constructive comments across all threads in a period — signals communication dysfunction                    | Discovery §Pipeline Applications                             | Candidate — requires constructiveness classification (#3) as input                                           |
| 14  | **Comment usefulness (Bosu spatial)** | Did the comment trigger a code change within 1–10 lines of its anchor location in subsequent commits?                | Bosu & Greiler (Research-GoodCodeReview §Comment usefulness) | Candidate — requires diff analysis across commits, not just API state; different from thread resolution (#6) |
| 15  | **Unaddressed→Addressed conversion**  | Of threads initially left unaddressed, how many were eventually resolved? Measures delayed impact of review feedback | Discovery §Pipeline Applications                             | Candidate — requires tracking thread state over time                                                         |

### Possible but deferred

| #   | Option                               | Description                                                               | Why defer                                                                                                            |
| --- | ------------------------------------ | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 16  | **Full Turzo & Bosu 17-subcategory** | Fine-grained technical subcategories (Resource, Timing, Interface, etc.)  | Class imbalance problem; Timing is 0.21% of data — requires ADASYN/SMOTE or hierarchical prompting; overkill for MVP |
| 17  | **Comment smell detection**          | 6 Çağlar smell labels (redundancy, vagueness, non-constructiveness, etc.) | Zero-shot F1 of 0.360–0.374 — accuracy too low for production trust (discovery §Çağlar)                              |
| 18  | **Seniority-correlated complexity**  | Do complex issues (Functional/Timing) correlate with reviewer seniority?  | Requires seniority data not available in current schema                                                              |

## Confidence

- **HIGH** — strong evidence from PRD, discovery research, and codebase investigation. The product goal (make glue work visible via intent classification) is unambiguous. The reframe (one AI axis + metadata, not two AI metrics) is well-supported by the user's own narrowing answers and the discovery material.

## What Changes for /10x-plan

The plan should focus on:

1. Building the Cloudflare Workflow + Cron Trigger infrastructure for daily batch execution
2. Implementing thread-level intent classification (option #1 above) as the primary AI output
3. Extracting thread resolution status (option #6) from GitHub API metadata
4. /10x-research should validate which of options #2–5 add enough value to include in the first version, and settle the PRD's intent taxonomy (the 6 named categories may need refinement based on real data)

## References

- PRD: `context/foundation/prd.md` §Business Logic (line 172–178), FR-012 (line 144)
- Roadmap: `context/foundation/roadmap.md` F-03 (line 100–113), S-05 (line 185–196)
- Discovery: `context/changes/classification-batch/discovery/Research-CommentsTypes.md` (Turzo & Bosu taxonomy, Çağlar smells, Outcomes-first framework, cascading hybrid architecture)
- Discovery: `context/changes/classification-batch/discovery/Research-GoodCodeReview.md` (knowledge transfer, comment usefulness definition, Conventional Comments)
- Infrastructure: `context/foundation/infrastructure.md` (Cloudflare Workflows + Cron Triggers)
- Codebase: `src/lib/services/impact-metrics.ts` (existing thread metrics), `src/lib/services/github-sync.ts` (sync service), `src/types.ts` (ThreadQualitySection categoryBreakdown slot)
- Memory: `gitgud-ai-classification-approach.md` (hosted API for MVP, local model deferred)
