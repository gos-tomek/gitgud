import { Info } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { ReviewerMetrics } from "@/types";

function fmt(n: number | null, decimals = 0): string {
  if (n === null) return "—";
  return decimals > 0 ? n.toFixed(decimals) : Math.round(n).toLocaleString();
}

function fmtHours(n: number | null): string {
  if (n === null) return "—";
  if (n < 1) return `${Math.round(n * 60)}m`;
  if (n < 24) return `${n.toFixed(1)}h`;
  return `${(n / 24).toFixed(1)}d`;
}

interface MetricCardProps {
  label: string;
  value: string;
  sub?: string;
  description?: string;
  categoryBreakdown?: { label: string; count: number }[];
}

function MetricCard({ label, value, sub, description, categoryBreakdown }: MetricCardProps) {
  return (
    <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-3">
      <div className="flex items-center gap-1">
        <p className="text-xs text-purple-200/50">{label}</p>
        {description && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="flex-shrink-0 text-purple-300/30 transition-colors hover:text-purple-300/60">
                <Info className="size-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-[220px]">{description}</TooltipContent>
          </Tooltip>
        )}
      </div>
      <p className="mt-1 text-xl font-bold text-purple-100">{value}</p>
      {sub && <p className="text-xs text-purple-200/40">{sub}</p>}
      {categoryBreakdown && categoryBreakdown.length > 0 && (
        <div className="mt-1.5 space-y-0.5">
          {categoryBreakdown.map(({ label: l, count }) => (
            <div key={l} className="flex justify-between text-xs text-purple-200/40">
              <span>{l}</span>
              <span>{count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface Props {
  data: ReviewerMetrics | null;
  loading: boolean;
}

export function ThreadQualitySection({ data, loading }: Props) {
  return (
    <TooltipProvider>
      <section className="rounded-xl border border-purple-500/30 bg-purple-500/5 p-5 backdrop-blur-sm">
        <div className="mb-4 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-purple-400" />
          <h2 className="text-sm font-semibold tracking-wide text-purple-200/80 uppercase">Review thread quality</h2>
          <span className="rounded bg-purple-500/20 px-1.5 py-0.5 text-xs font-medium text-purple-300">
            GitGud signal
          </span>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-16 bg-purple-500/10" />
            ))}
          </div>
        ) : !data || data.threadsStarted === 0 ? (
          <p className="text-sm text-purple-200/30 italic">No review threads started in this period</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricCard
              label="Avg thread depth"
              value={fmt(data.avgThreadDepth, 1)}
              sub="messages per thread"
              description="Average number of messages per review thread started in the period."
            />
            <MetricCard
              label="Discussion-sparking ratio"
              value={data.discussionSparkingRatio !== null ? `${data.discussionSparkingRatio}%` : "—"}
              sub={`${data.threadsStarted} thread${data.threadsStarted !== 1 ? "s" : ""} started`}
              description="Percentage of PRs reviewed where this person started at least one thread."
            />
            <MetricCard
              label="Deep discussions"
              value={fmt(data.deepDiscussionsCount)}
              sub="3+ messages"
              description="Threads with 3 or more messages — indicates substantive technical exchange."
            />
            <MetricCard
              label="Multi-person threads"
              value={fmt(data.multiPersonThreadsCount)}
              sub="≥ 2 participants"
              description="Threads involving 2 or more different participants."
            />
            <MetricCard
              label="Inline thread ratio"
              value={data.inlineThreadRatio !== null ? `${data.inlineThreadRatio}%` : "—"}
              sub="on file lines"
              description="Percentage of threads anchored to a specific file line vs. general PR comments."
            />
            <MetricCard
              label="Author engagement"
              value={data.authorEngagementPercent !== null ? `${data.authorEngagementPercent}%` : "—"}
              sub="PR author responded"
              description="Percentage of threads where the PR author replied — measures if feedback lands."
            />
            <MetricCard
              label="First reply time"
              value={fmtHours(data.avgFirstReplyTimeHours)}
              sub="median"
              description="Average time from thread creation to the first reply by any participant."
            />
            <MetricCard
              label="Threads per reviewed PR"
              value={fmt(data.threadsPerReviewedPr, 2)}
              sub="average"
              description="Average number of threads started per PR reviewed in the period."
            />
          </div>
        )}
      </section>
    </TooltipProvider>
  );
}
