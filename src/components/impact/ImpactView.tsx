import { useState, useEffect } from "react";
import type { ImpactSummary, AuthorMetrics, ReviewerMetrics, ActivityData, PeriodSlug } from "@/types";
import { PeriodSelector } from "./PeriodSelector";
import { SyncIndicator } from "./SyncIndicator";
import { KpiCards } from "./KpiCards";
import { AuthorSection } from "./AuthorSection";
import { ReviewerSection } from "./ReviewerSection";
import { ThreadQualitySection } from "./ThreadQualitySection";
import { ContributionHeatmap } from "./ContributionHeatmap";
import { CollaboratorsSection } from "./CollaboratorsSection";
import { RepoActivitySection } from "./RepoActivitySection";
import { PrTable } from "./PrTable";

interface SectionState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

function idle<T>(): SectionState<T> {
  return { data: null, loading: true, error: null };
}

async function fetchSection<T>(
  url: string,
  setter: React.Dispatch<React.SetStateAction<SectionState<T>>>,
): Promise<void> {
  setter({ data: null, loading: true, error: null });
  try {
    const res = await fetch(url);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setter({ data: null, loading: false, error: body.error ?? `HTTP ${res.status}` });
    } else {
      const data = (await res.json()) as T;
      setter({ data, loading: false, error: null });
    }
  } catch {
    setter({ data: null, loading: false, error: "Network error" });
  }
}

interface Contributor {
  githubLogin: string;
  avatarUrl: string | null;
}

interface Props {
  boardId: string;
  githubLogin: string;
  period: PeriodSlug;
  contributor: Contributor;
}

export default function ImpactView({ boardId, githubLogin, period: initialPeriod, contributor }: Props) {
  const [period, setPeriod] = useState<PeriodSlug>(initialPeriod);
  const [fetchKey, setFetchKey] = useState(0);
  const [summary, setSummary] = useState<SectionState<ImpactSummary>>(idle());
  const [author, setAuthor] = useState<SectionState<AuthorMetrics>>(idle());
  const [reviewer, setReviewer] = useState<SectionState<ReviewerMetrics>>(idle());
  const [activity, setActivity] = useState<SectionState<ActivityData>>(idle());

  useEffect(() => {
    const base = `/api/board/${boardId}/impact/${githubLogin}`;
    const q = `?period=${period}`;
    void fetchSection<ImpactSummary>(`${base}/summary${q}`, setSummary);
    void fetchSection<AuthorMetrics>(`${base}/author${q}`, setAuthor);
    void fetchSection<ReviewerMetrics>(`${base}/reviewer${q}`, setReviewer);
    void fetchSection<ActivityData>(`${base}/activity${q}`, setActivity);
  }, [boardId, githubLogin, period, fetchKey]);

  function handlePeriodChange(slug: PeriodSlug) {
    history.replaceState(null, "", `/board/${boardId}/impact/${githubLogin}/${slug}`);
    setSummary(idle());
    setAuthor(idle());
    setReviewer(idle());
    setActivity(idle());
    setPeriod(slug);
  }

  function handleSyncComplete() {
    setSummary(idle());
    setAuthor(idle());
    setReviewer(idle());
    setActivity(idle());
    setFetchKey((k) => k + 1);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          {contributor.avatarUrl ? (
            <img src={contributor.avatarUrl} alt={contributor.githubLogin} className="h-12 w-12 rounded-full" />
          ) : (
            <div className="h-12 w-12 rounded-full bg-white/10" />
          )}
          <div>
            <h1 className="text-xl font-bold text-white">@{contributor.githubLogin}</h1>
            <a
              href={`https://github.com/${contributor.githubLogin}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-100/50 hover:text-white"
            >
              github.com/{contributor.githubLogin}
            </a>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <SyncIndicator
            lastSyncedAt={summary.data?.lastSyncedAt ?? null}
            boardId={boardId}
            onSyncComplete={handleSyncComplete}
          />
          <PeriodSelector period={period} onPeriodChange={handlePeriodChange} />
        </div>
      </div>

      {/* KPI cards */}
      <KpiCards summary={summary.data} loading={summary.loading} />

      {/* author / reviewer side-by-side on large screens */}
      <div className="grid gap-4 lg:grid-cols-2">
        <AuthorSection data={author.data} loading={author.loading} />
        <ReviewerSection data={reviewer.data} loading={reviewer.loading} />
      </div>

      {/* thread quality */}
      <ThreadQualitySection data={reviewer.data} loading={reviewer.loading} />

      {/* heatmap */}
      <section className="rounded-xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold tracking-wide text-blue-100/60 uppercase">Daily activity</h2>
            <p className="mt-0.5 text-xs text-blue-100/40">
              PR, review, and comment activity by day — last 52 weeks for context
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1 text-xs text-blue-100/40">
            <span>Less</span>
            {(
              [
                "fill-white/5",
                "fill-purple-500/20",
                "fill-purple-500/40",
                "fill-purple-500/60",
                "fill-purple-500/90",
              ] as const
            ).map((cls, i) => (
              <svg key={i} width={11} height={11}>
                <rect width={11} height={11} rx={2} className={cls} />
              </svg>
            ))}
            <span>More</span>
          </div>
        </div>
        <ContributionHeatmap data={activity.data?.dailyHeatmap ?? null} loading={activity.loading} />
      </section>

      {/* collaborators + repo activity side-by-side on large screens */}
      <div className="grid gap-4 lg:grid-cols-2">
        <CollaboratorsSection data={activity.data?.topCollaborators ?? null} loading={activity.loading} />
        <RepoActivitySection data={activity.data?.repoActivity ?? null} loading={activity.loading} />
      </div>

      {/* PR table */}
      <PrTable
        authoredPrs={activity.data?.recentAuthoredPrs ?? null}
        reviewedPrs={activity.data?.recentReviewedPrs ?? null}
        loading={activity.loading}
      />
    </div>
  );
}
