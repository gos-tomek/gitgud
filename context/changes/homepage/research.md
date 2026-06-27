---
date: 2026-06-26T12:00:00+02:00
researcher: Claude (AI agent)
git_commit: 75a12261d0e5b364ed3b7560c6a94c4b10d5e3e8
branch: changes/homepage
repository: GitGud
topic: "Features and metrics inventory for homepage design"
tags: [research, homepage, metrics, features, classification, impact]
status: complete
last_updated: 2026-06-26
last_updated_by: Claude (AI agent)
last_updated_note: "Added follow-up: user-perspective metric guide — what each metric answers, how to read it, what actions it drives"
---

# Research: Features & Metrics Inventory for Homepage Design

**Date**: 2026-06-26T12:00:00+02:00
**Researcher**: Claude (AI agent)
**Git Commit**: 75a12261d0e5b364ed3b7560c6a94c4b10d5e3e8
**Branch**: changes/homepage
**Repository**: GitGud

## Research Question

Designing the homepage — what features and metrics does GitGud have, what do they measure, how to read them, and how to leverage them for homepage content?

## Summary

GitGud has **4 major feature areas** and **40+ distinct metrics** organized across 6 KPI cards, 4 author metrics, 9 reviewer metrics, 8 thread quality metrics, 10 intent classification categories, 5 domain categories, and several activity/collaboration views. The product's **wedge** — what distinguishes it from generic activity counters — is the AI classification of review comments by _intent_ (what the reviewer was trying to do) and _domain_ (what area of code it touches), shown transparently to the person being evaluated.

For the homepage, the metrics fall into three storytelling tiers:

1. **Hero stats** (platform-wide aggregates for credibility): boards, contributors, repos, % high-impact reviews
2. **Feature explanation** (what the product does): classification, contribution profiles, team visibility
3. **Social proof** (depth of analysis): the 40+ metrics that prove this isn't just a commit counter

---

## Detailed Findings

### 1. Platform-Wide Stats (Homepage Stats Bar)

These are the aggregate numbers planned for the homepage stats bar (`plan.md` Phase 2-3). They come from service-role queries across all boards.

| Stat                      | Source table             | Query                                                                                | What it tells visitors                                                          |
| ------------------------- | ------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| **Boards created**        | `boards`                 | `count(*)`                                                                           | Scale of adoption — how many teams use GitGud                                   |
| **Contributors tracked**  | `board_contributors`     | `count(DISTINCT github_login)`                                                       | How many engineers have profiles                                                |
| **Repos connected**       | `github_repos`           | `count(*)`                                                                           | Breadth of GitHub integration                                                   |
| **% high-impact reviews** | `thread_classifications` | % of threads with intent in (`architecture`, `bug-catch`, `mentoring`, `unblocking`) | The product's story in one number — proves GitGud finds invisible contributions |

The high-impact percentage is the most important stat for the homepage because it directly demonstrates the product thesis: a meaningful share of review comments are high-signal contributions (architecture guidance, mentoring, bug catches) that would otherwise be invisible.

---

### 2. Feature Areas — What GitGud Does

#### 2a. AI Review Classification (The Wedge)

GitGud's core differentiator. Every review comment thread is classified by a Cloudflare Workers AI model (`llama-3.3-70b`) using majority vote (3 independent calls, 2-of-3 agreement required).

**Intent categories** — what the reviewer was trying to do:

| Category       | Tier        | Description                                                                  | Homepage relevance                         |
| -------------- | ----------- | ---------------------------------------------------------------------------- | ------------------------------------------ |
| `architecture` | High-signal | Structural/component/API/data-flow guidance or firm objection to duplication | Core value prop — this is "invisible work" |
| `bug-catch`    | High-signal | Concrete defect or wrong behavior identified                                 | Proves code review catches real bugs       |
| `mentoring`    | High-signal | Explains a concept/convention aimed at the author's growth                   | The "glue work" persona — Marek's story    |
| `unblocking`   | High-signal | Concrete next step for a non-broken issue                                    | Shows proactive problem-solving            |
| `nitpick`      | Routine     | Trivial style/naming/formatting                                              | Baseline review activity                   |
| `question`     | Routine     | Clarification request                                                        | Normal review engagement                   |
| `praise`       | Routine     | Approval/thanks, no code change                                              | Positive signal, low effort                |
| `joke`         | Low-signal  | Humor/banter with no review substance                                        | Noise filtering                            |
| `self-review`  | Low-signal  | All comments from the PR author (auto-classified)                            | Auto-detected, separated                   |
| `unknown`      | Low-signal  | CI/bot noise, process logistics, unclassifiable                              | Noise filtering                            |

