# Empathy Maps: The Engineering Feedback Gap

**Date:** April 11, 2026  
**Status:** Pre-Interview Draft — Based on Secondary Research  
**Next step:** Validate and revise after discovery interviews

> **How to read this document:** Each empathy map has four quadrants (Says, Thinks, Does, Feels) plus Pain and Gain sections. Items marked with `[DATA]` are backed by specific research findings. Items marked with `[INFERRED]` are reasonable extrapolations that need interview validation.

---

## Empathy Map 1: Engineering Manager (EM)

**Profile:** Mid-level engineering manager, 6–12 direct reports, responsible for 1:1s, performance reviews, career development, and team delivery. Typically 3–7 years of management experience. Likely promoted from an IC role.

---

### SAYS

- "I spend more time looking for data than actually coaching my people." `[INFERRED]` — consistent with 45% time in meetings + 26% on communication leaving 11% for direct support [2-FA]
- "Fellow is decent for note-taking but it doesn't pull work context from GitHub." `[DATA]` — practitioner quote from Reddit [3-G]
- "Jira dashboards are too granular for 1:1s — I get ticket lists, not summaries." `[DATA]` — practitioner observation [3-G]
- "I know my team is doing good work, I just can't prove it at review time." `[INFERRED]` — consistent with the "visibility vacuum" thesis [1-FA]
- "I tried building a dashboard once. It worked for a month, then broke." `[DATA]` — pattern confirmed across Reddit and Hacker News [14-G, 15-G]
- "Writing a promo case for a senior engineer takes me an entire week." `[DATA]` — [12-G]

---

### THINKS

- "I'm not giving my people the feedback they deserve, and I know it." `[INFERRED]` — 95% of engineers say they need more development support, while leaders declare it a priority but fail to deliver [18-FA]
- "If I skip prep for this 1:1, nobody will notice — except maybe the engineer." `[INFERRED]` — consistent with the pattern that preparation is perceived as low-priority during high-stress sprints [cost of preparedness failure, G-report]
- "I used to be a good engineer. Now I spend my day in meetings and Slack." `[DATA]` — EMs spend only 4% of time writing code [2-FA]
- "Am I even measuring the right things? Ticket count doesn't tell me who's actually driving impact." `[INFERRED]` — consistent with the evolution from DORA velocity metrics toward rework rate and impact signatures [3-FA, 5-FA]
- "I'm worried I'm rewarding the loudest people, not the best." `[DATA]` — structural bias toward "loud" contributors documented [1-FA, 26-FA]
- "The review cycle is coming and I don't remember what happened in Q1." `[DATA]` — recency bias is a documented problem for both EMs and ICs [10-G]

---

### DOES

- Opens 3–5 tools (GitHub, Jira, Slack, Lattice/Fellow, Google Docs) before each 1:1 to manually piece together context. `[DATA]` — four-stage workflow confirmed [1-G, 2-G, 3-G]
- Spends ~5 hours per report per review cycle reconstructing achievement timelines. `[DATA]` — Reddit self-reports [10-G]
- Skips preparation when time is tight, defaults to status-update-style 1:1s. `[INFERRED]` — consistent with the "unprepared manager" outcome data: engagement drops to 15% [5-G]
- Attempts to build internal dashboards or spreadsheets, then abandons them within 1–2 months. `[DATA]` — [14-G]
- Exports data from dashboards into Excel to manage it manually. `[DATA]` — the "vicious cycle of exporting" [15-G]
- Blocks dedicated prep time on the calendar but frequently loses it to ad-hoc meetings. `[INFERRED]` — 60% of meetings are unplanned [8-FA]
- Receives 153 Teams messages and 117 emails per day, scanning for signals about team members. `[DATA]` — [9-FA]

---

### FEELS

- **Guilt** — knows that underprepared 1:1s are a disservice to engineers who trust them. `[INFERRED]` — consistent with the engagement/trust data gap between prepared and unprepared managers [5-G, 6-G]
- **Frustration** — tools exist for parts of the problem but nothing connects GitHub activity to Jira context to career narrative. `[DATA]` — "no single pane of glass" finding [G-report synthesis]
- **Overwhelm** — 275 interruptions per day, triple-peak workday, 3.6 hours/day searching for information. `[DATA]` — [8-FA, 9-FA, 10-FA]
- **Anxiety** — review season approaching with 8+ reports to write and incomplete data. `[DATA]` — 42% burnout rate for managers with 12+ reports [7-G]
- **Nostalgia** — misses the clarity of IC work where impact was visible in shipped code. `[INFERRED]`
- **Isolation** — problems feel personal ("I'm a bad manager") when they're actually infrastructure failures. `[DATA]` — the Feedback Gap is an infrastructure problem, not a personal one [G-report synthesis]

---

### PAINS

