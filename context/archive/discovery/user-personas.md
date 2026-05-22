# User Personas: The Engineering Feedback Gap

**Date:** April 11, 2026  
**Status:** Pre-Interview Draft — Based on Secondary Research  
**Depends on:** Empathy Maps, Pre-Interview Research Report  
**Next step:** Validate with discovery interviews, then revise

> **Note on data confidence:** Items marked `[DATA]` are sourced from research. Items marked `[INFERRED]` are reasonable extrapolations awaiting interview validation. Personas will be revised after the first round of interviews — expect some assumptions to be wrong.

---

## Persona 1: "The Drowning Coach" — Marta, Engineering Manager

### Demographics & Context

| Attribute | Value |
|-----------|-------|
| Role | Engineering Manager |
| Experience | 8 years as engineer, 3 years as EM |
| Reports | 9 direct reports (up from 7 last year) |
| Company type | Mid-size product company, 200–500 engineers |
| Work mode | Hybrid — in office 2–3 days/week |
| Tools used daily | GitHub, Jira, Slack, Google Docs, Lattice |

### Background

Marta was promoted from a senior engineer role three years ago because she was good at mentoring and unblocking people. She took the management track because she believed she could have more impact through others. She still identifies as a technical leader, but her calendar tells a different story — 45% of her time is meetings, 26% is Slack and email, and she writes code maybe half a day a week. `[DATA]` — [2-FA]

Her team grew from 7 to 9 this year after a reorg. The company assumed that "modern tooling" would help her absorb the increase. It hasn't. She now runs nine biweekly 1:1s, participates in sprint ceremonies, attends cross-team syncs, and is expected to write thorough performance reviews twice a year. `[DATA]` — span of control trend from 10.9 to 12.1 average [20-G]

### Goals

1. **Run 1:1s that actually develop people.** Marta wants every 1:1 to be a coaching conversation, not a status update. She knows the difference matters — she's seen the engagement data. `[DATA]` — 3x engagement gap [5-G]
2. **Write fair, evidence-based performance reviews.** She's terrified of recency bias and knows she probably rewards "loud" contributors more than "silent" ones. She wants data to keep her honest. `[DATA]` — [1-FA, 26-FA]
3. **Surface invisible contributions.** One of her best engineers spends 30% of his time mentoring juniors and reviewing PRs. None of that shows up in Jira velocity. She needs a way to make it visible at review time. `[DATA]` — glue work invisibility [11-G]
4. **Not burn out.** She already works a "triple peak" day. Adding more manual data gathering is not sustainable. `[DATA]` — [8-FA]

### Frustrations

1. **The "detective hour."** Before each 1:1, she opens GitHub to check PR activity, Jira to see ticket progress, Slack to scan for mentions of blockers, and her Google Doc of previous 1:1 notes. This takes 10–15 minutes per person when she does it well, and she often doesn't have time to do it well. `[DATA]` — [1-G, 2-G]
2. **Review season is a nightmare.** At 5 hours per report, her 9-person team costs her 45 hours of reconstruction work — more than a full working week, layered on top of everything else. `[DATA]` — [10-G]
3. **Tools don't talk to each other.** Lattice handles goals and notes. GitHub has code activity. Jira has project context. Nothing connects a PR to a business outcome to a career development goal. She is the integration layer. `[DATA]` — [3-G]
4. **Failed experiments.** She once spent a weekend building a Retool dashboard that pulled GitHub and Jira data. It worked for six weeks, then a Jira API change broke the mapping logic and she never fixed it. `[DATA]` — [14-G]
5. **Guilt.** She knows when she's gone into a 1:1 underprepared. The conversation becomes shallow. The engineer notices, even if they don't say anything. `[INFERRED]`

### Behaviors

- Prepares for 1:1s in a four-stage process (review notes → check GitHub → check Jira → set agenda) but frequently truncates it under time pressure. `[DATA]` — [1-G]
- Maintains a shared Google Doc per engineer for 1:1 notes, but rarely reviews entries older than 2–3 weeks. `[INFERRED]`
- Writes performance reviews in concentrated bursts during "review season" — often evenings and weekends — because there's no time during the regular workday. `[INFERRED]` — consistent with triple-peak workday data [8-FA]
- Receives 153 Teams/Slack messages and 117 emails per day. Scans for signals about team members but frequently misses things. `[DATA]` — [9-FA]
- Has tried: spreadsheets, a Retool dashboard, a Slack bot that posts weekly summaries, asking engineers to fill in brag docs (adoption was inconsistent). `[DATA]` — [14-G, 11-G]

