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
    <div className="border-primary/20 bg-primary/5 rounded-lg border p-3">
      <div className="flex items-center gap-1">
        <p className="text-muted-foreground text-xs">{label}</p>
        {description && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="text-muted-foreground hover:text-foreground flex-shrink-0 transition-colors">
                <Info className="size-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-[220px]">{description}</TooltipContent>
          </Tooltip>
        )}
      </div>
      <p className="text-foreground mt-1 text-xl font-bold">{value}</p>
      {sub && <p className="text-muted-foreground text-xs">{sub}</p>}
      {categoryBreakdown && categoryBreakdown.length > 0 && (
        <div className="mt-1.5 space-y-0.5">
          {categoryBreakdown.map(({ label: l, count }) => (
            <div key={l} className="text-muted-foreground flex justify-between text-xs">
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
      <section className="border-primary/30 bg-primary/5 rounded-xl border p-5">
        <div className="mb-4 flex items-center gap-2">
          <span className="bg-primary h-2 w-2 rounded-full" />
          <h2 className="text-primary text-sm font-semibold tracking-wide uppercase">Review thread quality</h2>
          <span className="bg-primary/20 text-primary rounded px-1.5 py-0.5 text-xs font-medium">GitGud signal</span>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="bg-primary/10 h-16" />
            ))}
          </div>
        ) : !data || data.threadsStarted === 0 ? (
          <p className="text-muted-foreground text-sm italic">No review threads started in this period</p>
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
