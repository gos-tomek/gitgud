---
project: GitGud
version: 1
status: draft
created: 2026-05-21
context_type: greenfield
product_type: web-app
target_scale:
  users: medium
  qps: "# TODO: qps — see Open Questions"
  data_volume: "# TODO: data_volume — see Open Questions"
timeline_budget:
  mvp_weeks: 6
  hard_deadline: null
  after_hours_only: true
---

## Vision & Problem Statement

Mentoring, code review quality, and unblocking work — the contributions that keep engineering teams healthy — are invisible to the tools that measure engineering performance. Engineers who do this "glue work" consistently cannot prove it at review time, while platforms like LinearB and Swarmia optimize for throughput signals (DORA metrics, cycle time) that actively misrepresent their contribution.

The gap the market hasn't solved is the semantic layer: not *how much* code shipped, but *who unblocked a peer*, *whose review comment shaped an architecture decision*, *who prevented an incident through informal mentoring*. This gap drives the "silent contributor" churn pattern — the engineer most likely to leave is the one doing the most critical but least visible work.

## User & Persona

### Primary persona

**Marek — Senior Software Engineer**
6 years of experience. Works on a team of 8 in a mid-size product company. Reviews 3–5 PRs per week, often leaving detailed architectural comments. Mentors two junior engineers informally. Recently refactored a critical service — the kind of work that doesn't appear in ticket velocity. His last review was "meets expectations." He's thinking about interviewing elsewhere — not because of money, but because he doesn't feel seen.

*The moment he reaches for GitGud:* Review cycle is approaching and he's staring at a blank self-evaluation form. He knows he did important work — unblocking, mentoring, refactoring — but can't reconstruct the specifics from memory. The data exists in GitHub and Jira. It's just never been assembled for him.

### Secondary persona (buyer)

**Marta — Engineering Manager**
3 years as EM, 9 direct reports. Spends ~5 hours per engineer per review cycle on manual data archaeology across GitHub, Jira, and Slack. Her switch trigger: she knows she's losing engineers like Marek because she can't see and communicate their real contribution clearly enough to retain them. Replacing a senior engineer costs $150K–$200K. One retained departure = the tool pays for itself.

## Success Criteria

### Primary
Manager creates a Board linked to a GitHub org and, within one session, can view any IC's contribution profile — PRs authored, code reviews given, comments by semantic category — without opening GitHub directly.

### Secondary
Comment classification is visible to the IC: each classified comment shows its assigned category and allows the IC to signal agreement or correction ("this was classified as X — does that look right?"). Addresses AI trust concerns proactively.

### Guardrails
- No individual ranking or comparison across ICs — the tool must never present a comparative view or rank team members against each other.
- IC sees the same data their EM sees when viewing their profile — no hidden management-only layer.
- No raw comment content stored after classification — data handled with minimum retention.

## User Stories

### US-01: EM connects GitHub org and views IC contribution profile

- **Given** an EM who has created a Board and linked a GitHub org
- **When** they select an IC from the dropdown
- **Then** they see that IC's PRs authored, code reviews given, comment counts, and classified comment categories for the connected period

#### Acceptance Criteria
- All data is sourced from GitHub — no manual data entry required
- Switching between ICs loads the selected IC's profile without a full page reload
- Empty state (no GitHub activity in period) shows an explanatory message, not blank metrics

# TODO: additional user stories — see Open Questions

## Functional Requirements

### Board management
- FR-001: EM can create a Board. Priority: must-have
  > Socrates: Counter-argument considered: "Board abstraction adds setup overhead — a flat workspace with a pre-set GitHub org is simpler for a single team." Resolution: kept; the Board is the correct multi-team abstraction even at v1 scale; setup overhead is a UX concern, not an architectural one.

- FR-002: EM can link a Board to a GitHub org or group. Priority: must-have
  > Socrates: Counter-argument considered: "Org-level link is too broad — a large GitHub org floods IC profiles with unrelated repo activity." Resolution: kept; repo filtering is a v2 configuration concern; linking at org level is the simplest integration path for v1.

- FR-003: EM can invite ICs to a Board by email. Priority: must-have
  > Socrates: No counter-argument considered; stands as written.

- FR-004: IC can access a Board after creating their account via an invitation link — no separate acceptance action is required. Priority: must-have
  > Socrates: Counter-argument considered: "IC opt-in step is redundant if EM controls GitHub access." Resolution: FR-004 revised — IC acceptance is not a separate confirmation gate; the IC receives an invite link, creates their password, and is automatically added to the Board. Consent is implicit in account creation.

- FR-005: IC can belong to more than one Board. Priority: must-have
  > Socrates: No counter-argument considered; stands as written.

- FR-017: EM can create and belong to more than one Board. Priority: must-have
  > Socrates: No counter-argument considered; stands as written.

- FR-018: EM can update a Board's GitHub connection settings (PAT, linked org). Priority: must-have
  > Socrates: No counter-argument considered; stands as written.

- FR-019: EM can add or remove ICs from a Board after initial setup. Priority: must-have
  > Socrates: No counter-argument considered; stands as written.

- FR-020: When the PAT is changed on either the Board-creation or Board-edit form, the app re-validates that the previously accessible repos and ICs remain reachable with the new credential; the EM is notified of any scope changes. Priority: must-have
  > Socrates: No counter-argument considered; stands as written.

- FR-021: EM can delete a Board and all its associated membership and profile data. Priority: must-have
  > Socrates: No counter-argument considered; stands as written.