1. **Time poverty.** 45% meetings + 26% communication = 11% left for the actual job of developing people. Every hour spent on "data archaeology" is an hour not spent coaching. `[DATA]`
2. **Tool fragmentation.** No single tool connects version control, project management, and career development context. Each tool gives a slice; the EM has to assemble the puzzle. `[DATA]`
3. **Invisible contributions.** Can't see mentoring, code review quality, architectural influence, or unblocking in any dashboard. Risks rewarding "loud" over "effective." `[DATA]`
4. **Review cycle dread.** 5 hours per report × 8 reports = 40 hours of reconstruction work layered on top of regular duties. `[DATA]`
5. **Growing span of control.** Average span increased from 10.9 to 12.1 — the organization expects AI to compensate, but no tool actually does. `[DATA]`
6. **Failed workarounds.** Has already tried spreadsheets, custom scripts, or internal dashboards. They all broke or were abandoned. Skeptical of new tools. `[DATA]`

---

### GAINS

1. **Recovered coaching time.** If data gathering drops from hours to minutes, the EM can focus on the human conversation — the part they actually entered management to do. `[INFERRED]`
2. **Confidence in evaluations.** Data-backed conversations feel fair to both the EM and the engineer. Less anxiety about bias or favoritism. `[DATA]` — fairness perception gap between prepared/unprepared [8-G]
3. **Retention impact.** Even preventing one senior departure saves $150K–$200K — more than any tool subscription. `[DATA]` — [14-FA]
4. **Visibility for silent contributors.** Being able to surface mentoring, code review quality, and architectural work means the best engineers get recognized, not just the loudest. `[DATA]`
5. **Scalability.** A tool that works for 6 reports should still work for 12, allowing the EM to grow without quality collapse. `[INFERRED]`

---

---

## Empathy Map 2: Individual Contributor (IC)

**Profile:** Mid-to-senior software engineer (3–8 years experience), works in a team of 5–10, ships code via PRs, uses Jira/Linear for task tracking. Cares about career growth and fair recognition. May or may not have a regular 1:1 with their manager.

---

### SAYS

- "My manager doesn't see half of what I actually do." `[INFERRED]` — consistent with 65% of remote workers feeling overlooked [26-FA] and the "silent contributor" dynamic [1-FA]
- "Writing my self-evaluation is painful — I can't remember what I did in January." `[DATA]` — "blank page problem" [10-G]
- "I spend time mentoring juniors and reviewing code, but none of that shows up in my review." `[DATA]` — glue work is "notoriously hard to quantify" [11-G]
- "The metrics they track don't capture my real contribution." `[INFERRED]` — consistent with 75% dissatisfaction and developers feeling overlooked by commit-counting systems [13-FA]
- "I don't trust AI to summarize my work for my manager." `[DATA]` — 71% distrust AI accuracy [13-FA]
- "Performance reviews feel like a popularity contest." `[INFERRED]` — consistent with bias toward "loud" indicators and the recognition gap [26-FA, 1-FA]

---

### THINKS

- "Does my manager even know what I've been working on?" `[INFERRED]` — consistent with the visibility vacuum: managers spend 11% of time on direct support [2-FA]
- "If I don't advocate for myself, nobody will." `[DATA]` — engineers advised to "gather evidence before writing" as self-advocacy [13-G]
- "The review process rewards people who are good at marketing themselves, not necessarily the best engineers." `[INFERRED]` — consistent with brag doc dependency and "loud vs. silent" contributor gap
- "I know AI tools are supposed to help, but they're frustrating — almost good but not quite." `[DATA]` — 66% report this sentiment [11-FA]
- "I shouldn't have to spend three hours compiling my achievements when the data exists in GitHub and Jira already." `[DATA]` — 3h per review cycle [10-G]
- "My refactoring work saved the team weeks of debugging, but how do I put that in a self-evaluation?" `[DATA]` — quantification struggle for internal tasks [11-G]

---

### THINKS (private, wouldn't say out loud)

- "My manager's 1:1s feel like status updates. I'm not getting real coaching." `[INFERRED]` — consistent with the unprepared manager pattern shifting 1:1s to transactional mode [G-report]
- "I'm considering leaving, but it's not about money — I just don't feel seen." `[DATA]` — 78% of devs planning to leave cite stress and lack of management awareness [17-G]; top attrition drivers include lack of trust/autonomy (31%) and insufficient development support [13-FA]
- "I wonder if the people getting promoted are actually better, or just louder." `[INFERRED]` — consistent with the recognition gap data

---

### DOES

