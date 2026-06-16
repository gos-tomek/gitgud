import { Skeleton } from "@/components/ui/skeleton";
import type { Collaborator } from "@/types";

interface Props {
  data: Collaborator[] | null;
  loading: boolean;
}

export function CollaboratorsSection({ data, loading }: Props) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
      <h2 className="mb-4 text-sm font-semibold tracking-wide text-blue-100/60 uppercase">Top collaborators</h2>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 bg-white/10" />
          ))}
        </div>
      ) : !data || data.length === 0 ? (
        <p className="text-sm text-blue-100/40 italic">No collaborators in this period</p>
      ) : (
        <ul className="space-y-2">
          {data.map((c) => (
            <li key={c.login} className="flex items-center gap-3 rounded-lg border border-white/5 bg-white/5 px-3 py-2">
              {c.avatarUrl ? (
                <img src={c.avatarUrl} alt={c.login} className="h-7 w-7 rounded-full" />
              ) : (
                <div className="h-7 w-7 rounded-full bg-white/10" />
              )}
              <a
                href={`https://github.com/${c.login}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 font-mono text-sm text-blue-100/80 hover:text-white"
              >
                @{c.login}
              </a>
              <span className="text-xs text-blue-100/40">
                {c.prCount} PR{c.prCount !== 1 ? "s" : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
