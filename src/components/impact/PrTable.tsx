import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { PrRow } from "@/types";
import { cn } from "@/lib/utils";

const MAX_SHOW = 10;

const STATE_STYLE: Record<string, string> = {
  merged: "bg-purple-100 text-purple-700",
  open: "bg-green-100 text-green-800",
  closed: "bg-red-100 text-red-700",
  draft: "bg-slate-100 text-slate-500",
};

function fmtHours(n: number | null): string {
  if (n === null) return "—";
  if (n < 24) return `${n.toFixed(1)}h`;
  return `${(n / 24).toFixed(1)}d`;
}

function PrRowItem({ pr, threadsBaseUrl }: { pr: PrRow; threadsBaseUrl: string }) {
  const stateStyle = STATE_STYLE[pr.state] ?? "bg-muted text-muted-foreground";
  return (
    <tr className="border-border/50 hover:bg-muted border-t">
      <td className="py-2 pr-3">
        <a
          href={pr.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-foreground hover:text-primary block text-sm font-medium"
        >
          #{pr.number} {pr.title}
        </a>
        <span className="text-muted-foreground font-mono text-xs">{pr.repo}</span>
      </td>
      <td className="py-2 pr-3">
        <span className={cn("rounded px-1.5 py-0.5 text-xs font-semibold", stateStyle)}>{pr.state}</span>
      </td>
      <td className="py-2 pr-3 text-xs">
        <span className="text-emerald-600">{pr.additions !== null ? `+${pr.additions}` : ""}</span>
        {pr.additions !== null && pr.deletions !== null && " "}
        <span className="text-red-500">{pr.deletions !== null ? `-${pr.deletions}` : ""}</span>
        {pr.additions === null && pr.deletions === null && <span className="text-muted-foreground">—</span>}
      </td>
      <td className="text-muted-foreground py-2 pr-3 text-xs">
        {pr.threadCount > 0 ? (
          <a href={`${threadsBaseUrl}?prId=${pr.id}`} className="hover:text-primary underline decoration-dotted">
            {pr.threadCount}
          </a>
        ) : (
          pr.threadCount
        )}
      </td>
      <td className="text-muted-foreground py-2 pr-3 text-xs">{fmtHours(pr.timeToMergeHours)}</td>
      <td className="text-muted-foreground py-2 text-xs">{new Date(pr.updatedAt).toLocaleDateString("en-GB")}</td>
    </tr>
  );
}

interface Props {
  authoredPrs: PrRow[] | null;
  reviewedPrs: PrRow[] | null;
  loading: boolean;
  threadsBaseUrl: string;
}

export function PrTable({ authoredPrs, reviewedPrs, loading, threadsBaseUrl }: Props) {
  const [tab, setTab] = useState<"authored" | "reviewed">("authored");

  const allRows = tab === "authored" ? authoredPrs : reviewedPrs;
  const rows = allRows?.slice(0, MAX_SHOW) ?? null;

  return (
    <section className="border-border bg-card rounded-xl border p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">10 Recent pull requests</h2>
        <div className="border-border flex overflow-hidden rounded-lg border text-xs">
          {(["authored", "reviewed"] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                setTab(t);
              }}
              className={cn(
                "px-3 py-1.5 capitalize transition-colors",
                tab === t ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: MAX_SHOW }).map((_, i) => (
            <Skeleton key={i} className="bg-muted h-10" />
          ))}
        </div>
      ) : !rows || rows.length === 0 ? (
        <p className="text-muted-foreground text-sm italic">No {tab} PRs in this period</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px]">
            <thead>
              <tr className="text-left">
                <th className="text-muted-foreground pb-2 text-xs font-medium">PR</th>
                <th className="text-muted-foreground pr-3 pb-2 text-xs font-medium">State</th>
                <th className="text-muted-foreground pr-3 pb-2 text-xs font-medium">Lines</th>
                <th className="text-muted-foreground pr-3 pb-2 text-xs font-medium">Threads</th>
                <th className="text-muted-foreground pr-3 pb-2 text-xs font-medium">Merge time</th>
                <th className="text-muted-foreground pb-2 text-xs font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((pr) => (
                <PrRowItem key={pr.id} pr={pr} threadsBaseUrl={threadsBaseUrl} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
