import { Skeleton } from "@/components/ui/skeleton";
import type { RepoActivity } from "@/types";

interface Props {
  data: RepoActivity[] | null;
  loading: boolean;
}

export function RepoActivitySection({ data, loading }: Props) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
      <h2 className="mb-4 text-sm font-semibold tracking-wide text-blue-100/60 uppercase">Repository activity</h2>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 bg-white/10" />
          ))}
        </div>
      ) : !data || data.length === 0 ? (
        <p className="text-sm text-blue-100/40 italic">No repository activity in this period</p>
      ) : (
        <ul className="space-y-2">
          {data.map((repo, i) => (
            <li
              key={repo.repoName}
              className="flex items-center gap-3 rounded-lg border border-white/5 bg-white/5 px-3 py-2"
            >
              {i === 0 && (
                <span className="shrink-0 rounded bg-blue-500/20 px-1.5 py-0.5 text-xs font-medium text-blue-300">
                  primary
                </span>
              )}
              <span className="flex-1 font-mono text-sm text-blue-100/80">{repo.repoName}</span>
              <div className="flex gap-3 text-xs text-blue-100/50">
                <span>
                  {repo.prCount} PR{repo.prCount !== 1 ? "s" : ""}
                </span>
                <span>
                  {repo.reviewCount} review{repo.reviewCount !== 1 ? "s" : ""}
                </span>
                <span>
                  {repo.threadCount} thread{repo.threadCount !== 1 ? "s" : ""}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