**Domain categories** — what area of code the feedback touches:

| Category         | Description                                |
| ---------------- | ------------------------------------------ |
| `functional`     | Correctness, bugs, security                |
| `refactoring`    | Code quality, no behavior change           |
| `documentation`  | Docstrings, READMEs, code comments         |
| `discussion`     | Questions, design conversation, praise     |
| `false-positive` | Concern raised then conclusively withdrawn |

**How to use on homepage**: The intent tier system is the strongest storytelling tool. The "X% high-signal" stat proves that a real share of code reviews contain architectural guidance, mentoring, and bug catches — exactly the work that's invisible in DORA metrics. The three-tier breakdown (high-signal / routine / low-signal) is visually intuitive.

#### 2b. Contribution Profiles (Impact Dashboard)

The main analytics view per contributor. Six top-level KPIs with period-over-period deltas, plus deep dives into authoring and reviewing behavior.

**6 KPI Cards** (the headline metrics):

| KPI                  | What it measures                                            | Unit                       | Delta                |
| -------------------- | ----------------------------------------------------------- | -------------------------- | -------------------- |
| **PRs authored**     | PRs opened in the period (any state)                        | count                      | % vs previous period |
| **Reviews given**    | Review submissions (approved, changes requested, commented) | count                      | % vs previous period |
| **Threads started**  | Review comment threads opened on others' PRs                | count                      | % vs previous period |
| **Time to merge**    | Median PR creation → merge time                             | hours (displayed as m/h/d) | % vs previous period |
| **Pickup time**      | Median PR creation → first review                           | hours (displayed as m/h/d) | % vs previous period |
| **Discussion ratio** | % of threads that generated at least one reply              | percentage                 | % vs previous period |

**How to use on homepage**: The 6 KPIs show that GitGud goes beyond "commit count". Time to merge and pickup time measure responsiveness. Discussion ratio measures engagement quality. Threads started is the direct proxy for "glue work" — the reviewer who leaves substantive threads is doing more than clicking "Approve".

#### 2c. Author Metrics (Deep Dive)

| Metric            | What it measures                                                            |
| ----------------- | --------------------------------------------------------------------------- |
| **PRs by state**  | Breakdown: merged, open, closed, draft + total                              |
| **Merge rate**    | % of non-draft PRs that were merged                                         |
| **PR size**       | Total + median additions, deletions, changed files                          |
| **Size buckets**  | XS (0-10), S (10-50), M (50-200), L (200-500), XL (500+ lines) distribution |
| **Time to merge** | p50, p75, p90 in hours                                                      |

#### 2d. Reviewer Metrics (Deep Dive)

| Metric                   | What it measures                                             |
| ------------------------ | ------------------------------------------------------------ |
| **Reviews by verdict**   | Approved / changes requested / commented / dismissed + total |
| **Pickup time**          | p50, p75, p90 in hours                                       |
| **Pickup histogram**     | <1h, 1-4h, 4-24h, 1-3d, 3d+ distribution                     |
| **Involvement %**        | % of board PRs (excluding own) reviewed                      |
| **Unique PRs reviewed**  | Count of distinct PRs reviewed                               |
| **Unique collaborators** | Count of distinct PR authors reviewed                        |

#### 2e. Thread Quality Metrics (The "GitGud Signal")

These 8 metrics are labeled "GitGud signal" in the UI — they represent the product's unique analytical contribution.

| Metric                        | What it measures                                  | Why it matters                                |
| ----------------------------- | ------------------------------------------------- | --------------------------------------------- |
| **Avg thread depth**          | Mean messages per thread                          | Deep threads = substantive technical exchange |
| **Discussion-sparking ratio** | % of reviewed PRs where reviewer started a thread | Measures engagement beyond "LGTM"             |
| **Deep discussions**          | Threads with 3+ messages                          | Quality indicator                             |
| **Multi-person threads**      | Threads with 2+ participants                      | Knowledge sharing indicator                   |
| **Inline thread ratio**       | % of threads anchored to file lines vs general    | Precision of feedback                         |
| **Author engagement**         | % of threads where PR author replied              | Measures if feedback lands                    |
| **First reply time**          | Average time to first reply                       | Responsiveness metric                         |
| **Threads per reviewed PR**   | Average threads per PR reviewed                   | Review thoroughness                           |

