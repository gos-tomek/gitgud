# The Engineering Feedback Gap

## Problem

Engineering managers lack efficient access to data-driven feedback about how their team's software development process works — and where it breaks down.

Today, understanding what happens between "ticket created" and "code in production" requires manually piecing together information scattered across multiple tools (GitHub, Jira, Slack, email). This "data archaeology" is slow, incomplete, and rarely happens with enough rigor to support meaningful conversations about process improvement or individual growth.

The result: managers either rely on gut feeling and anecdotal evidence, or they spend hours assembling a picture that should be available at a glance. Engineers, in turn, lack objective data about their own work patterns and contributions — data that could help them grow and prepare for performance reviews.

This is not a tooling gap in the traditional sense. Tools like GitHub and Jira already capture rich data. The gap is in **making that data accessible, connected, and interpretable** — without requiring someone to manually cross-reference systems every time they need an answer.

## Context: Why This Problem Is Getting Worse

Several trends are compounding the problem:

- **Information overload is accelerating.** Knowledge workers now receive an average of 153 chat messages and 117 emails per day, with ad-hoc meetings making up 60% of all meetings. Microsoft telemetry shows workers are interrupted approximately every 2 minutes — around 275 times per day. ([Microsoft Work Trend Index 2025 — Breaking Down the Infinite Workday](https://www.microsoft.com/en-us/worklab/work-trend-index/breaking-down-infinite-workday))

- **Engineering managers are time-starved.** EMs spend an average of 17.9 hours per week in meetings — roughly 45% of their workday — leaving only about 10.4 hours of focus time for strategic work and direct support of their team. The remaining time goes to communication (Slack, email) and administrative tasks. ([Clockwise Engineering Meeting Benchmark Report](https://www.getclockwise.com/eng-meeting-benchmarks); [Stackademic](https://blog.stackademic.com/what-your-engineering-manager-actually-does-all-day-41f5adffe1c4))

- **Developers lose significant time to information retrieval, and trust in productivity measurement is low.** 63% of developers spend more than 30 minutes per day just searching for answers or solutions. Meanwhile, only 29% of developers trust the accuracy of AI-driven productivity tools — down from ~40% in prior years. Positive sentiment toward AI tools has dropped from 77% (2023) to 60% (2025). ([Stack Overflow Developer Survey 2023](https://survey.stackoverflow.co/2023/#section-productivity-productivity-at-work); [Stack Overflow Blog 2025](https://stackoverflow.blog/2025/12/29/developers-remain-willing-but-reluctant-to-use-ai-the-2025-developer-survey-results-are-here/))

- **Metrics are evolving beyond simple throughput.** The 2025 DORA report introduced "rework rate" as a key metric, signaling that quality and stability matter as much as deployment frequency — especially as AI-generated code becomes common. ([InfoQ — DORA 2025](https://www.infoq.com/news/2026/03/ai-dora-report/); [EfficientlyConnected](https://www.efficientlyconnected.com/the-state-of-ai-assisted-software-development-and-the-impacts-on-team-performance/))

- **The cost of getting it wrong is high.** Replacing a senior engineer costs $150,000–$200,000 when accounting for recruitment, onboarding, and lost productivity. The average voluntary turnover rate in the US declined from 17.3% (2023) to 13.5% (2024) to 13.0% (2025), but remains a significant cost center — especially given that autonomy, trust, and growth support are among the top drivers of job satisfaction. ([BetterWay Devs](https://www.betterway.dev/posts/how-to-calculate-turnover-cost-for-tech-teams); [Mercer 2025 US Turnover Survey](https://www.imercer.com/articleinsights/workforce-turnover-trends); [Stack Overflow Blog 2025](https://stackoverflow.blog/2025/12/29/developers-remain-willing-but-reluctant-to-use-ai-the-2025-developer-survey-results-are-here/))

- **95% of IT and business professionals say they need more support to learn tech skills**, even though 95% of executives say building a learning culture is a priority. For the fourth consecutive year, the most cited obstacle is lack of time to learn. The gap is not in intent but in execution. ([Pluralsight Tech Skills Report 2025](https://www.pluralsight.com/resource-center/tech-skills-report-2025-ungated))

## Who Is Affected

- **Engineering Managers** who need to understand how their team's process works, identify bottlenecks, and have data-informed conversations with their engineers — but currently spend too much time on manual data collection to do any of this well.

- **Individual Contributors** who lack visibility into their own work patterns, contribution data, and process metrics — information that could help them grow, self-assess, and prepare documentation for performance reviews.

- **The whole team**, because process problems (e.g., review bottlenecks, unbalanced workload distribution) remain invisible until they cause friction, delays, or burnout.

## Impact of the Problem Remaining Unsolved

- **Wasted manager time.** Hours spent on "data archaeology" — manually cross-referencing GitHub PRs, Jira tickets, and Slack threads — instead of coaching, unblocking, and strategic thinking. [Assumption: ~1 hour per engineer per review cycle is spent on manual data retrieval. To be verified.]

- **Shallow or biased feedback.** Without data, feedback defaults to recency bias, visibility bias (rewarding "loud" work over "quiet" contributions like mentoring or refactoring), and subjective impressions.

- **Process bottlenecks stay hidden.** Problems like "one person does all the code reviews" or "PRs sit for days before anyone looks at them" are hard to spot without aggregated data, and may go unnoticed until they cause real damage.

- **Engineers can't self-serve.** In organizations where engineers write their own impact documents for performance reviews, they currently have to do their own archaeology — manually reconstructing what they worked on, what landed, and what impact it had.

- **Retention risk.** Poor feedback quality contributes to disengagement. The financial cost of losing a senior engineer ($150k–$200k) makes even a small improvement in retention significant.

## How People Deal With This Today

- **Manual archaeology.** Managers search through GitHub, Jira, and Slack before 1:1s or review cycles. This is time-consuming and produces incomplete results.

- **Gut feeling and memory.** In practice, most feedback conversations rely on what the manager happens to remember or what the engineer self-reports.

- **Existing tools (LinearB, Jellyfish, Swarmia, Sleuth, etc.).** These platforms offer engineering metrics, but they tend to focus on team-level DORA-style metrics or activity counts. Common gaps: they don't connect code-level activity to business context (Jira issues → epics → business value); they don't assess the quality of interactions (e.g., whether a code review comment was substantive); and they are not typically designed to surface data for individual growth conversations. [Assumption: competitive landscape analysis needed to verify specific gaps.]

- **Spreadsheets and custom scripts.** Some managers build their own dashboards. This works for one team but doesn't scale, requires maintenance, and lacks qualitative analysis.

## Desired Outcome

The end state we're aiming for:

- **Process visibility at a glance.** A manager can quickly see where the team's software delivery process is healthy and where it's struggling — across the full cycle from issue creation to code in production. This includes both quantitative metrics (PR cycle time, review turnaround, throughput) and qualitative signals (are review comments substantive? is review work distributed evenly?).

- **Drill-down from team to individual.** The same data is available at the team level (how does our process work?) and at the individual level (what has this person been working on? how do they interact with the process?). The individual view is not a ranking or comparison — it's context, set against the team backdrop.

- **Data the whole team can see.** Transparency is a design principle. If everyone has access to the same data, it becomes a shared language for discussing process and growth — not a surveillance tool wielded by management.

- **Less time collecting, more time interpreting.** The goal is to dramatically reduce the time spent gathering data, so that time can be spent on what matters: understanding what the data means, having productive conversations, and making decisions.

- **The tool shows data and offers hints — it doesn't prescribe.** Philosophy: "mirror + consultant." Show the numbers, allow interpretation, but offer contextual suggestions (e.g., "What does this metric mean?" or "Time to Merge increased by 40% while review comments decreased — here's what that might indicate"). The user always decides what to do with the information.

## Scope and Constraints

**In scope (Priority 1):**
- Data from GitHub (PRs/change requests, code reviews, comments, approvals, merge times, contributors) and Jira (issues, epics, estimates, statuses, linkage to PRs).
- Team-level and individual-level views.
- Connecting GitHub activity to Jira issues to provide business context for code changes.

**In scope (Priority 2 — to explore):**
- Qualitative assessment of code review comments using a language model, to distinguish substantive feedback from noise. Intended to use a local, open-source model. [Assumption: feasibility and accuracy to be validated through testing.]
- Data quality metrics — showing what percentage of PRs are linked to Jira issues, so the user knows how complete the picture is. If data can't be connected, the tool should say so explicitly rather than show incomplete metrics silently.
- Collecting manager's 1:1 notes as an additional data source for later analysis.

**Out of scope for now:**
- Calendar integration (interesting idea for overlaying capacity data on velocity, but no concrete plan yet).
- Slack or email data.
- Deployment tracking (not every merged PR is deployed — this varies by team's SDLC and needs research).

**Key constraints and assumptions:**
- [Assumption] PR-to-Jira linkage depends on issue IDs being present in PR titles or descriptions. If they're missing, the cross-referencing won't work and the tool should communicate this clearly.
- [Assumption] Different teams may have different SDLCs, which could affect how metrics are calculated. The tool may need to be configurable per team.
- [Assumption] The tool should not compare individuals against each other. Team context + individual context is sufficient.
- [Design constraint] Naming and presentation of metrics matters. The way data is labeled and framed will determine whether the tool feels like a "process mirror" or a "surveillance dashboard." This needs careful attention.
- [Design constraint] The tool should not be branded as "AI-powered." AI may be used under the hood (e.g., for comment quality assessment), but it's not the value proposition — the data is.

## Open Questions

1. **SDLC variability.** How do we handle teams with different workflows? A merged PR doesn't always mean "deployed to production." This affects how we define and calculate end-to-end metrics like time-to-market. Needs research.

2. **Competitive landscape.** What exactly do existing tools (LinearB, Jellyfish, Swarmia, Allstacks, etc.) offer? Where are their real gaps? Are any of them open source? This analysis is needed before we can confidently say what's missing.

3. **Estimation accuracy.** Showing how accurate a team's story point estimates are could build useful awareness — or it could create perverse incentives. Needs validation against what competitors do and how teams react.

4. **Comment quality assessment.** Using a language model to evaluate code review comments is promising but unproven. Key questions: Can a local open-source model do this well enough? What criteria define "substantive"? How do we avoid gaming? What's the accuracy gap vs. human judgment? (Research suggests LLMs currently lag humans by 12–23% in understanding developer intent. [Source: ResearchGate — Comparing Developer and LLM Biases in Code Evaluation](https://www.researchgate.net/publication/403154428_Comparing_Developer_and_LLM_Biases_in_Code_Evaluation))

5. **Privacy and trust.** How will engineers react to automated analysis of their PR comments and work patterns? The "mirror + consultant" philosophy and full transparency (everyone sees the same data) are intended to address this, but the risk of perceived surveillance is real. Only 29% of developers trust the accuracy of AI-driven tools (Stack Overflow 2025).

6. **Report generation vs. live dashboard.** Could the tool work as an on-demand report generator (import data for a given period, produce a report) rather than a persistent dashboard with a database? This has architectural implications and might simplify the MVP. Decision should be driven by technical constraints.

7. **Data completeness.** What percentage of PRs in a typical organization are properly linked to Jira issues? If it's low, the cross-referencing value drops significantly. The tool should measure and display its own data quality — but we need to understand baseline quality levels.

8. **Frameworks.** Are there established frameworks (SPACE, DORA, or others) that could guide default metric selection, or should the tool let leaders choose their own focus during setup?

---

*Document version: 3.1 (Source-verified)*
*Date: April 11, 2026*
*Source: Product discovery conversation + market research report*
*Status: Draft — all [Assumptions] require verification*
*All cited data points have been independently verified against original sources.*