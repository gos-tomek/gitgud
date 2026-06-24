import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { PrRow } from "@/types";
import { cn } from "@/lib/utils";

const MAX_SHOW = 10;

const STATE_STYLE: Record<string, string> = {
  merged: "bg-purple-500/30 text-purple-200",
  open: "bg-emerald-500/30 text-emerald-200",
  closed: "bg-red-500/30 text-red-200",
};

function fmtHours(n: number | null): string {
  if (n === null) return "—";
  if (n < 24) return `${n.toFixed(1)}h`;
  return `${(n / 24).toFixed(1)}d`;
}

function PrRowItem({ pr, threadsBaseUrl }: { pr: PrRow; threadsBaseUrl: string }) {
  const stateStyle = STATE_STYLE[pr.state] ?? "bg-white/10 text-blue-100/60";
  return (
    <tr className="border-t border-white/5 hover:bg-white/5">
      <td className="py-2 pr-3">
        <a
          href={pr.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-sm font-medium text-blue-100/80 hover:text-white"
        >
          #{pr.number} {pr.title}
        </a>
        <span className="font-mono text-xs text-blue-100/40">{pr.repo}</span>
      </td>
      <td className="py-2 pr-3">
        <span className={cn("rounded px-1.5 py-0.5 text-xs font-semibold", stateStyle)}>{pr.state}</span>
      </td>
      <td className="py-2 pr-3 text-xs">
        <span className="text-emerald-400">{pr.additions !== null ? `+${pr.additions}` : ""}</span>
        {pr.additions !== null && pr.deletions !== null && " "}
        <span className="text-red-400">{pr.deletions !== null ? `-${pr.deletions}` : ""}</span>
        {pr.additions === null && pr.deletions === null && <span className="text-blue-100/30">—</span>}
      </td>
      <td className="py-2 pr-3 text-xs text-blue-100/50">
        {pr.threadCount > 0 ? (
          <a href={`${threadsBaseUrl}?prId=${pr.id}`} className="underline decoration-dotted hover:text-white">
            {pr.threadCount}
          </a>
        ) : (
          pr.threadCount
        )}
      </td>
      <td className="py-2 pr-3 text-xs text-blue-100/50">{fmtHours(pr.timeToMergeHours)}</td>
      <td className="py-2 text-xs text-blue-100/30">{new Date(pr.updatedAt).toLocaleDateString("en-GB")}</td>
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
    <section className="rounded-xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-wide text-blue-100/60 uppercase">10 Recent pull requests</h2>
        <div className="flex overflow-hidden rounded-lg border border-white/10 text-xs">
          {(["authored", "reviewed"] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                setTab(t);
              }}
              className={cn(
                "px-3 py-1.5 capitalize transition-colors",
                tab === t ? "bg-white/10 text-white" : "text-blue-100/50 hover:text-white",
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
            <Skeleton key={i} className="h-10 bg-white/10" />
          ))}
        </div>
      ) : !rows || rows.length === 0 ? (
        <p className="text-sm text-blue-100/40 italic">No {tab} PRs in this period</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px]">
            <thead>
              <tr className="text-left">
                <th className="pb-2 text-xs font-medium text-blue-100/40">PR</th>
                <th className="pr-3 pb-2 text-xs font-medium text-blue-100/40">State</th>
                <th className="pr-3 pb-2 text-xs font-medium text-blue-100/40">Lines</th>
                <th className="pr-3 pb-2 text-xs font-medium text-blue-100/40">Threads</th>
                <th className="pr-3 pb-2 text-xs font-medium text-blue-100/40">Merge time</th>
                <th className="pb-2 text-xs font-medium text-blue-100/40">Updated</th>
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
