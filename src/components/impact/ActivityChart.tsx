import { Skeleton } from "@/components/ui/skeleton";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart";
import { AreaChart, Area, CartesianGrid, XAxis } from "recharts";
import type { WeeklyActivity } from "@/types";

const chartConfig = {
  prs: { label: "PRs authored", color: "var(--chart-1)" },
  reviews: { label: "Reviews given", color: "var(--chart-2)" },
  threads: { label: "Threads started", color: "var(--chart-3)" },
};

interface Props {
  data: WeeklyActivity[] | null;
  loading: boolean;
}

export function ActivityChart({ data, loading }: Props) {
  if (loading) {
    return <Skeleton className="h-48 w-full bg-white/10" />;
  }

  if (!data || data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-sm text-blue-100/40">
        No activity in this period
      </div>
    );
  }

  return (
    <ChartContainer config={chartConfig} className="h-48 w-full">
      <AreaChart data={data}>
        <defs>
          <linearGradient id="gPrs" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gReviews" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--chart-2)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="var(--chart-2)" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gThreads" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--chart-3)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="var(--chart-3)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
        <XAxis
          dataKey="week"
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 10, fill: "rgba(255,255,255,0.4)" }}
          tickFormatter={(v: string) => v.slice(5)}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Area type="monotone" dataKey="prs" stroke="var(--chart-1)" fill="url(#gPrs)" strokeWidth={1.5} dot={false} />
        <Area
          type="monotone"
          dataKey="reviews"
          stroke="var(--chart-2)"
          fill="url(#gReviews)"
          strokeWidth={1.5}
          dot={false}
        />
        <Area
          type="monotone"
          dataKey="threads"
          stroke="var(--chart-3)"
          fill="url(#gThreads)"
          strokeWidth={1.5}
          dot={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}