**How to use on homepage**: These 8 metrics are the strongest argument for GitGud's depth. No other tool measures "did the PR author actually respond to the review feedback?" or "how many threads turned into multi-person technical discussions?" These metrics quantify the _quality_ of code review, not just the _volume_.

#### 2f. Activity & Collaboration Views

| View                      | What it shows                                                         |
| ------------------------- | --------------------------------------------------------------------- |
| **Weekly activity chart** | Stacked area chart: PRs + reviews + threads per week                  |
| **Contribution heatmap**  | GitHub-style 52-week daily heatmap (all activity types)               |
| **Top collaborators**     | Top 10 PR authors reviewed, with avatar + PR count                    |
| **Repo activity**         | Per-repository breakdown: PRs, reviews, threads                       |
| **Recent PRs table**      | Last 10 authored + reviewed PRs with state, size, threads, merge time |

#### 2g. Threads Browser

A paginated, filterable table of AI-classified review threads with:

- Filters by intent, domain, role (started/received/self-review/joined), PR
- Expandable rows showing full conversation (all messages in thread)
- Per-thread: comment snippet, PR metadata, intent badge, domain badge, message count
- Role classification: who started the thread, who received the feedback

---

### 3. Time Period System

All metrics support 6 time periods with automatic period-over-period delta calculation:

| Slug  | Label         | Delta comparison               |
| ----- | ------------- | ------------------------------ |
| `7d`  | Last 7 days   | vs previous 7 days             |
| `30d` | Last 30 days  | vs previous 30 days            |
| `90d` | Last 90 days  | vs previous 90 days            |
| `6m`  | Last 6 months | vs previous 6 months           |
| `ytd` | Year to date  | vs same duration in prior year |
| `all` | All time      | no delta                       |

---

### 4. Data Pipeline

| Component            | Technology                                  | Details                                           |
| -------------------- | ------------------------------------------- | ------------------------------------------------- |
| **GitHub ingestion** | Octokit REST API via PAT                    | Paginates PRs, reviews, review comments per repo  |
| **Classification**   | Cloudflare Workers AI (`llama-3.3-70b`)     | Batch of 4 threads, 3x majority vote, 5 retries   |
| **Scheduling**       | Cloudflare Cron Trigger + Durable Workflows | Daily batch per board, deduped by date            |
| **Manual sync**      | UI button → POST `/api/github/sync`         | On-demand workflow trigger, polls status every 2s |
| **Backfill window**  | 90 days                                     | First sync fetches 90 days of history             |

---

### 5. Access Control Model

| Role                 | Can see                          | Can do                                         |
| -------------------- | -------------------------------- | ---------------------------------------------- |
| **Supervisor (EM)**  | All contributors on their boards | Switch between ICs, trigger sync, manage board |
| **Contributor (IC)** | Only their own profile           | View their own impact + threads                |

Both roles see identical data for the same profile — no hidden management layer. This transparency is a design constraint (PRD guardrail).

---

## Homepage Content Strategy Recommendations

Based on this research, here's how the features and metrics map to homepage sections:

### Hero Section

- **Headline**: "Surface the invisible contributions that keep your team running"
- **Subheadline**: Mention the three things GitGud does that nothing else does: classifies review intent, quantifies thread quality, makes glue work visible

### Features Section (3 cards)

1. **Review Classification** — AI classifies every review comment by intent (architecture, mentoring, bug-catch, nitpick...) and domain (functional, refactoring, documentation). Not just "how many reviews" but "what kind of reviews."
2. **Contribution Profiles** — 40+ metrics across 6 KPIs, author analysis, reviewer analysis, thread quality, activity trends. Period-over-period deltas show growth.
3. **Team Visibility** — Engineering managers see the same data ICs see. No hidden ranking. Data-backed evidence for performance reviews.

### Stats Bar (4 numbers)

