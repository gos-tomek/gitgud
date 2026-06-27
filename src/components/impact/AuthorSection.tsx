import { Info } from "lucide-react";
import { PieChart, Pie } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { ChartConfig } from "@/components/ui/chart";
import type { AuthorMetrics } from "@/types";

const PIE_CONFIG = {
  merged: { label: "Merged", color: "hsl(270 60% 55%)" },
  open: { label: "Open", color: "hsl(142 72% 42%)" },
  closed: { label: "Closed", color: "hsl(0 68% 50%)" },
  draft: { label: "Draft", color: "hsl(215 16% 50%)" },
} satisfies ChartConfig;

const SIZE_LABELS = ["0–10", "10–50", "50–200", "200–500", "500+"];

const STAT_DESCRIPTIONS: Record<string, string> = {
  Additions: "Total lines added across PRs authored in the period.",
  Deletions: "Total lines removed across PRs authored in the period.",
  "Files changed": "Total unique files touched across PRs authored in the period.",
  "Time to merge": "Median time from PR creation to merge (p50), with p90 shown below.",
};

function fmt(n: number | null, unit?: string): string {
  if (n === null) return "—";
  if (unit === "h") {
    if (n < 1) return `${Math.round(n * 60)}m`;
    if (n < 24) return `${n.toFixed(1)}h`;
    return `${(n / 24).toFixed(1)}d`;
  }
  if (unit === "+") return `+${n.toLocaleString()}`;
  if (unit === "-") return `-${n.toLocaleString()}`;
  return n.toLocaleString();
}

function StatLabel({ label }: { label: string }) {
  const description = STAT_DESCRIPTIONS[label];
  return (
    <div className="flex items-center gap-1">
      <p className="text-muted-foreground text-xs">{label}</p>
      {description && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button className="text-muted-foreground/50 hover:text-muted-foreground flex-shrink-0 transition-colors">
              <Info className="size-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-[200px]">{description}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

function SizeBars({ buckets }: { buckets: NonNullable<AuthorMetrics["prSize"]["sizeBuckets"]> }) {
  const values = [buckets.xs, buckets.s, buckets.m, buckets.l, buckets.xl];
  const max = Math.max(...values, 1);
  return (
    <div className="mt-3">
      <p className="text-muted-foreground mb-2 text-xs font-medium">PR size distribution</p>
      <div className="flex h-14 items-end gap-1.5">
        {values.map((v, i) => (
          <div key={i} className="flex flex-1 flex-col items-center gap-0.5">
            <span className="text-muted-foreground text-[10px]">{v > 0 ? v : ""}</span>
            <div
              className="w-full rounded-t bg-blue-400/35 transition-all"
              style={{ height: v > 0 ? `${Math.max((v / max) * 40, 4)}px` : "2px", opacity: v > 0 ? 1 : 0.2 }}
            />
          </div>
        ))}
      </div>
      <div className="mt-0.5 flex gap-1.5">
        {SIZE_LABELS.map((l, i) => (
          <span key={i} className="text-muted-foreground flex-1 truncate text-center text-[9px]">
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}

interface Props {
  data: AuthorMetrics | null;
  loading: boolean;
}

export function AuthorSection({ data, loading }: Props) {
  return (
    <TooltipProvider>
      <section className="border-border bg-card rounded-xl border p-5">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">As a PR author</h2>
          {data && data.prsByState.total > 0 && (
            <span className="text-muted-foreground text-xs">
              {data.prsByState.total} PRs
              {data.prSize.totalAdditions !== null && data.prSize.totalDeletions !== null && (
                <> · {(data.prSize.totalAdditions + data.prSize.totalDeletions).toLocaleString()} ± lines</>
              )}
            </span>
          )}
        </div>

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="bg-muted h-24" />
            <Skeleton className="bg-muted h-16" />
          </div>
        ) : !data || data.prsByState.total === 0 ? (
          <p className="text-muted-foreground text-sm italic">No PRs authored in this period</p>
        ) : (
          <div className="space-y-4">
            {/* donut + legend */}
            <div className="flex items-center gap-4">
              <ChartContainer config={PIE_CONFIG} className="h-[90px] w-[90px] shrink-0">
                <PieChart>
                  <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                  <Pie
                    data={[
                      { name: "merged", value: data.prsByState.merged, fill: PIE_CONFIG.merged.color },
                      { name: "open", value: data.prsByState.open, fill: PIE_CONFIG.open.color },
                      { name: "closed", value: data.prsByState.closed, fill: PIE_CONFIG.closed.color },
                      { name: "draft", value: data.prsByState.draft, fill: PIE_CONFIG.draft.color },
                    ].filter((d) => d.value > 0)}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius="55%"
                    outerRadius="90%"
                    strokeWidth={0}
                  />
                </PieChart>
              </ChartContainer>
              <div className="flex-1 space-y-1">
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                  {(["merged", "open", "closed", "draft"] as const).map((state) => {
                    const count = data.prsByState[state];
                    return (
                      <div key={state} className="flex items-center gap-1.5 text-xs">
                        <div
                          className="h-2 w-2 shrink-0 rounded-sm"
                          style={{ backgroundColor: PIE_CONFIG[state].color }}
                        />
                        <span
                          className={
                            count === 0 ? "text-muted-foreground/50 capitalize" : "text-muted-foreground capitalize"
                          }
                        >
                          {state}
                        </span>
                        <span
                          className={
                            count === 0
                              ? "text-muted-foreground/50 ml-auto font-mono"
                              : "text-foreground ml-auto font-mono font-medium"
                          }
                        >
                          {count}
                        </span>
                      </div>
                    );
                  })}
                </div>
                {data.mergeRate !== null && (
                  <p className="text-muted-foreground mt-2 text-xs">
                    <span className="text-foreground font-medium">{data.mergeRate}%</span> merge rate
                  </p>
                )}
              </div>
            </div>

            {/* size metrics row */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="border-border/50 bg-muted/50 rounded-lg border p-3">
                <StatLabel label="Additions" />
                <p className="mt-1 text-lg font-bold text-emerald-600">{fmt(data.prSize.totalAdditions, "+")}</p>
                <p className="text-muted-foreground text-xs">median {fmt(data.prSize.medianAdditions)}/PR</p>
              </div>
              <div className="border-border/50 bg-muted/50 rounded-lg border p-3">
                <StatLabel label="Deletions" />
                <p className="mt-1 text-lg font-bold text-red-500">{fmt(data.prSize.totalDeletions, "-")}</p>
                <p className="text-muted-foreground text-xs">median {fmt(data.prSize.medianDeletions)}/PR</p>
              </div>
              <div className="border-border/50 bg-muted/50 rounded-lg border p-3">
                <StatLabel label="Files changed" />
                <p className="text-foreground mt-1 text-lg font-bold">{fmt(data.prSize.totalChangedFiles)}</p>
              </div>
              <div className="border-border/50 bg-muted/50 rounded-lg border p-3">
                <StatLabel label="Time to merge" />
                <p className="text-foreground mt-1 text-lg font-bold">{fmt(data.timeToMerge.p50, "h")}</p>
                <p className="text-muted-foreground text-xs">p90: {fmt(data.timeToMerge.p90, "h")}</p>
              </div>
            </div>

            {/* size distribution */}
            {data.prSize.sizeBuckets && (
              <div>
                <SizeBars buckets={data.prSize.sizeBuckets} />
                {data.prSize.medianChangedLines !== null && (
                  <p className="text-muted-foreground mt-1 text-[10px]">
                    median {data.prSize.medianChangedLines.toLocaleString()} lines/PR
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </section>
    </TooltipProvider>
  );
}
