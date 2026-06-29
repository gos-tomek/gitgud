import { Skeleton } from "@/components/ui/skeleton";
import type { RepoActivity } from "@/types";

interface Props {
  data: RepoActivity[] | null;
  loading: boolean;
}

export function RepoActivitySection({ data, loading }: Props) {
  return (
    <section className="border-border bg-card rounded-xl border p-5">
      <h2 className="text-muted-foreground mb-4 text-sm font-semibold tracking-wide uppercase">Repository activity</h2>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="bg-muted h-12" />
          ))}
        </div>
      ) : !data || data.length === 0 ? (
        <p className="text-muted-foreground text-sm italic">No repository activity in this period</p>
      ) : (
        <ul className="space-y-2">
          {data.map((repo, i) => (
            <li
              key={repo.repoName}
              className="border-border/50 bg-muted/50 flex items-center gap-3 rounded-lg border px-3 py-2"
            >
              {i === 0 && (
                <span className="shrink-0 rounded bg-blue-500/20 px-1.5 py-0.5 text-xs font-medium text-blue-600">
                  primary
                </span>
              )}
              <span className="text-foreground flex-1 font-mono text-sm">{repo.repoName}</span>
              <div className="text-muted-foreground flex gap-3 text-xs">
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