1. Boards created
2. Contributors tracked
3. Repos connected
4. % high-impact reviews (the product's story in one number)

### Why These Stats

The first three stats establish scale/credibility. The fourth stat — % high-impact reviews — is the product's thesis condensed into a single number. It says: "X% of review comments in our system are architecture guidance, mentoring, or bug catches — and before GitGud, that work was invisible."

---

## Code References

- `src/types.ts:1-270` — All TypeScript types and interfaces
- `src/lib/services/impact-metrics.ts:130` — `getImpactSummary` (6 KPIs)
- `src/lib/services/impact-metrics.ts:284` — `getAuthorMetrics`
- `src/lib/services/impact-metrics.ts:404` — `getReviewerMetrics`
- `src/lib/services/impact-metrics.ts:518` — `computeThreadMetrics` (8 thread quality metrics)
- `src/lib/services/impact-metrics.ts:630` — `getActivityData`
- `src/lib/services/impact-metrics.ts:897` — `getClassificationAggregates`
- `src/lib/services/classification.ts:8` — AI model ID
- `src/lib/services/classification.ts:98-110` — Intent + domain category definitions
- `src/lib/classification-colors.ts:46-57` — Intent tier assignment (high-signal/routine/low-signal)
- `src/components/impact/KpiCards.tsx:7-14` — KPI descriptions
- `src/components/impact/ThreadQualitySection.tsx:63` — Thread quality metrics
- `src/components/impact/ClassificationSection.tsx:60` — Classification visualization
- `src/components/impact/ImpactView.tsx:176` — Main dashboard orchestrator
- `src/components/threads/ThreadsView.tsx:429` — Thread browser columns
- `supabase/migrations/20260618120000_thread_classifications.sql:3` — Classification table schema

## Architecture Insights

1. **Three-tier intent hierarchy** is the key analytical framework: high-signal (architecture, bug-catch, mentoring, unblocking) vs routine (nitpick, question, praise) vs low-signal (joke, self-review, unknown). This maps directly to the homepage narrative.

2. **Period-over-period deltas** on every KPI make the data actionable — not just "you did 12 reviews" but "that's 30% more than last period." This is a differentiator worth mentioning on the homepage.

3. **Thread quality metrics** (the "GitGud signal" badge in the UI) are the most unique analytical contribution — no competitor measures author engagement rate, discussion-sparking ratio, or multi-person thread count.

4. **Transparency constraint**: IC and EM see identical data. No hidden management layer. This is a product value, not just a technical choice.

5. **Classification methodology** (majority vote × 3, Cloudflare Workers AI) is shown transparently in the UI footer: "llama-3.3-70b · daily batch · majority vote ×3". This builds trust.

## Follow-up Research: User-Perspective Metric Guide

### Pytanie użytkownika

"Do czego służą te metryki, jak je czytać i wykorzystywać?" — z perspektywy EM (Marta) i IC (Marek).

---

### A. 6 KPI Cards — Szybki odczyt kondycji

#### PRs authored (liczba + delta %)

**Na jakie pytanie odpowiada:** Ile pracy produkcyjnej wylądowało w tym okresie?

**Jak czytać:** Surowa liczba otwartych PR-ów. Delta porównuje z poprzednim analogicznym okresem (np. 30d vs poprzednie 30d). Wzrost = więcej delivery, spadek = może refactoring, onboarding, lub urlop.

**Jak wykorzystać:**

- _IC_: Przed review pokazujesz: "W Q2 otworzyłem 23 PR-y, wzrost o 15% kw/kw" — konkretna liczba zamiast "dużo pracowałem".
- _EM_: Jeśli senior ma 0 PR-ów ale dużo reviews — to nie brak produktywności, to rola mentora. Metryka pomaga _nie karać_ za mentoring.

#### Reviews given (liczba + delta %)

**Na jakie pytanie odpowiada:** Ile razy ta osoba angażowała się w cudzą pracę?

**Jak czytać:** Liczba review submissions (approved, changes requested, commented). NIE liczy "tylko LGTM" — każdy submit się liczy, ale inne metryki (thread quality) mierzą _jakość_ tych review.

**Jak wykorzystać:**

- _IC_: "Zrecenzowałem 47 PR-ów w 90 dni" — dowód, że nie siedzisz w silosie.
- _EM_: Porównanie reviews given vs PRs authored daje proporcję "contributor vs reviewer". Senior z ratio 3:1 (reviews:PRs) to prawdopodobnie architekt/mentor, nie "niskoproduktywny developer".

#### Threads started (liczba + delta %)

**Na jakie pytanie odpowiada:** Ile razy ta osoba zostawiła _merytoryczny_ komentarz w code review?

**Jak czytać:** Wątki (root comments) otwarte na cudzych PR-ach. To NIE to samo co "reviews given" — jedno review może mieć 0 wątków (szybkie LGTM) albo 5 wątków (głębokie review). Wysoka liczba = ta osoba aktywnie feedbackuje.

**Jak wykorzystać:**

- _IC_: "Otworzyłem 83 wątki dyskusji w review" — ilościowy dowód na jakość review, nie tylko kliknięcie Approve.
- _EM_: Kluczowy leading indicator. Jeśli senior przestaje otwierać wątki → albo burnout, albo team się ustabilizował i nie potrzebuje tyle feedbacku.

#### Time to merge (mediana, w godzinach/dniach + delta %)

**Na jakie pytanie odpowiada:** Jak szybko ląduje praca tej osoby?

**Jak czytać:** Mediana czasu od otwarcia PR do merge. Krótki czas = sprawny pipeline. Długi czas = problemy z review, zbyt duże PR-y, zależności, lub brak reviewerów.

**Jak wykorzystać:**

- _IC_: Jeśli twój time-to-merge rośnie, a rozmiar PR się nie zmienił → wąskie gardło jest po stronie reviewerów. To argument za dodaniem ludzi do review rotation.
- _EM_: Metryka zdrowia procesu, nie osoby. Jeśli cały team ma 3d+ time-to-merge → trzeba poprawić review process. Jeśli jedna osoba ma 5d a reszta 1d → sprawdź czy ta osoba nie otwiera PR-ów w piątek wieczorem.

#### Pickup time (mediana + delta %)

**Na jakie pytanie odpowiada:** Jak szybko ta osoba reaguje na czyjś PR?

**Jak czytać:** Mediana czasu od otwarcia PR do pierwszego review tej osoby. Mierzy responsywność jako reviewer, NIE jakość review.

**Jak wykorzystać:**

- _IC_: "Mój median pickup time to 2h" — dowód, że nie blookujesz kolegów.
- _EM_: Najlepsza metryka do wykrywania bottlenecków. Jeśli ktoś ma pickup time 3d+ → albo jest overloaded, albo review nie jest priorytetem. Rozmowa 1:1, nie kara.

#### Discussion ratio (% + delta)

**Na jakie pytanie odpowiada:** Czy feedback tej osoby generuje prawdziwe dyskusje?

**Jak czytać:** % wątków otwartych przez tę osobę, w których ktoś odpowiedział. Wysoki % = komentarze są na tyle merytoryczne, że ludzie reagują. Niski % = może nitpicki, które autor ignoruje.

**Jak wykorzystać:**

- _IC_: Wysoki discussion ratio to dowód, że twoje komentarze nie są ignorowane — ludzie na nie odpowiadają.
- _EM_: Metryka jakości feedbacku. Osoba z 80% discussion ratio przy 50 wątkach = każdy komentarz generuje dialog. To złoto na review.

---

### B. Author Metrics — "Jak wygląda moja praca jako autor PR-ów?"

#### PRs by state (merged/open/closed/draft)

**Pytanie:** Ile mojej pracy dotarło do produkcji?

**Jak czytać:** Merged = sukces. Open = w trakcie. Closed (nie-merged) = porzucone/odrzucone. Draft = WIP. Zdrowy profil: większość merged, kilka open, minimalne closed.

**Jak wykorzystać:**

- _IC_: Wysoki merge rate (>80%) to sygnał, że twoje PR-y przechodzą review sprawnie. Niski merge rate → za dużo exploratory PRs? Za mało alignment przed kodowaniem?
- _EM_: Dużo closed/nie-merged u jednej osoby → może problem z planowaniem lub komunikacją w teamie, nie z osobą.

#### PR size (additions, deletions, changed files, mediana, rozkład XS-XL)

**Pytanie:** Czy moje PR-y mają rozsądny rozmiar?

**Jak czytać:** Rozkład pokazuje ile PR-ów wpada w kategorie XS (0-10 linii), S (10-50), M (50-200), L (200-500), XL (500+). Mediana linii na PR daje szybki benchmark.

**Jak wykorzystać:**

- _IC_: Jeśli większość twoich PR-ów to L/XL → trudno je zrecenzować, stąd długi time-to-merge. Argument: "rozbijam duże PR-y na mniejsze, dlatego mój PR count wzrósł, ale mediana spadła z 400 do 80 linii".
- _EM_: Team-wide: jeśli cały team ma medianę 300+ linii → PR-y są za duże. Warto postawić team norm na max 200 linii.

#### Time to merge percentiles (p50, p75, p90)

**Pytanie:** Ile czasu zajmuje merge moich PR-ów, i jak "ogon" wygląda?

**Jak czytać:** p50 = połowa PR-ów zamyka się w tym czasie. p90 = 90% PR-ów. Duża różnica p50 vs p90 oznacza, że _większość_ PR-ów idzie sprawnie, ale kilka utknie na długo.

**Jak wykorzystać:**

- _IC_: "p50 to 4h, p90 to 3d" → masz kilka PR-ów, które utykają. Warto zidentyfikować dlaczego (za duże? kontrowersyjne? brak reviewerów?).
- _EM_: p90 to najlepsza metryka do wykrywania systemowych problemów. Jeśli p90 rośnie, a p50 jest stabilne → masz long-tail problem (kilka PR-ów blokowanych).

---

### C. Reviewer Metrics — "Jak wygląda moja praca jako reviewer?"

#### Reviews by verdict (approved / changes requested / commented / dismissed)

**Pytanie:** Jaki jest mój "styl" review?

**Jak czytać:** Proporcja pokazuje, czy reviewer głównie approves (szybki LGTM), czy aktywnie prosi o zmiany. Zdrowy profil: mix approved + changes requested + commented. Prawie 100% approved = może za mało krytyczny. Prawie 100% changes requested = może za surowy.

**Jak wykorzystać:**

- _IC_: Zbalansowany mix to argument: "Nie jestem rubber-stamperem — 30% moich review to changes requested, bo wyłapuję problemy".
- _EM_: Jeśli ktoś ma 95% approved → czy naprawdę wszystko jest OK, czy ta osoba nie daje feedbacku? Porównaj z threads started — jeśli 95% approved ale 0 wątków = LGTM machine.

#### Pickup time histogram (<1h, 1-4h, 4-24h, 1-3d, 3d+)

**Pytanie:** Jak wygląda rozkład mojej responsywności?

**Jak czytać:** Histogram pokazuje ile PR-ów zrecenzowałeś w jakim czasie. Idealnie: największy słupek <1h lub 1-4h.

**Jak wykorzystać:**

- _IC_: "70% moich review robię w ciągu 4 godzin" — dowód, że nie blookujesz kolegów.
- _EM_: Jeśli ktoś ma duży 3d+ bucket → jest overloaded albo review nie jest priorytetem. Rozmowa o expectations.

#### Involvement % (% PR-ów boardu zrecenzowanych)

**Pytanie:** Jaki % pracy zespołu przechodzi przeze mnie?

**Jak czytać:** % PR-ów na boardzie (pomijając własne), w których ta osoba dała review. 30% involvement = recenzujesz co trzeci PR w teamie.

**Jak wykorzystać:**

- _IC_: Wysoki involvement % to konkretny dowód na "team player". "Uczestniczyłem w review 45% PR-ów teamu".
- _EM_: Zbyt wysoki involvement u jednej osoby = single point of failure. Zbyt niski = ta osoba nie uczestniczy w review. Dobra podstawa do rebalansowania review rotation.

---

### D. Thread Quality — "GitGud Signal" (8 metryk)

To jest rdzeń produktu. Te metryki mierzą _jakość_ interakcji w code review, nie ilość.

#### Avg thread depth (wiadomości na wątek)

**Pytanie:** Czy moje komentarze generują dialog, czy są jednorazowe?

**Jak wykorzystać:**

- _IC_: Depth > 2 = twoje komentarze wywołują prawdziwą dyskusję techniczną. To mentoring w akcji.
- _EM_: Niska depth przy dużej liczbie wątków = komentarze są powierzchowne (nitpicki). Wysoka depth przy małej liczbie = deep dives.

#### Discussion-sparking ratio (%)

**Pytanie:** Na ilu zrecenzowanych PR-ach otworzyłem przynajmniej jeden wątek?

**Jak wykorzystać:**

- _IC_: 60% discussion-sparking = na 6 z 10 PR-ów, które recenzujesz, zostawiasz merytoryczny komentarz. Nie jesteś LGTM machine.
- _EM_: Najlepsza metryka do odróżnienia rubber-stampera od prawdziwego reviewera. 5% = kliknij approve i idź dalej. 70% = każdy review to realna analiza.

#### Deep discussions (wątki z 3+ wiadomościami)

**Pytanie:** Ile razy mój komentarz wywołał pogłębioną wymianę zdań?

**Jak wykorzystać:**

- _IC_: "W tym kwartale miałem 12 deep discussions" — dowód na architekturalne rozmowy, mentoring, rozwiązywanie sporów designowych.
- _EM_: To jest metryka, której nie ma nigdzie indziej. Deep discussions to najbardziej wartościowa forma code review.

#### Multi-person threads (wątki z 2+ uczestnikami)

**Pytanie:** Ile razy mój komentarz ściągnął więcej ludzi do dyskusji?

**Jak wykorzystać:** Proxy dla knowledge sharing. Wątek, w który wchodzi trzecia osoba = wiedza się rozprzestrzenia. Idealne na review: "Moje komentarze wywołały 8 dyskusji, w których uczestniczyło więcej niż 2 osoby".

#### Inline thread ratio (%)

**Pytanie:** Jaki % moich wątków jest zakotwiczony w konkretnej linii kodu?

**Jak wykorzystać:**

- Wysoki % = precyzyjny, kontekstowy feedback ("ta linia ma bug"). Niski % = ogólne komentarze ("fajny PR"). Kontekstowy feedback jest bardziej actionable.

#### Author engagement (%)

**Pytanie:** Czy autor PR-a odpowiada na moje komentarze?

**Jak wykorzystać:**

- _IC_: Wysoki author engagement = twój feedback jest na tyle wartościowy, że ludzie odpowiadają. Niski = może ignorują twoje nitpicki.
- _EM_: Jeśli reviewer ma niski author engagement → albo komentarze nie są actionable, albo autorzy nie traktują review poważnie. W obu przypadkach — rozmowa.

#### First reply time (średni czas do pierwszej odpowiedzi)

**Pytanie:** Jak szybko ludzie reagują na moje komentarze?

**Jak wykorzystać:** Szybki first reply = twoje komentarze są traktowane priorytetowo. Długi = albo niski priorytet, albo trudne pytania wymagające przemyślenia (niekoniecznie złe).

#### Threads per reviewed PR (średnia)

**Pytanie:** Ile wątków średnio zostawiam na PR?

**Jak wykorzystać:**

- _IC_: 2-3 wątki/PR = thorough review. 0.1 = LGTM machine. 10+ = może too granular.
- _EM_: Dobry benchmark do porównania stylu review w teamie (nie ranking, ale zrozumienie).

---

### E. AI Classification — "Co właściwie robię w review?"

#### Intent breakdown (10 kategorii × 3 tiery)

**Pytanie:** Jaka jest natura mojego feedbacku? Czy mentoruje, łapię bugi, czy głównie nitpickuję?

**Jak czytać tiery:**

- **High-signal** (architecture, bug-catch, mentoring, unblocking) = praca, która chroni produkt i rozwija zespół. To jest "niewidoczna praca", którą GitGud ujawnia.
- **Routine** (nitpick, question, praise) = normalna aktywność review, wartościowa ale nie wyróżniająca.
- **Low-signal** (joke, self-review, unknown) = szum, odfiltrowywany.

**Jak wykorzystać:**

- _IC (Marek)_: "38% moich wątków to high-signal: 15 architecture, 8 mentoring, 6 bug-catch. Nie jestem nitpickerem — moje review chronią architekturę i rozwijają juniorów." To jest dokładnie ten argument, którego Marek nie mógł sformułować przed GitGud.
- _EM (Marta)_: Widzisz, że Senior A ma 50% high-signal (dużo architecture + mentoring) a Senior B ma 80% nitpick. Obie osoby robią "dużo review" — ale A robi _inną_ pracę. Na review powiesz: "Twoje komentarze architekturalne zapobiegły 3 poważnym problemom designowym w Q2".

#### Domain breakdown (5 kategorii)

**Pytanie:** W jakim obszarze technicznym działa mój feedback?

**Jak czytać:**

- **functional** (correctness, bugs, security) = feedback o tym, czy kod robi to, co powinien
- **refactoring** (code quality) = feedback o strukturze, bez zmiany zachowania
- **documentation** = komentarze/README
- **discussion** = pytania, dyskusje designowe
- **false-positive** = wycofane uwagi (reviewer zmienił zdanie po wyjaśnieniu)

**Jak wykorzystać:**

- _IC_: Profil domeny pokazuje, gdzie jest twoja ekspertyza. Dużo functional = strażnik correctness. Dużo refactoring = dbasz o jakość kodu.
- _EM_: Pomaga mapować ekspertyzy w teamie. Jeśli nikt nie feedbackuje w domenie security → knowledge gap.

#### High-signal % (% wątków w tierze high-signal)

**Pytanie:** Jaki udział mojego feedbacku to praca, która naprawdę chroni produkt i rozwija zespół?

**Jak wykorzystać:** To jest JEDYNA metryka, którą warto pokazać na review. "42% moich komentarzy w code review to architektura, mentoring i łapanie bugów" — to zdanie, którego żaden inny tool nie potrafi wygenerować.

---

### F. Activity & Collaboration

#### Weekly activity chart (3 serie: PRs, reviews, threads)

**Pytanie:** Jak wygląda moja aktywność w czasie?

**Jak wykorzystać:**

- _IC_: Widzisz trendy — spadek reviews w tygodniu gdy robiłeś deep work na nowym feature. Wzrost threads gdy onboardowałeś juniora.
- _EM_: Sezonowość, wpływ sprintów, okresy ciszy. Nie jako narzędzie nadzoru, ale jako kontekst.

#### Contribution heatmap (52 tygodnie × 7 dni)

**Pytanie:** Kiedy pracuję?

**Jak wykorzystać:** Wizualny overview aktywności. Puste tygodnie = urlop/L4. Ciemne weekendy = może overwork (rozmowa EM).

#### Top collaborators

**Pytanie:** Z kim najczęściej współpracuję w review?

**Jak wykorzystać:**

- _IC_: "Zrecenzowałem 12 PR-ów Ani — jestem jej primary reviewer". Dowód na mentoring relationship.
- _EM_: Mapowanie nieformalnych zależności w teamie. Kto komu recenzuje? Czy jest balanced?

#### Repo activity

**Pytanie:** W których repozytoriach jestem aktywny?

**Jak wykorzystać:** Pokazuje zakres wpływu. "Jestem aktywny w 4 repozytoriach: głównie backend, ale też review w frontend i infra" — cross-team contribution.

---

### G. Threads Browser (filtrowalna lista wątków)

**Pytanie:** Pokaż mi _konkretne_ wątki, które otworzyłem/otrzymałem.

**Jak wykorzystać:**

- _IC_: Przed review — przefiltruj po intent=architecture i masz listę swoich architekturalnych komentarzy z pełną treścią. Copy-paste do self-evaluation.
- _EM_: Przefiltruj po intent=mentoring i masz listę momentów, gdy senior mentorował juniora. Nie musisz scrollować GitHuba — GitGud zrobił to za ciebie.
- Filtr _role_: "started" = co ja dałem, "received" = co dostałem, "self-review" = moje autokomentarze, "joined" = wątki, w które się włączyłem.

---

### Podsumowanie: User Journey

| Moment użytkownika                | Które metryki otwiera                                                        | Co z tego wynosi                                                                     |
| --------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **IC przygotowuje się do review** | 6 KPI + intent breakdown + threads (filter: started, architecture+mentoring) | Konkretne liczby i przykłady do self-evaluation                                      |
| **EM pisze review dla IC**        | 6 KPI + thread quality + intent breakdown + top collaborators                | Widzi pełny obraz: delivery (PRs) + jakość review (threads) + wpływ (classification) |
| **EM szuka bottlenecku w teamie** | Pickup time histogram + involvement % + time-to-merge p90                    | Identyfikuje kto jest overloaded lub kto blokuje review                              |
| **IC chce udowodnić mentoring**   | Threads (filter: mentoring) + deep discussions + author engagement %         | Lista konkretnych wątków mentoringowych z pełną treścią                              |
| **EM planuje review rotation**    | Involvement % + top collaborators + repo activity                            | Widzi kto komu recenzuje i gdzie jest luka                                           |

## Open Questions

1. Should the homepage feature cards mention specific metric names (e.g., "discussion-sparking ratio") or keep it abstract ("40+ metrics")?
2. Should the high-impact % stat on the homepage be the global aggregate across all boards, or should we show a range?
3. Should the homepage include a visual preview/screenshot of the impact dashboard to show the depth of analysis?