- FR-022: When a Board's GitHub PAT expires or becomes invalid, the Board enters a frozen state (new data syncs are suspended); the EM is shown a persistent in-app prompt to update the PAT before data freshness degrades. Priority: must-have
  > Socrates: No counter-argument considered; stands as written.

### Contribution profile
- FR-006: EM can view any IC's contribution profile on their Board. Priority: must-have
  > Socrates: No counter-argument considered; stands as written.

- FR-007: EM can switch between ICs via a dropdown on the Board. Priority: must-have
  > Socrates: No counter-argument considered; stands as written.

- FR-008: IC can view their own contribution profile. Priority: must-have
  > Socrates: No counter-argument considered; stands as written.

### Metrics — GitHub data
- FR-009: Contribution profile shows PRs authored (count + list). Priority: must-have
  > Socrates: No counter-argument considered; stands as written.

- FR-010: Contribution profile shows code reviews given (count + list). Priority: must-have
  > Socrates: No counter-argument considered; stands as written.

- FR-011: Contribution profile shows review comments (count). Priority: must-have
  > Socrates: No counter-argument considered; stands as written.

- FR-012: Contribution profile shows review comments with assigned semantic category. Priority: must-have. Accuracy guardrail: classification approach must be validated on a representative data sample before launch.
  > Socrates: Counter-argument considered: "Low classification accuracy at launch destroys the trust proposition — misclassified glue work is worse than no classification at all." Resolution: kept as must-have; accuracy guardrail added (see above). Validation approach routes into Open Questions.

- FR-013: IC can flag a comment's assigned category as inaccurate. Priority: nice-to-have. Dependency: must not ship without a pathway to act on user correction signals.
  > Socrates: Counter-argument considered: "No feedback pipeline exists to act on flags — building the UI before the pipeline means stored flags are never acted on." Resolution: kept as nice-to-have with dependency constraint: ships only when a correction-signal pathway exists, not as standalone UI.

### Authentication
- FR-014: User can sign up with email + password. Priority: must-have
  > Socrates: No counter-argument considered; stands as written.

- FR-015: User can log in with email + password. Priority: must-have
  > Socrates: No counter-argument considered; stands as written.

- FR-016: First user on a Board (creator) is assigned EM role automatically. Priority: must-have
  > Socrates: Counter-argument considered: "Silent role auto-assignment creates confusion when the user discovers their role unexpectedly during account management." Resolution: kept as must-have; implementation note: role assignment must be made explicit at Board creation time (confirmation step or inline label), not applied silently.

## Non-Functional Requirements

- **Progressive load**: the contribution profile view opens immediately; individual metric sections that are not yet computed display an explicit "not ready yet" placeholder. The board never blocks on full data availability before rendering.
- **Accuracy floor**: classification results must be demonstrably better than random category assignment before launch. Validation method and minimum threshold are open questions (see Open Questions).
- **Data parity**: an IC viewing their own profile and an EM viewing that same profile see identical data. No hidden management-only fields exist. This is externally verifiable by comparing both views.

## Business Logic

GitGud classifies each code review comment into a semantic category — mentoring, architecture, bug-catch, nitpick, unblocking, or question — so the reviewer's intent is visible, not just their volume.

**Inputs the rule consumes**: the text of each review comment, the PR title and description (for context), and the comment's position in the diff (inline vs. summary). Attribution to the IC is via GitHub identity.

**Output**: a category label per comment. On the profile surface, category counts are shown as an aggregated breakdown (e.g. "13 architecture, 4 mentoring, 22 nitpick"). Clicking through reveals individual labels per comment.

**How the user encounters it**: the IC's contribution profile shows a category breakdown in the review comments section. The IC can see this breakdown themselves — the same view the EM sees — and can flag individual labels for review (see FR-013, dependency-constrained).

## Access Control

Auth: email + password. No OAuth in MVP.

Two roles: **IC** and **EM**. Both see the same contribution-profile view — IC sees their own data; EM can navigate between any IC on their team, viewing each IC's profile in turn. No ranking, no comparative view across ICs. Role separation enforces scope, not information asymmetry — transparency is a design value.

Sign-up: EM creates the workspace and invites team members. Each invited member creates an account (email + password). No self-serve team creation.

## Non-Goals

- **No Jira integration in v1.** GitGud is GitHub-only. No ticket-to-PR cross-referencing, story-point data, or epic context. Jira is explicitly deferred to v2 after the GitHub profile is validated.
- **No IC ranking or comparative views.** No team leaderboard, no percentile scores, no "top reviewer" views. The absence of comparison is a design constraint, not a UX omission — it is what makes the tool safe to use transparently.
- **No real-time data sync.** Data is fetched when the profile is loaded. The profile reflects data as of the last fetch.

## Open Questions

1. **What is the validation method and minimum accuracy threshold for comment classification before launch?** — Raised by FR-012 accuracy guardrail. Owner: TBD. Block: yes — must be resolved before launch; FR-012 cannot ship without a validated classification approach.

2. **What constitutes the correction-signal pathway that unlocks FR-013 for shipping?** — FR-013 ships only when this pathway exists and has been implemented. Owner: TBD. Block: FR-013 must not ship without resolution.

3. **What is the expected request rate (qps ballpark) for the application?** — Needed to complete `target_scale.qps`. Owner: TBD.

4. **What is the expected data volume ballpark?** — Needed to complete `target_scale.data_volume`. Owner: TBD.

5. **Are there additional user stories beyond US-01?** — Only the EM "view IC profile" flow is documented. The IC self-evaluation flow, the EM Board-setup flow, and the IC correction flow (FR-013, if shipped) each likely warrant a dedicated user story. Owner: TBD.
