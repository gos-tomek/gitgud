# Frame Brief: Quality Gates — CI wiring vs. local hook strategy

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

- `context/foundation/test-plan.md` §3 lists Phase 4 ("Quality gates") as
  `not started`, goal: *"Wire vitest into CI; set minimum signal floor;
  update project conventions."* `context/changes/quality-gates/change.md`
  scopes the change exactly that way.
- The user observes that `npx eslint` / `npx tsc` "takes quite a long
  time." This happens inside `.claude/settings.json`'s `PostToolUse` hook,
  which runs `npx eslint --fix . --quiet`, `npx tsc --noEmit`, and
  `npx vitest related "$FILE" --run` after every `Write|Edit`. The husky
  `pre-commit` hook currently runs only `npx lint-staged`.

## Initial Framing (preserved)

- **User's stated cause or approach**: CI wiring (Phase 4 as scoped) is a
  good idea and agreed. Additionally, develop a full local test/quality
  strategy — some checks run at file-edit time (by the agent), some at
  commit time. The eslint/tsc slowness should be fixed by moving those
  checks from the post-edit hook to the pre-commit hook.
- **User's proposed direction**: Broaden "quality-gates" to cover both (1)
  CI wiring and (2) a local dev quality-gate strategy spanning
  `.claude/settings.json` PostToolUse hooks and `.husky/pre-commit`,
  including relocating eslint/tsc to pre-commit.
- **Pre-dispatch narrowing**: User wants (1) and (2) as **one combined
  change**; confirmed the slowness source is `.claude/settings.json`'s
  PostToolUse block; and wants the local strategy both **documented and
  implemented** (hook files actually edited), not just written up.

## Dimension Map

1. **CI wiring (Phase 4 as scoped)** — add a vitest step to
   `.github/workflows/ci.yml`, set a signal floor, update
   `test-plan.md` §5/§6 conventions. ← user's framing, this dimension.
2. **Local post-edit hook config** (`.claude/settings.json` `PostToolUse`)
   — editing the agent's eslint/tsc/vitest checks. This is hook
   configuration.
3. **Local pre-commit hook config** (`.husky/pre-commit` + `lint-staged`)
   — same category as #2, different file.
4. **Root cause of "eslint/tsc is slow"** — is it hook *stage* (post-edit
   vs. pre-commit, as the user frames it), or hook *scope* (whole-project
   vs. touched-file)?

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| #1 CI wiring is correctly framed and ready to plan | `test-plan.md:81` (§3 row 4) and `change.md` both describe exactly "wire vitest into CI; set signal floor; update conventions" — no gap | STRONG (confirms framing) |
| #2 Editing `.claude/settings.json` PostToolUse hooks is in-scope for "quality-gates"/Phase 4 | `test-plan.md` §3/§5 never mention `.claude/settings.json`; CLAUDE.md:179 — *"Do not configure hooks, hook lifecycle, or debugging hooks. That is Lesson 3."*; sub-agent search of `.claude/skills/` found zero references tying Phase 4 to hook-file edits | NONE — strong evidence against |
| #3 Editing `.husky/pre-commit` / `lint-staged` is in-scope for "quality-gates"/Phase 4 | `test-plan.md:111` (§5) lists "pre-commit (husky)" as **"(wired)"** — i.e. already configured, Phase 4's job is to document/reference it, not build it; same Lesson-3 boundary as #2 applies to further edits | NONE as *configuration*; WEAK as *documentation* (already mostly done) |
| #4 "Slow because of hook stage" | `.claude/settings.json` shows `eslint --fix .` and `tsc --noEmit` run against the **whole project**, not the edited file — regardless of which stage runs them. `context/archive/2026-06-11-test-fix-gaps/plan.md:613` documents a real incident: the project-wide `tsc --noEmit` PostToolUse check blocked an unrelated edit because of **pre-existing** type errors elsewhere in the codebase. The `vitest related "$FILE"` command in the same hook already shows the correct file-scoped pattern. | WEAK — stage isn't irrelevant (the post-edit pause is real), but *scope* is the dominant, documented driver |

