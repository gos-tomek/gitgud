import { useState, useEffect, useRef } from "react";
import type {
  ImpactSummary,
  AuthorMetrics,
  ReviewerMetrics,
  ActivityData,
  ClassificationAggregates,
  PeriodSlug,
} from "@/types";
import { isValidPeriodSlug } from "@/lib/date-range";
import { PeriodSelector } from "./PeriodSelector";
import { SyncIndicator } from "./SyncIndicator";
import { KpiCards } from "./KpiCards";
import { AuthorSection } from "./AuthorSection";
import { ReviewerSection } from "./ReviewerSection";
import { ThreadQualitySection } from "./ThreadQualitySection";
import { ClassificationSection } from "./ClassificationSection";
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

interface ContributorInfo {
  githubLogin: string;
  avatarUrl: string | null;
}

interface Props {
  boardId: string;
  githubLogin: string;
  period: PeriodSlug;
  contributor: ContributorInfo;
  contributors: ContributorInfo[];
}

function ContributorAvatar({ c, size = "md" }: { c: ContributorInfo; size?: "sm" | "md" | "lg" }) {
  const dim = size === "lg" ? "h-12 w-12" : size === "sm" ? "h-6 w-6 text-[10px]" : "h-8 w-8 text-xs";
  return c.avatarUrl ? (
    <img src={c.avatarUrl} alt={c.githubLogin} className={`${dim} rounded-full`} />
  ) : (
    <div
      className={`${dim} bg-primary text-primary-foreground flex items-center justify-center rounded-full font-bold`}
    >
      {c.githubLogin[0].toUpperCase()}
    </div>
  );
}

export function ContributorSelector({
  current,
  contributors,
  onContributorChange,
}: {
  current: ContributorInfo;
  contributors: ContributorInfo[];
  onContributorChange: (login: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
    };
  }, [open]);

  if (contributors.length <= 1) {
    return (
      <div className="flex items-center gap-2">
        <ContributorAvatar c={current} size="lg" />
        <div>
          <h1 className="text-foreground text-xl font-bold">@{current.githubLogin}</h1>
          <a
            href={`https://github.com/${current.githubLogin}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground text-xs"
          >
            github.com/{current.githubLogin}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => {
          setOpen((o) => !o);
        }}
        className="hover:bg-accent flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors"
      >
        <ContributorAvatar c={current} size="lg" />
        <div className="text-left">
          <div className="flex items-center gap-1.5">
            <h1 className="text-foreground text-xl font-bold">@{current.githubLogin}</h1>
            <svg className="text-muted-foreground h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
          <a
            href={`https://github.com/${current.githubLogin}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              e.stopPropagation();
            }}
            className="text-muted-foreground hover:text-foreground text-xs"
          >
            github.com/{current.githubLogin}
          </a>
        </div>
      </button>

      {open && (
        <div className="border-border bg-popover absolute top-full left-0 z-50 mt-1.5 w-64 overflow-hidden rounded-xl border py-1.5 shadow-2xl">
          {contributors.map((c) => (
            <button
              key={c.githubLogin}
              onClick={() => {
                onContributorChange(c.githubLogin);
                setOpen(false);
              }}
              className="hover:bg-accent flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors"
            >
              <ContributorAvatar c={c} size="sm" />
              <span
                className={
                  c.githubLogin === current.githubLogin ? "text-foreground font-semibold" : "text-muted-foreground"
                }
              >
                @{c.githubLogin}
              </span>
              {c.githubLogin === current.githubLogin && (
                <svg className="text-primary ml-auto h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ImpactView({
  boardId,
  githubLogin: initialLogin,
  period: initialPeriod,
  contributor: initialContributor,
  contributors,
}: Props) {
  const [period, setPeriod] = useState<PeriodSlug>(initialPeriod);
  const [currentLogin, setCurrentLogin] = useState<string>(initialLogin);
  const [currentContributor, setCurrentContributor] = useState<ContributorInfo>(initialContributor);
  const [fetchKey, setFetchKey] = useState(0);
  const [summary, setSummary] = useState<SectionState<ImpactSummary>>(idle());
  const [author, setAuthor] = useState<SectionState<AuthorMetrics>>(idle());
  const [reviewer, setReviewer] = useState<SectionState<ReviewerMetrics>>(idle());
  const [activity, setActivity] = useState<SectionState<ActivityData>>(idle());
  const [classifications, setClassifications] = useState<SectionState<ClassificationAggregates>>(idle());

  useEffect(() => {
    const base = `/api/board/${boardId}/impact/${currentLogin}`;
    const q = `?period=${period}`;
    void fetchSection<ImpactSummary>(`${base}/summary${q}`, setSummary);
    void fetchSection<AuthorMetrics>(`${base}/author${q}`, setAuthor);
    void fetchSection<ReviewerMetrics>(`${base}/reviewer${q}`, setReviewer);
    void fetchSection<ActivityData>(`${base}/activity${q}`, setActivity);
    void fetchSection<ClassificationAggregates>(`${base}/classifications${q}`, setClassifications);
  }, [boardId, currentLogin, period, fetchKey]);

  function handlePeriodChange(slug: PeriodSlug) {
    history.pushState(null, "", `/board/${boardId}/impact/${currentLogin}/${slug}`);
    setSummary(idle());
    setAuthor(idle());
    setReviewer(idle());
    setActivity(idle());
    setClassifications(idle());
    setPeriod(slug);
  }

  function handleContributorChange(login: string) {
    const next = contributors.find((c) => c.githubLogin === login);
    if (!next) return;
    history.pushState(null, "", `/board/${boardId}/impact/${login}/${period}`);
    setSummary(idle());
    setAuthor(idle());
    setReviewer(idle());
    setActivity(idle());
    setClassifications(idle());
    setCurrentLogin(login);
    setCurrentContributor(next);
  }

  useEffect(() => {
    function onPopState() {
      const segments = location.pathname.split("/");
      const login = segments[segments.indexOf("impact") + 1];
      const slug = segments[segments.indexOf("impact") + 2];
      const next = contributors.find((c) => c.githubLogin === login);
      if (!next) return;
      setSummary(idle());
      setAuthor(idle());
      setReviewer(idle());
      setActivity(idle());
      setClassifications(idle());
      setCurrentLogin(login);
      setCurrentContributor(next);
      if (isValidPeriodSlug(slug)) setPeriod(slug);
    }
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
    };
  }, [contributors]);

  function handleSyncComplete() {
    setSummary(idle());
    setAuthor(idle());
    setReviewer(idle());
    setActivity(idle());
    setClassifications(idle());
    setFetchKey((k) => k + 1);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <ContributorSelector
          current={currentContributor}
          contributors={contributors}
          onContributorChange={handleContributorChange}
        />
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

      {/* classification */}
      <ClassificationSection
        data={classifications.data}
        loading={classifications.loading}
        threadsUrl={`/board/${boardId}/threads/${currentLogin}/${period}`}
      />

      {/* heatmap */}
      <section className="border-border bg-card rounded-xl border p-5">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">Daily activity</h2>
            <p className="text-muted-foreground mt-0.5 text-xs">
              PR, review, and comment activity by day — last 52 weeks for context
            </p>
          </div>
          <div className="text-muted-foreground flex shrink-0 items-center gap-1 text-xs">
            <span>Less</span>
            {(
              ["fill-gray-100", "fill-primary/20", "fill-primary/40", "fill-primary/60", "fill-primary/90"] as const
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
        threadsBaseUrl={`/board/${boardId}/threads/${currentLogin}/${period}`}
      />
    </div>
  );
}
