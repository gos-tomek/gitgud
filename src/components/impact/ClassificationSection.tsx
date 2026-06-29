import { Info, ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { ClassificationAggregates, IntentCategory, TechnicalDomain, IntentTier } from "@/types";
import {
  INTENT_CATEGORIES,
  DOMAIN_CATEGORIES,
  INTENT_COLORS,
  DOMAIN_COLORS,
  INTENT_TIERS,
  INTENT_LABELS,
  DOMAIN_LABELS,
  CATEGORY_TOOLTIPS,
} from "@/lib/classification-colors";

const DOMAIN_ORDER = DOMAIN_CATEGORIES;

const HIGH_SIGNAL_CATEGORIES = INTENT_CATEGORIES.filter((c) => INTENT_TIERS[c] === "high-signal");
const ROUTINE_CATEGORIES = INTENT_CATEGORIES.filter((c) => INTENT_TIERS[c] === "routine");
const LOW_SIGNAL_CATEGORIES = INTENT_CATEGORIES.filter((c) => INTENT_TIERS[c] === "low-signal");

const TIER_ORDER: { tier: IntentTier; label: string; categories: IntentCategory[] }[] = [
  { tier: "high-signal", label: "High-signal", categories: HIGH_SIGNAL_CATEGORIES },
  { tier: "routine", label: "Routine", categories: ROUTINE_CATEGORIES },
  { tier: "low-signal", label: "Low", categories: LOW_SIGNAL_CATEGORIES },
];

// Low-signal categories collapse into a single grouped legend row; the rest keep their own label.
const CATEGORY_LABELS: Record<IntentCategory, string> = {
  ...INTENT_LABELS,
  joke: "Joke / self-review / other",
  "self-review": "Joke / self-review / other",
  unknown: "Joke / self-review / other",
};

const HIGH_SIGNAL_TOOLTIP = `Share of classified threads tagged ${HIGH_SIGNAL_CATEGORIES.map((c) => CATEGORY_LABELS[c]).join(", ")} — the categories considered high-signal feedback.`;

const DONUT_RADIUS = 42;
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS;

function TooltipLabel({ tooltip, children }: { tooltip: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="decoration-primary/50 cursor-default underline decoration-dotted underline-offset-2">
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
    ...[...HIGH_SIGNAL_CATEGORIES, ...ROUTINE_CATEGORIES]
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
      <section className="border-primary/30 bg-primary/5 rounded-xl border p-5">
        {/* header */}
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="bg-primary h-2 w-2 rounded-full" />
              <h2 className="text-primary text-sm font-semibold tracking-wide uppercase">What kind of feedback</h2>
              <span className="bg-primary/20 text-primary rounded px-1.5 py-0.5 text-xs font-medium">
                AI classified
              </span>
            </div>
            <p className="text-muted-foreground mt-0.5 text-xs">
              Every review thread is labelled by intent (why the comment was made) and domain (what part of the work it
              touched). Intent is ordered by signal value.
            </p>
          </div>
          <a
            href={threadsUrl}
            className="border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 flex shrink-0 items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
          >
            Inspect threads
            <ChevronRight className="size-3.5" />
          </a>
        </div>

        {loading ? (
          <div className="grid gap-4 sm:grid-cols-[1.7fr_1fr]">
            <Skeleton className="bg-primary/10 h-40" />
            <Skeleton className="bg-primary/10 h-40" />
          </div>
        ) : !data || totalClassified === 0 ? (
          <p className="text-muted-foreground text-sm italic">No classified threads in this period</p>
        ) : (
          <>
            <div className="grid gap-6 sm:grid-cols-[1.7fr_1fr]">
              {/* intent panel */}
              <div>
                <div className="mb-2 flex items-baseline justify-between">
                  <p className="text-muted-foreground text-xs">Intent</p>
                  <div className="flex items-center gap-1">
                    <span className="text-foreground text-xl font-bold">{data.highSignalPercent}%</span>
                    <span className="text-muted-foreground text-xs">high-signal</span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button className="text-muted-foreground hover:text-foreground flex-shrink-0 transition-colors">
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
                <div className="text-muted-foreground mt-1.5 flex flex-wrap gap-3 font-mono text-[10px]">
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
                      <span className={item.dim ? "text-muted-foreground/50" : "text-muted-foreground"}>
                        <TooltipLabel tooltip={item.tooltip}>{item.label}</TooltipLabel>
                      </span>
                      <span
                        className={`ml-auto font-mono ${item.dim ? "text-muted-foreground/50" : "text-muted-foreground"}`}
                      >
                        {item.count}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* domain panel */}
              <div className="border-border border-l pl-6">
                <p className="text-muted-foreground mb-2 text-xs">Domain</p>
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
                          style={{
                            transformOrigin: "52px 52px",
                            fontSize: 7,
                            fontWeight: 600,
                            fill: "var(--color-primary)",
                          }}
                        >
                          {DOMAIN_LABELS[topDomain.category]}
                        </text>
                        <text
                          x={52}
                          y={59}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          className="rotate-90"
                          style={{
                            transformOrigin: "52px 52px",
                            fontSize: 14,
                            fontWeight: 700,
                            fill: "var(--color-foreground)",
                          }}
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
                        <span
                          className={
                            category === "false-positive" ? "text-muted-foreground/50" : "text-muted-foreground"
                          }
                        >
                          <TooltipLabel tooltip={CATEGORY_TOOLTIPS[category]}>{DOMAIN_LABELS[category]}</TooltipLabel>
                        </span>
                        <span className="text-muted-foreground ml-auto font-mono">
                          {domainCountMap.get(category) ?? 0}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* coverage footer */}
            <div className="border-border mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-xs">
                  {totalClassified} of {totalThreads} threads classified ({coveragePercent}%)
                </span>
                <div className="bg-muted h-[5px] w-[220px] max-w-[220px] overflow-hidden rounded-full">
                  <div className="bg-primary h-full rounded-full" style={{ width: `${coveragePercent}%` }} />
                </div>
                {pending > 0 && <span className="text-muted-foreground font-mono text-xs">{pending} pending</span>}
              </div>
              <span className="text-muted-foreground font-mono text-[11px]">
                llama-3.3-70b · daily batch · majority vote ×3
              </span>
            </div>
          </>
        )}
      </section>
    </TooltipProvider>
  );
}
