import { Info } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { ReviewerMetrics } from "@/types";

function fmt(n: number | null, unit?: string): string {
  if (n === null) return "—";
  if (unit === "h") {
    if (n < 1) return `${Math.round(n * 60)}m`;
    if (n < 24) return `${n.toFixed(1)}h`;
    return `${(n / 24).toFixed(1)}d`;
  }
  if (unit === "%") return `${n}%`;
  return n.toLocaleString();
}

const BUCKET_LABELS = ["< 1h", "1–4h", "4–24h", "1–3d", "3d+"];

const STAT_DESCRIPTIONS: Record<string, string> = {
  "Pickup time (p50)": "Median time from PR creation to this person's first review submission.",
  Involvement: "Percentage of board PRs (excluding own) that this person reviewed in the period.",
  "PRs reviewed": "Count of unique PRs this person submitted a review on in the period.",
  Collaborators: "Count of unique PR authors whose work this person reviewed in the period.",
};

function StatLabel({ label }: { label: string }) {
  const description = STAT_DESCRIPTIONS[label];
  return (
    <div className="flex items-center gap-1">
      <p className="text-xs text-blue-100/40">{label}</p>
      {description && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button className="flex-shrink-0 text-blue-100/20 transition-colors hover:text-blue-100/50">
              <Info className="size-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-[200px]">{description}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

interface Props {
  data: ReviewerMetrics | null;
  loading: boolean;
}

export function ReviewerSection({ data, loading }: Props) {
  return (
    <TooltipProvider>
      <section className="rounded-xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
        <h2 className="mb-4 text-sm font-semibold tracking-wide text-blue-100/60 uppercase">As a reviewer</h2>

        {loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-14 bg-white/10" />
            ))}
          </div>
        ) : !data || data.uniquePrsReviewed === 0 ? (
          <p className="text-sm text-blue-100/40 italic">No reviews given in this period</p>
        ) : (
          <div className="space-y-4">
            {/* verdict mix */}
            {data.reviewsByVerdict.total > 0 && (
              <div>
                <p className="mb-1.5 text-xs text-blue-100/40">Review verdict mix</p>
                <div className="flex h-3 overflow-hidden rounded-full">
                  {(
                    [
                      ["approved", "bg-emerald-500"],
                      ["changesRequested", "bg-orange-500"],
                      ["commented", "bg-blue-400"],
                      ["dismissed", "bg-white/20"],
                    ] as const
                  ).map(([key, color]) => {
                    const pct = (data.reviewsByVerdict[key] / data.reviewsByVerdict.total) * 100;
                    return pct > 0 ? (
                      <div
                        key={key}
                        className={color}
                        style={{ width: `${pct}%` }}
                        title={`${key}: ${Math.round(pct)}%`}
                      />
                    ) : null;
                  })}
                </div>
                <div className="mt-1 flex flex-wrap gap-3 text-xs text-blue-100/50">
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                    Approved {data.reviewsByVerdict.approved}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-2 w-2 rounded-full bg-orange-500" />
                    Changes requested {data.reviewsByVerdict.changesRequested}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-2 w-2 rounded-full bg-blue-400" />
                    Commented {data.reviewsByVerdict.commented}
                  </span>
                </div>
              </div>
            )}

            {/* stats grid */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-white/5 bg-white/5 p-3">
                <StatLabel label="Pickup time (p50)" />
                <p className="mt-1 text-lg font-bold text-white">{fmt(data.pickupTime.p50, "h")}</p>
                <p className="text-xs text-blue-100/30">p90: {fmt(data.pickupTime.p90, "h")}</p>
              </div>
              <div className="rounded-lg border border-white/5 bg-white/5 p-3">
                <StatLabel label="Involvement" />
                <p className="mt-1 text-lg font-bold text-white">{fmt(data.involvementPercent, "%")}</p>
                <p className="text-xs text-blue-100/30">of board PRs</p>
              </div>
              <div className="rounded-lg border border-white/5 bg-white/5 p-3">
                <StatLabel label="PRs reviewed" />
                <p className="mt-1 text-lg font-bold text-white">{data.uniquePrsReviewed}</p>
              </div>
              <div className="rounded-lg border border-white/5 bg-white/5 p-3">
                <StatLabel label="Collaborators" />
                <p className="mt-1 text-lg font-bold text-white">{data.uniqueCollaborators}</p>
              </div>
            </div>

            {/* pickup time histogram */}
            {data.pickupTime.p50 !== null && (
              <div>
                <p className="mb-1.5 text-xs text-blue-100/40">Pickup time distribution</p>
                <div className="flex h-10 items-end gap-1">
                  {[
                    data.pickupTime.histogram.under1h,
                    data.pickupTime.histogram.h1to4,
                    data.pickupTime.histogram.h4to24,
                    data.pickupTime.histogram.d1to3,
                    data.pickupTime.histogram.over3d,
                  ].map((count, i) => {
                    const total = data.uniquePrsReviewed || 1;
                    const pct = (count / total) * 100;
                    return (
                      <div key={i} className="flex flex-1 flex-col items-center gap-0.5">
                        <div
                          className="w-full rounded-t bg-blue-400/60"
                          style={{ height: `${Math.max(pct * 0.4, count > 0 ? 2 : 0)}px` }}
                          title={`${BUCKET_LABELS[i]}: ${count}`}
                        />
                        <span className="text-[9px] text-blue-100/30">{BUCKET_LABELS[i]}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </TooltipProvider>
  );
}