## Narrowing Signals

- User confirmed "Both, one change" and "wire it up + document" even after
  the CLAUDE.md Lesson-3 boundary was surfaced in the framing echo — they
  want the local-hook work done now, lesson curriculum notwithstanding.
  This is a scope *decision*, not evidence that the boundary doesn't apply.
- User pointed back at `.claude/settings.json` as the slowness source,
  corroborating #4: the PostToolUse block (whole-project eslint+tsc) is the
  locus, not the pre-commit hook (which currently does none of that work).

## Cross-System Convention

- This repo's convention (per CLAUDE.md's Lesson-boundaries section) is to
  keep hook-lifecycle configuration out of Module 3 Lesson 2 work and defer
  it to "Lesson 3" — defined only negatively (by exclusion); no Lesson 3
  material exists yet in this repo.
- Ironically, the current PostToolUse hook block was itself added
  informally: commit `13e1e7e` ("chore: apply Prettier reformat...")
  silently introduced the entire `hooks.PostToolUse` config as a side
  effect of an unrelated formatting commit — no plan, no research, no
  rationale recorded. The project has *not* actually followed a
  plan→implement flow for hook config so far, despite the Lesson-3
  convention saying it should wait.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is two distinct pieces that
> shouldn't be folded into one undifferentiated plan**: (1) CI wiring
> (Phase 4 as originally scoped) is correctly framed — proceed as-is. (2)
> The local quality-gate strategy is real and worth doing, but is
> hook-lifecycle configuration CLAUDE.md reserves for "Lesson 3", **and**
> its root cause is hook *scope* (whole-project `eslint --fix .` /
> `tsc --noEmit` on every edit — already documented as blocking unrelated
> work in `context/archive/2026-06-11-test-fix-gaps/plan.md:613`), not
> hook *stage*. Simply relocating the same whole-project commands from
> post-edit to pre-commit would not fix the documented problem and would
> remove the agent's fast self-correction feedback loop.

## Confidence

**HIGH** — CLAUDE.md text is explicit and primary-source; `.claude/settings.json`
is read directly; the test-fix-gaps incident is a documented, dated
precedent; sub-agent search corroborates the absence of any Phase 4 ↔
hook-config link.

## What Changes for /10x-plan

- Recommend splitting into two change-ids: keep `quality-gates` scoped to
  CI wiring (Phase 4, matches test-plan.md and CLAUDE.md's Lesson 2
  boundary cleanly) — likely a small, fast plan. Open a **separate** change
  for the local hook strategy, explicitly user-elected and flagged as
  crossing the documented Lesson-3 boundary, so that choice is visible to
  future readers (and `/10x-plan-review`) rather than buried inside
  "quality-gates."
- If the user instead wants one combined change, structure the plan with
  CI wiring as the core (Phase-4-aligned) phase and the local-hook work as
  a clearly labeled additional phase carrying an explicit "crosses Lesson 3
  boundary by user choice" note.
- Either way, reframe the local-hook goal from "move eslint/tsc to
  pre-commit" to "scope post-edit checks to the touched file(s) (matching
  the existing `vitest related "$FILE"` pattern); keep/expand
  whole-project checks at pre-commit and/or CI as the broader safety net."

## References

- `context/foundation/test-plan.md:81` (§3 Phase 4), `:111` (§5 pre-commit row)
- `.claude/settings.json:27-44` (current PostToolUse hooks)
- `CLAUDE.md:179` (Lesson boundaries — hooks = Lesson 3)
- `package.json` `lint-staged` config (eslint --fix on `*.{ts,tsx,astro}`, prettier on `*.{json,css,md}`)
- `context/archive/2026-06-11-test-fix-gaps/plan.md:613` (documented incident: project-wide tsc check blocked unrelated edit)
- Commit `13e1e7e` (introduced current PostToolUse hooks, undocumented), commit `b4192d9` (m1l3 bootstrap, no hooks yet)
- Investigation: 2 parallel Explore sub-agents (lint-staged/bootstrap history; Lesson-3/skills cross-references)