- Spends ~3 hours per review cycle reconstructing achievements from GitHub, Jira, Slack, and email. `[DATA]` — [10-G]
- May keep a brag document but updates it inconsistently — often stops after a few weeks. `[DATA]` — maintenance fatigue [11-G]
- Omits "glue work" (mentoring, documentation, process improvements) from self-evaluations because it's hard to quantify. `[DATA]` — [11-G]
- Defaults to listing recent projects in self-evaluations, under-representing earlier work (recency bias). `[DATA]` — [10-G]
- Uses AI tools daily (51%) but doesn't trust them to accurately represent their work (71% distrust). `[DATA]` — [12-FA, 13-FA]
- Works a "triple peak" day — including an evening session after 8 PM to catch up on focused work missed during meeting-filled days. `[DATA]` — [8-FA]

---

### FEELS

- **Invisible.** Especially for remote workers (65% feel overlooked) and engineers doing stabilization/mentoring work that doesn't generate "loud" signals. `[DATA]`
- **Frustrated.** The data about their contributions exists in the tools — it's just not assembled or presented in a way that matters. `[INFERRED]`
- **Skeptical.** 71% don't trust AI accuracy. Any tool claiming to "measure their productivity" will face resistance by default. `[DATA]`
- **Fatigued.** The self-evaluation process feels like unpaid administrative labor stacked on top of actual engineering work. `[DATA]` — [10-G]
- **Anxious about fairness.** Worries that evaluations are shaped by recency bias, manager memory, and political visibility rather than actual impact. `[DATA]` — [8-G]
- **Undervalued.** Particularly for engineers focused on code quality, technical debt, and mentoring — the work that keeps systems alive but doesn't generate feature-launch celebrations. `[DATA]` — [1-FA, 26-FA]

---

### PAINS

1. **Achievement amnesia.** Can't recall specific impact from 4–6 months ago. The "blank page" before a self-evaluation is demoralizing. `[DATA]`
2. **Glue work invisibility.** Mentoring, documentation, code review quality, and unblocking work are critical but have no natural "metric home." `[DATA]`
3. **Self-advocacy burden.** Shouldn't need to be a marketer on top of being an engineer, but the review system demands it. `[DATA]`
4. **AI distrust.** Wants tools to help but doesn't trust them — "almost good but not quite" creates more frustration than having no tool at all. `[DATA]`
5. **Unfair comparisons.** Fears that automated metrics (commit count, ticket velocity) will be used for comparison without context. `[INFERRED]`
6. **No feedback loop.** May go months without substantive developmental feedback if the manager is overwhelmed. `[DATA]` — performance detection lag of 10–14 weeks for unprepared managers [7-G]

---

### GAINS

1. **Automatic achievement log.** If the tool reconstructs their contribution timeline from existing data, the 3-hour self-evaluation becomes minutes. `[INFERRED]`
2. **Visibility for invisible work.** Mentoring, code review quality, and architectural contributions surfaced alongside feature delivery — a complete picture. `[DATA]`
3. **Fairer evaluations.** Data-backed reviews reduce the influence of recency bias and political visibility. `[DATA]`
4. **Career development support.** If the manager arrives at a 1:1 with context, the conversation can focus on growth instead of status updates. `[INFERRED]`
5. **Transparency.** If both the IC and the EM see the same data, there's a shared foundation for honest conversation. `[DATA]` — from product conversation: "Transparency jest dla mnie cenne, jeśli każdy ma dostęp do narzędzia to widzimy wszyscy to samo"

---

---

## Cross-Map Observations

Three patterns emerge when reading both maps together:

**1. Shared pain, different experience.** Both the EM and the IC suffer from the same data fragmentation problem, but experience it differently. The EM feels it as preparation burden; the IC feels it as invisibility. The tool needs to solve both sides simultaneously — not just the manager's workflow.

**2. The trust paradox.** The EM wants data-driven coaching. The IC distrusts automated metrics. Any tool that serves the EM without earning the IC's trust will fail — engineers will perceive it as surveillance, not support. The product conversation already flagged this: naming matters, framing matters, transparency is non-negotiable.

**3. The "silent contributor" is the highest-risk persona.** The engineer most likely to churn is the one doing critical but invisible work — mentoring, stabilization, refactoring. This is also the person least likely to maintain a brag document or advocate for themselves. If the tool doesn't actively surface their contributions, it reinforces the exact bias it was built to eliminate.

---

## Interview Validation Checklist

After running discovery interviews, revisit each `[INFERRED]` item and either promote it to `[DATA]` with a supporting quote, or remove/revise it. Pay special attention to:

- [ ] Does the EM actually feel guilty about underprepared 1:1s, or is it more neutral ("that's just how it is")?
- [ ] Do ICs know when their manager is unprepared? How does it feel?
- [ ] Is the brag document a real practice or mostly an internet recommendation?
- [ ] What's the emotional reaction to "AI summarizing your PRs for your manager"?
- [ ] Does the "silent contributor" persona resonate, or is it too abstract?
- [ ] What would make someone pay for this? What's the "switch" moment?
