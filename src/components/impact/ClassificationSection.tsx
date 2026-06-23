import { Info, ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { ClassificationAggregates, IntentCategory, TechnicalDomain, IntentTier } from "@/types";

const INTENT_COLORS: Record<IntentCategory, string> = {
  architecture: "#3b82f6",
  "bug-catch": "#ef4444",
  mentoring: "#10b981",
  unblocking: "#06b6d4",
  nitpick: "#f59e0b",
  question: "#8b5cf6",
  praise: "#eab308",
  joke: "#ec4899",
  "self-review": "#a1a1aa",
  unknown: "#d4d4d8",
};

const DOMAIN_COLORS: Record<TechnicalDomain, string> = {
  functional: "#7c3aed",
  refactoring: "#0ea5e9",
  documentation: "#10b981",
  discussion: "#f59e0b",
  "false-positive": "#d4d4d8",
};

const DOMAIN_ORDER: TechnicalDomain[] = ["functional", "refactoring", "documentation", "discussion", "false-positive"];

const HIGH_SIGNAL_CATEGORIES: IntentCategory[] = ["architecture", "bug-catch", "mentoring", "unblocking"];

const TIER_ORDER: { tier: IntentTier; label: string; categories: IntentCategory[] }[] = [
  { tier: "high-signal", label: "High-signal", categories: HIGH_SIGNAL_CATEGORIES },
  { tier: "routine", label: "Routine", categories: ["nitpick", "question", "praise"] },
  { tier: "low-signal", label: "Low", categories: ["joke", "self-review", "unknown"] },
];

const CATEGORY_LABELS: Record<IntentCategory, string> = {
  architecture: "Architecture",
  "bug-catch": "Bug-catch",
  mentoring: "Mentoring",
  unblocking: "Unblocking",
  nitpick: "Nitpick",
  question: "Question",
  praise: "Praise",
  joke: "Joke / self-review / other",
  "self-review": "Joke / self-review / other",
  unknown: "Joke / self-review / other",
};

const DOMAIN_LABELS: Record<TechnicalDomain, string> = {
  functional: "Functional",
  refactoring: "Refactoring",
  documentation: "Documentation",
  discussion: "Discussion",
  "false-positive": "False-positive",
};

// Sourced from context/changes/profile-classified-comments/research.md §5 (prototype tooltip table).
const CATEGORY_TOOLTIPS: Record<string, string> = {
  architecture:
    "A structural, component, API, or data-flow change — or a firm objection to recreating something that already exists.",
  "bug-catch":
    "Asserts a concrete defect or broken behaviour — a claim that something IS currently wrong, not just a suggestion.",
  mentoring: "Explains a concept, convention, or rationale aimed at the author's growth.",
  unblocking: "A concrete next step in prose, for an issue this comment doesn't itself flag as broken.",
  nitpick: "Trivial style, naming, or formatting point — tests would pass either way.",
  question: "Asks for clarification or rationale — must be phrased as an actual question.",
  praise: "Approval or thanks from the reviewer, with no code change requested.",
  "joke-group":
    "Off-topic banter, the PR author commenting on their own thread, CI/bot noise, or anything the model couldn't classify.",
  functional: "Correctness, bugs, or security — whether the code behaves right.",
  refactoring: "Changes structure without changing behaviour — cleanups, renames, reorganisation.",
  documentation: "Docstrings, READMEs, and code comments — explanatory text rather than logic.",
  discussion: "Questions, design conversation, or praise — not tied to correctness or structure.",
  "false-positive": "A concern that was raised and then conclusively withdrawn or refuted in the thread.",
};

const HIGH_SIGNAL_TOOLTIP = `Share of classified threads tagged ${HIGH_SIGNAL_CATEGORIES.map((c) => CATEGORY_LABELS[c]).join(", ")} — the categories considered high-signal feedback.`;

const LOW_SIGNAL_CATEGORIES: IntentCategory[] = ["joke", "self-review", "unknown"];

const DONUT_RADIUS = 42;
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS;

function TooltipLabel({ tooltip, children }: { tooltip: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-default underline decoration-purple-400/50 decoration-dotted underline-offset-2">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[220px]">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

interface Props {
  data: ClassificationAggregates | null;
  loading: boolean;
  threadsUrl: string;
}

export function ClassificationSection({ data, loading, threadsUrl }: Props) {
  const intentCountMap = new Map<IntentCategory, number>((data?.intentCounts ?? []).map((c) => [c.category, c.count]));
  const domainCountMap = new Map<TechnicalDomain, number>((data?.domainCounts ?? []).map((c) => [c.category, c.count]));

  const totalClassified = data?.totalClassified ?? 0;
  const totalThreads = data?.totalThreads ?? 0;
  const pending = Math.max(totalThreads - totalClassified, 0);
  const coveragePercent = totalThreads > 0 ? Math.round((totalClassified / totalThreads) * 100) : 0;

  const lowSignalCount = LOW_SIGNAL_CATEGORIES.reduce((sum, c) => sum + (intentCountMap.get(c) ?? 0), 0);

  const intentLegendItems = [
    ...(["architecture", "bug-catch", "mentoring", "unblocking", "nitpick", "question", "praise"] as const)
      .filter((category) => (intentCountMap.get(category) ?? 0) > 0)
      .map((category) => ({
        key: category,
        color: INTENT_COLORS[category],
        label: CATEGORY_LABELS[category],
        tooltip: CATEGORY_TOOLTIPS[category],
        count: intentCountMap.get(category) ?? 0,
        dim: false,
      })),
    ...(lowSignalCount > 0
      ? [
          {
            key: "joke-group",
            color: "#a1a1aa",
            label: "Joke / self-review / other",
            tooltip: CATEGORY_TOOLTIPS["joke-group"],
            count: lowSignalCount,
            dim: true,
          },
        ]
      : []),
  ];

  const topDomain = DOMAIN_ORDER.reduce<{ category: TechnicalDomain; count: number } | null>((top, category) => {
    const count = domainCountMap.get(category) ?? 0;
    if (!top || count > top.count) return { category, count };
    return top;
  }, null);
  const topDomainPercent = topDomain && totalClassified > 0 ? Math.round((topDomain.count / totalClassified) * 100) : 0;

  const domainSegments = DOMAIN_ORDER.reduce<{ category: TechnicalDomain; length: number; offset: number }[]>(
    (segments, category) => {
      const count = domainCountMap.get(category) ?? 0;
      if (count === 0 || totalClassified === 0) return segments;
      const length = (count / totalClassified) * DONUT_CIRCUMFERENCE;
      const offset = segments.reduce((sum, s) => sum + s.length, 0);
      return [...segments, { category, length, offset }];
    },
    [],
  );

  return (
    <TooltipProvider>
      <section className="rounded-xl border border-purple-500/30 bg-purple-500/5 p-5 backdrop-blur-sm">
        {/* header */}
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-purple-400" />
              <h2 className="text-sm font-semibold tracking-wide text-purple-200/80 uppercase">
                What kind of feedback
              </h2>
              <span className="rounded bg-purple-500/20 px-1.5 py-0.5 text-xs font-medium text-purple-300">
                AI classified
              </span>
            </div>
            <p className="mt-0.5 text-xs text-purple-200/40">
              Every review thread is labelled by intent (why the comment was made) and domain (what part of the work it
              touched). Intent is ordered by signal value.
            </p>
          </div>
          <a
            href={threadsUrl}
            className="flex shrink-0 items-center gap-1 rounded-lg border border-purple-400/30 bg-purple-500/10 px-3 py-1.5 text-xs font-medium text-purple-300 transition-colors hover:bg-purple-500/20"
          >
            Inspect threads
            <ChevronRight className="size-3.5" />
          </a>
        </div>

        {loading ? (
          <div className="grid gap-4 sm:grid-cols-[1.7fr_1fr]">
            <Skeleton className="h-40 bg-purple-500/10" />
            <Skeleton className="h-40 bg-purple-500/10" />
          </div>
        ) : !data || totalClassified === 0 ? (
          <p className="text-sm text-purple-200/30 italic">No classified threads in this period</p>
        ) : (
          <>
            <div className="grid gap-6 sm:grid-cols-[1.7fr_1fr]">
              {/* intent panel */}
              <div>
                <div className="mb-2 flex items-baseline justify-between">
                  <p className="text-xs text-blue-100/40">Intent</p>
                  <div className="flex items-center gap-1">
                    <span className="text-xl font-bold text-white">{data.highSignalPercent}%</span>
                    <span className="text-xs text-blue-100/40">high-signal</span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button className="flex-shrink-0 text-purple-300/40 transition-colors hover:text-purple-300/70">
                          <Info className="size-3" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[220px]">{HIGH_SIGNAL_TOOLTIP}</TooltipContent>
                    </Tooltip>
                  </div>
                </div>

                {/* stacked bar */}
                <div className="flex h-[34px] overflow-hidden rounded">
                  {TIER_ORDER.map(({ tier, categories }) => {
                    const tierTotal = categories.reduce((sum, c) => sum + (intentCountMap.get(c) ?? 0), 0);
                    if (tierTotal === 0) return null;
                    return (
                      <div key={tier} className="flex" style={{ flex: tierTotal }}>
                        {categories.map((category) => {
                          const count = intentCountMap.get(category) ?? 0;
                          if (count === 0) return null;
                          return (
                            <div
                              key={category}
                              style={{ flex: count, backgroundColor: INTENT_COLORS[category] }}
                              title={`${CATEGORY_LABELS[category]}: ${count}`}
                            />
                          );
                        })}
                      </div>
                    );
                  })}
                </div>

                {/* tier scale labels */}
                <div className="mt-1.5 flex flex-wrap gap-3 font-mono text-[10px] text-blue-100/40">
                  {TIER_ORDER.map(({ tier, label, categories }) => {
                    const tierTotal = categories.reduce((sum, c) => sum + (intentCountMap.get(c) ?? 0), 0);
                    if (tierTotal === 0) return null;
                    return (
                      <span key={tier}>
                        {tierTotal} {label}
                      </span>
                    );
                  })}
                </div>

                {/* legend grid — column-major flow so reading top-to-bottom then next column
                    matches the bar's left-to-right segment order */}
                <div
                  className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1"
                  style={{
                    gridAutoFlow: "column",
                    gridTemplateRows: `repeat(${Math.ceil(intentLegendItems.length / 2)}, auto)`,
                  }}
                >
                  {intentLegendItems.map((item) => (
                    <div key={item.key} className="flex items-center gap-1.5 text-xs">
                      <span className="size-[9px] shrink-0 rounded-sm" style={{ backgroundColor: item.color }} />
                      <span className={item.dim ? "text-blue-100/30" : "text-blue-100/60"}>
                        <TooltipLabel tooltip={item.tooltip}>{item.label}</TooltipLabel>
                      </span>
                      <span className={`ml-auto font-mono ${item.dim ? "text-blue-100/30" : "text-blue-100/40"}`}>
                        {item.count}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* domain panel */}
              <div className="border-l border-white/10 pl-6">
                <p className="mb-2 text-xs text-blue-100/40">Domain</p>
                <div className="flex items-center gap-4">
                  <svg width={104} height={104} viewBox="0 0 104 104" className="-rotate-90">
                    {domainSegments.map(({ category, length, offset }) => (
                      <circle
                        key={category}
                        cx={52}
                        cy={52}
                        r={DONUT_RADIUS}
                        fill="none"
                        stroke={DOMAIN_COLORS[category]}
                        strokeWidth={13}
                        strokeDasharray={`${length} ${DONUT_CIRCUMFERENCE - length}`}
                        strokeDashoffset={-offset}
                      />
                    ))}
                    {topDomain && (
                      <>
                        <text
                          x={52}
                          y={45}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          className="rotate-90"
                          style={{ transformOrigin: "52px 52px", fontSize: 7, fontWeight: 600, fill: "#c4b5fd" }}
                        >
                          {DOMAIN_LABELS[topDomain.category]}
                        </text>
                        <text
                          x={52}
                          y={59}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          className="rotate-90"
                          style={{ transformOrigin: "52px 52px", fontSize: 14, fontWeight: 700, fill: "#ede9fe" }}
                        >
                          {topDomainPercent}%
                        </text>
                      </>
                    )}
                  </svg>
                  <div className="min-w-0 flex-1 space-y-1">
                    {DOMAIN_ORDER.filter((category) => (domainCountMap.get(category) ?? 0) > 0).map((category) => (
                      <div key={category} className="flex items-center gap-1.5 text-xs">
                        <span
                          className="size-[9px] shrink-0 rounded-full"
                          style={{ backgroundColor: DOMAIN_COLORS[category] }}
                        />
                        <span className={category === "false-positive" ? "text-blue-100/30" : "text-blue-100/60"}>
                          <TooltipLabel tooltip={CATEGORY_TOOLTIPS[category]}>{DOMAIN_LABELS[category]}</TooltipLabel>
                        </span>
                        <span className="ml-auto font-mono text-blue-100/40">{domainCountMap.get(category) ?? 0}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* coverage footer */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-blue-100/40">
                  {totalClassified} of {totalThreads} threads classified ({coveragePercent}%)
                </span>
                <div className="h-[5px] w-[220px] max-w-[220px] overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-purple-500" style={{ width: `${coveragePercent}%` }} />
                </div>
                {pending > 0 && <span className="font-mono text-xs text-blue-100/30">{pending} pending</span>}
              </div>
              <span className="font-mono text-[11px] text-blue-100/30">
                llama-3.3-70b · daily batch · majority vote ×3
              </span>
            </div>
          </>
        )}
      </section>
    </TooltipProvider>
  );
}
