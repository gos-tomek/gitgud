import { Info } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { ImpactSummary, KpiMetric } from "@/types";
import { cn } from "@/lib/utils";

const DESCRIPTIONS: Record<string, string> = {
  "PRs authored": "PRs this person opened in the selected period — counted in any state (merged, open, closed, draft).",
  "Reviews given": "GitHub review submissions (approved, changes requested, or commented) in the selected period.",
  "Threads started": "Review comment threads this person started on others' PRs — a proxy for engagement depth.",
  "Time to merge": "Median time from PR creation to merge, for PRs merged in the period.",
  "Pickup time": "Median time from PR creation to this person's first review, for PRs they reviewed.",
  "Discussion ratio": "% of threads this person started that generated at least one reply.",
};

function formatValue(value: number | null, unit?: string): string {
  if (value === null) return "—";
  if (unit === "h") {
    if (value < 1) return `${Math.round(value * 60)}m`;
    if (value < 24) return `${value.toFixed(1)}h`;
    return `${(value / 24).toFixed(1)}d`;
  }
  if (unit === "%") return `${value}%`;
  return String(value);
}

function Delta({ delta }: { delta: number | null }) {
  if (delta === null) return <span className="text-xs text-blue-100/30">—</span>;
  const positive = delta > 0;
  const zero = delta === 0;
  return (
    <span
      className={cn(
        "text-xs font-medium",
        zero && "text-blue-100/40",
        positive && "text-emerald-400",
        !positive && !zero && "text-red-400",
      )}
    >
      {positive ? "+" : ""}
      {delta}%
    </span>
  );
}

function KpiCard({ label, metric, unit }: { label: string; metric: KpiMetric | undefined; unit?: string }) {
  const description = DESCRIPTIONS[label];
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
      <div className="flex items-center gap-1">
        <p className="text-xs font-medium tracking-wide text-blue-100/50 uppercase">{label}</p>
        {description && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="flex-shrink-0 text-blue-100/30 transition-colors hover:text-blue-100/60">
                <Info className="size-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-[220px]">{description}</TooltipContent>
          </Tooltip>
        )}
      </div>
      {metric === undefined ? (
        <>
          <Skeleton className="mt-2 h-7 w-16 bg-white/10" />
          <Skeleton className="mt-1 h-4 w-10 bg-white/10" />
        </>
      ) : (
        <>
          <p className="mt-1 text-2xl font-bold text-white">{formatValue(metric.value, unit)}</p>
          <div className="mt-1">
            <Delta delta={metric.delta} />
          </div>
        </>
      )}
    </div>
  );
}

interface Props {
  summary: ImpactSummary | null;
  loading: boolean;
}

export function KpiCards({ summary, loading }: Props) {
  const s = loading ? undefined : (summary ?? undefined);
  return (
    <TooltipProvider>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="PRs authored" metric={s?.prsAuthored} />
        <KpiCard label="Reviews given" metric={s?.reviewsGiven} />
        <KpiCard label="Threads started" metric={s?.threadsStarted} />
        <KpiCard label="Time to merge" metric={s?.medianTimeToMerge} unit="h" />
        <KpiCard label="Pickup time" metric={s?.medianPickupTime} unit="h" />
        <KpiCard label="Discussion ratio" metric={s?.discussionRatio} unit="%" />
      </div>
    </TooltipProvider>
  );
}
