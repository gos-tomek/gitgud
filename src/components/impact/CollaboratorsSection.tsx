import { Skeleton } from "@/components/ui/skeleton";
import type { Collaborator } from "@/types";

interface Props {
  data: Collaborator[] | null;
  loading: boolean;
}

export function CollaboratorsSection({ data, loading }: Props) {
  return (
    <section className="border-border bg-card rounded-xl border p-5">
      <h2 className="text-muted-foreground mb-4 text-sm font-semibold tracking-wide uppercase">Top collaborators</h2>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="bg-muted h-10" />
          ))}
        </div>
      ) : !data || data.length === 0 ? (
        <p className="text-muted-foreground text-sm italic">No collaborators in this period</p>
      ) : (
        <ul className="space-y-2">
          {data.map((c) => (
            <li
              key={c.login}
              className="border-border/50 bg-muted/50 flex items-center gap-3 rounded-lg border px-3 py-2"
            >
              {c.avatarUrl ? (
                <img src={c.avatarUrl} alt={c.login} className="h-7 w-7 rounded-full" />
              ) : (
                <div className="bg-muted h-7 w-7 rounded-full" />
              )}
              <a
                href={`https://github.com/${c.login}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground hover:text-primary flex-1 font-mono text-sm"
              >
                @{c.login}
              </a>
              <span className="text-muted-foreground text-xs">
                {c.prCount} PR{c.prCount !== 1 ? "s" : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