### Quote (composite, not verbatim)

> "I became a manager to grow people, not to be a data entry clerk. But right now, the system punishes me for doing the thing I'm supposed to do — because there's no time left to actually do it."

### Relationship to the Product

Marta is the **primary buyer and daily user**. She would evaluate the tool based on: how much preparation time it saves, whether it surfaces contributions she currently misses, and whether it makes review writing faster. Her biggest fear is that the tool becomes another dashboard that breaks or gets abandoned. She's been burned before.

**Switch trigger:** A tool that cuts her per-person review prep from 5 hours to under 1 hour, while surfacing code review quality and mentoring contributions she currently can't see.

**Resistance points:** Skepticism about AI accuracy (she shares her team's 29% trust level). Concern about how ICs will perceive the tool — she doesn't want her team to feel surveilled. Price sensitivity if it's per-seat.

---

## Persona 2: "The Invisible Pillar" — Marek, Senior Software Engineer

### Demographics & Context

| Attribute | Value |
|-----------|-------|
| Role | Senior Software Engineer |
| Experience | 6 years |
| Team size | 8 people (including EM) |
| Company type | Same as Marta's — mid-size product company |
| Work mode | Mostly remote (in office 1 day/week) |
| Tools used daily | VS Code, GitHub, Jira, Slack |

### Background

Marek is the engineer everyone goes to when something is broken or confusing. He's the person who reviews the most PRs on the team, mentors two junior engineers informally, and recently refactored a critical payment service that reduced incident response time by 40%. He doesn't talk about it much — he just does it.

His last performance review was "meets expectations." He was told his ticket velocity was lower than the team average. The refactoring work and mentoring were mentioned in passing but not weighted. He's been thinking about interviewing elsewhere — not because of money, but because he doesn't feel seen. `[DATA]` — 78% of devs planning to leave cite stress and lack of management awareness [17-G]; "silent contributor" pattern [1-FA, 26-FA]

### Goals

1. **Be recognized for actual impact, not ticket count.** Marek knows that his mentoring saves the team weeks of ramp-up time and his refactoring prevents incidents. He wants that to matter in his evaluation. `[DATA]` — [11-G]
2. **Spend less time on self-evaluation paperwork.** He resents spending 3 hours reconstructing his achievements when the data already exists in GitHub and Jira. `[DATA]` — [10-G]
3. **Get meaningful career feedback.** He wants his 1:1s to be about growth — what to learn next, how to get to staff level — not status updates. `[INFERRED]`
4. **Fair comparison.** He's fine being measured, but the metrics need to capture what matters. Lines of code and ticket count actively misrepresent his contribution. `[DATA]` — metric misalignment [3-G]

### Frustrations

1. **The "blank page" problem.** Every review cycle, he stares at an empty self-evaluation and tries to remember what he did four months ago. He knows he did important work but can't reconstruct the specifics. `[DATA]` — [10-G]
2. **Glue work is invisible.** He spent two weeks unblocking a junior engineer's architecture problem. There's no Jira ticket for that. It doesn't show up anywhere. `[DATA]` — [11-G]
3. **Recency bias.** His manager remembers the feature he shipped last month but not the incident he prevented three months ago. `[DATA]` — [10-G]
4. **AI distrust.** He uses Copilot daily and finds it useful for boilerplate, but he doesn't trust AI to accurately assess the quality or impact of his work. 66% of his peers share the "almost good but not quite" frustration. `[DATA]` — [11-FA]
5. **Remote penalty.** Working mostly remote, he gets less "face time" with leadership. He suspects his in-office peers are more visible during promotion conversations. `[DATA]` — 65% of remote workers feel overlooked [26-FA]

### Behaviors

- Reviews 3–5 PRs per week, often leaving detailed architectural comments. Spends more time on reviews than on writing his own code some weeks. `[INFERRED]` — consistent with code review dynamics in the product conversation
- Keeps a brag document in Notion but updates it sporadically — usually a burst of entries right before review season, then nothing for months. `[DATA]` — maintenance fatigue [11-G]
- Writes self-evaluations by going through his GitHub commit history, Jira board, and Slack search. Takes approximately 3 hours. `[DATA]` — [10-G]
- Rarely brings up mentoring in 1:1s because it feels like bragging. Waits for the manager to ask. `[INFERRED]`
- Uses AI coding tools daily (Copilot, ChatGPT) but would not trust an AI-generated summary of his work without reviewing it himself. `[DATA]` — [12-FA, 13-FA]

### Quote (composite, not verbatim)

> "I could ship more tickets if I stopped reviewing PRs and mentoring juniors. But then the codebase would rot and the new hires would flounder. I just wish someone noticed."

### Relationship to the Product

Marek is the **primary beneficiary but not the buyer.** He won't purchase the tool himself — his manager or the org will. His engagement determines whether the tool succeeds or fails: if ICs perceive it as surveillance, they'll game the metrics or resist adoption.

**Switch trigger:** A tool that automatically surfaces his code review quality, mentoring contributions, and architectural impact alongside his delivery metrics — so his self-evaluation writes itself and his manager sees the full picture.

**Resistance points:** Strong distrust of AI-generated assessments (71%). Fear that metrics will be used for comparison or ranking without context. Needs to see the data himself before it goes to his manager — transparency is non-negotiable.

---

## Persona 3: "The Rising Tide" — Ania, Junior Software Engineer

### Demographics & Context

| Attribute | Value |
|-----------|-------|
| Role | Junior Software Engineer |
| Experience | 1.5 years |
| Team size | 8 people (same team as Marek) |
| Company type | Same mid-size product company |
| Work mode | Hybrid |
| Tools used daily | VS Code, GitHub, Jira, Slack |

### Background

Ania joined the team 18 months ago out of a bootcamp. She's ramping up quickly, largely thanks to Marek's informal mentoring and detailed PR comments. She doesn't fully understand the review process yet — her first annual review was a mix of generic praise and vague suggestions to "take on bigger projects." She left the conversation unclear about what she was doing well and what she needed to change.

She's eager to grow but unsure what "impact" looks like at her level. She doesn't keep a brag document because she doesn't know what to put in it. `[INFERRED]` — consistent with the observation that junior engineers adopt brag docs at lower rates because they're still learning what "impact" means [G-report]

### Goals

1. **Understand what "good" looks like.** She wants concrete, specific feedback — not "you're doing great, keep it up." `[INFERRED]`
2. **Learn from code reviews.** Marek's PR comments are her best learning resource. She wants more of that, and she wants to know what to focus on. `[INFERRED]` — consistent with mentoring value of code review [23-FA, 24-FA]
3. **Build a track record.** She's starting to think about what a promotion case looks like and wants to start documenting her growth, but doesn't know how. `[INFERRED]`
4. **Feel like a real contributor.** She sometimes worries that her ticket velocity being lower than seniors means she's underperforming, when in reality she's learning. `[INFERRED]`

### Frustrations

1. **Vague feedback.** Her manager's 1:1s are friendly but unspecific. She leaves without clear action items. `[INFERRED]` — consistent with the unprepared-manager pattern
2. **Comparison anxiety.** She can see team dashboards that show ticket completion rates. Hers is lowest. She doesn't understand that this is expected for someone at her level. `[INFERRED]`
3. **No feedback on learning.** Nobody quantifies how much she's improved at code review, testing, or system design over the past year. Growth is invisible too. `[INFERRED]`
4. **Doesn't know what to advocate for.** The concept of self-advocacy in reviews is alien to her. She fills in the self-evaluation form with a list of tickets and hopes for the best. `[INFERRED]`

### Quote (composite, not verbatim)

> "I know I'm getting better, but I can't prove it. My ticket count says I'm the slowest person on the team. Is that what my manager sees?"

### Relationship to the Product

Ania is a **secondary user and indirect beneficiary.** She's unlikely to interact with the tool directly in the early version, but she benefits significantly if:

- Her manager arrives at 1:1s with specific observations about her growth trajectory (not just ticket velocity)
- The tool captures Marek's mentoring of her as a contribution on his side and a growth signal on hers
- Code review quality feedback helps her learn what to focus on

**Key design implication:** If the tool only surfaces productivity metrics (PRs, tickets, velocity), it will actively harm Ania by reinforcing comparison anxiety. Any IC-facing view must contextualize metrics by experience level, or it becomes a source of stress rather than growth.

---

## Persona 4: "The Skeptical VP" — Krzysztof, VP of Engineering

### Demographics & Context

| Attribute | Value |
|-----------|-------|
| Role | VP of Engineering |
| Experience | 15 years in tech, 7 in leadership |
| Org size | 4 teams, 35 engineers, 4 EMs reporting to him |
| Company type | Same mid-size product company |
| Work mode | In office 3–4 days/week |

### Background

Krzysztof doesn't prepare for 1:1s with individual engineers — he manages managers. His problem is one level up: he needs to know whether his EMs are developing their people effectively, whether the engineering org is healthy, and where the systemic risks are. He gets this information today through a combination of skip-levels, quarterly reviews, and gut feel.

He's seen multiple "engineering intelligence" tools pitched to him. He approved the budget for Lattice (used mostly for OKRs, not for developer feedback). He's skeptical of any tool that promises to "measure developer productivity" because he's watched commit-counting dashboards erode trust. `[INFERRED]` — consistent with metric misalignment data [3-G]

### Goals

1. **Org-level health signals.** Are code review cycles getting longer? Is one team consistently blocked? Is mentoring happening or are juniors being thrown into the deep end? `[INFERRED]`
2. **EM effectiveness.** Are his managers actually coaching, or are they drowning in admin? He suspects the latter but can't prove it. `[INFERRED]` — consistent with the "leadership execution gap" [18-FA]
3. **Retention risk detection.** He lost two senior engineers last quarter. Both cited "lack of growth opportunities" in exit interviews. He wants early warning signals. `[DATA]` — [17-G, 14-FA]
4. **Justify investment.** If he buys a tool, he needs to show ROI to the CTO. Reduced turnover is the easiest story. `[DATA]` — $150K–$200K per senior departure [14-FA]

### Frustrations

1. **No aggregated view.** He can't see team-level patterns without asking each EM to compile reports manually. `[INFERRED]`
2. **Recency bias at org level.** He makes promotion and reorg decisions based on recent performance signals, not longitudinal data. `[INFERRED]`
3. **Tool fatigue.** The org already pays for Jira, GitHub, Slack, Lattice, and a CI/CD platform. Adding another tool needs a strong case. `[INFERRED]`
4. **Culture risk.** He won't approve anything that engineers perceive as surveillance. He knows trust is fragile. `[DATA]` — 29% AI trust [13-FA]

### Quote (composite, not verbatim)

> "I don't want to measure my engineers. I want to measure my system. Show me where the process is broken, not who's falling behind."

### Relationship to the Product

Krzysztof is the **budget holder and organizational champion** (or blocker). He won't use the tool daily, but his approval determines adoption. He'll evaluate it on:

- Does it help his EMs be better coaches? (Development story)
- Can he see org-level health without micromanaging? (Aggregated view)
- Will engineers accept it? (Trust/culture story)
- What's the ROI? (Retention economics)

**Switch trigger:** Evidence that the tool reduces turnover risk or frees EM capacity for coaching. One prevented senior departure = tool pays for itself.

**Resistance points:** Tool fatigue, cost, culture risk. Needs proof that engineers don't hate it. Will want a pilot before org-wide rollout.

---

## Persona Priority Matrix

| Persona | Role in Adoption | Frequency of Use | Research Confidence | Interview Priority |
|---------|-----------------|-------------------|--------------------|--------------------|
| **Marta** (EM) | Buyer + Daily User | Daily/Weekly | High — strong data coverage | **#1** — validate workflow and time estimates |
| **Marek** (Senior IC) | Beneficiary + Trust Gatekeeper | Weekly/Per-cycle | Medium — "silent contributor" pattern needs validation | **#2** — validate visibility pain and AI trust reaction |
| **Ania** (Junior IC) | Indirect Beneficiary | Rare (via manager) | Low — mostly inferred | **#3** — validate comparison anxiety and feedback quality |
| **Krzysztof** (VP) | Budget Holder | Monthly/Quarterly | Low — mostly inferred | **#4** — validate buying criteria and culture concerns |

---

## Open Questions for Interview Validation

1. **Is Marta real?** Do EMs actually follow a four-stage prep process, or is this a blog-idealized version of what happens? What does "I didn't have time to prepare" actually look like in practice?
2. **Does Marek exist on every team?** Is the "silent contributor" a universal pattern, or is it specific to certain team structures or engineering cultures?
3. **How much does Ania suffer?** Is comparison anxiety a real pain for junior engineers, or do they not think about metrics at all until they're more senior?
4. **Will Krzysztof actually buy?** What's the real budget authority? Does the VP make tool decisions, or does the EM have a discretionary budget for productivity tools?
5. **Is there a persona we're missing?** Tech leads, staff engineers, HR/People Ops? Who else touches the feedback process?