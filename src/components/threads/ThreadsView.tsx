import { useState, useEffect } from "react";
import { ChevronRight, ChevronDown, MessageSquare, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type {
  ClassifiedThread,
  ClassifiedThreadsPage,
  ThreadMessage,
  IntentCategory,
  TechnicalDomain,
  PeriodSlug,
} from "@/types";
import { PeriodSelector } from "@/components/impact/PeriodSelector";
import { ContributorSelector } from "@/components/impact/ImpactView";
import { SyncIndicator } from "@/components/impact/SyncIndicator";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  INTENT_CATEGORIES,
  DOMAIN_CATEGORIES,
  INTENT_COLORS,
  DOMAIN_COLORS,
  INTENT_TEXT_COLORS,
  DOMAIN_TEXT_COLORS,
  INTENT_LABELS,
  DOMAIN_LABELS,
} from "@/lib/classification-colors";

const PAGE_SIZE = 25;

type Role = "started" | "received" | "self" | "joined" | "all";

const ROLE_LABELS: Record<Role, string> = {
  all: "All",
  started: "Started",
  received: "Received",
  self: "Self-reviewed",
  joined: "Joined",
};

interface ContributorInfo {
  githubLogin: string;
  avatarUrl: string | null;
}

interface Filters {
  intent?: IntentCategory;
  domain?: TechnicalDomain;
  prId?: number;
  role: Role;
}

interface Props {
  boardId: string;
  githubLogin: string;
  period: PeriodSlug;
  contributor: ContributorInfo;
  contributors: ContributorInfo[];
  initialFilters?: { prId?: number; intent?: IntentCategory; domain?: TechnicalDomain };
}

interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

function idle<T>(): FetchState<T> {
  return { data: null, loading: true, error: null };
}

async function fetchSection<T>(
  url: string,
  setter: React.Dispatch<React.SetStateAction<FetchState<T>>>,
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

function buildQuery(period: PeriodSlug, filters: Filters, page: number): string {
  const params = new URLSearchParams({ period, page: String(page), pageSize: String(PAGE_SIZE) });
  if (filters.intent) params.set("intent", filters.intent);
  if (filters.domain) params.set("domain", filters.domain);
  if (filters.prId) params.set("prId", String(filters.prId));
  if (filters.role !== "all") params.set("role", filters.role);
  return params.toString();
}

function IntentBadge({ intent }: { intent: IntentCategory }) {
  const bg = INTENT_COLORS[intent];
  const text = INTENT_TEXT_COLORS[intent];
  return (
    <span className="rounded px-1.5 py-0.5 text-xs font-semibold" style={{ backgroundColor: `${bg}33`, color: text }}>
      {INTENT_LABELS[intent]}
    </span>
  );
}

function DomainBadge({ domain }: { domain: TechnicalDomain }) {
  const bg = DOMAIN_COLORS[domain];
  const text = DOMAIN_TEXT_COLORS[domain];
  return (
    <span className="rounded px-1.5 py-0.5 text-xs font-semibold" style={{ backgroundColor: `${bg}33`, color: text }}>
      {DOMAIN_LABELS[domain]}
    </span>
  );
}

function FilterDropdown({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  const current = options.find((o) => o.value === value) ?? options[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="border-border bg-card text-foreground hover:bg-accent hover:text-foreground gap-1.5"
        >
          {current.label}
          <ChevronDown className="size-3.5 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[160px]">
        {options.map((o) => (
          <DropdownMenuItem
            key={o.value}
            onClick={() => {
              onChange(o.value);
            }}
            className={cn("gap-2", o.value === value && "font-medium")}
          >
            <Check className={cn("size-3.5", o.value === value ? "opacity-100" : "opacity-0")} />
            {o.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type ThreadRole = "started" | "received" | "self" | "joined";

const ROLE_BADGE_STYLES: Record<ThreadRole, string> = {
  started: "bg-emerald-500/15 text-emerald-700",
  received: "bg-sky-500/15 text-sky-700",
  self: "bg-amber-500/15 text-amber-700",
  joined: "bg-violet-500/15 text-violet-700",
};

const ROLE_BADGE_LABELS: Record<ThreadRole, string> = {
  started: "Started",
  received: "Received",
  self: "Self-review",
  joined: "Joined",
};

function RoleBadge({ role }: { role: ThreadRole }) {
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-xs font-semibold", ROLE_BADGE_STYLES[role])}>
      {ROLE_BADGE_LABELS[role]}
    </span>
  );
}

function ThreadDiscussion({
  boardId,
  viewerLogin,
  threadRootCommentId,
}: {
  boardId: string;
  viewerLogin: string;
  threadRootCommentId: number;
}) {
  const [state, setState] = useState<FetchState<{ messages: ThreadMessage[] }>>(idle());

  useEffect(() => {
    void fetchSection<{ messages: ThreadMessage[] }>(
      `/api/board/${boardId}/threads/${viewerLogin}/${threadRootCommentId}`,
      setState,
    );
  }, [boardId, viewerLogin, threadRootCommentId]);

  if (state.loading) {
    return (
      <div className="space-y-2 py-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="bg-muted h-8" />
        ))}
      </div>
    );
  }
  if (state.error) {
    return <p className="py-3 text-sm text-red-500">{state.error}</p>;
  }
  if (!state.data || state.data.messages.length === 0) {
    return <p className="text-muted-foreground py-3 text-sm italic">No messages found for this thread</p>;
  }

  return (
    <div className="space-y-3 py-3">
      {state.data.messages.map((message) => (
        <div
          key={message.id}
          className={cn("rounded-lg border border-slate-200 bg-white p-3 shadow-sm", message.inReplyToId && "ml-6")}
        >
          <div className="mb-1 flex items-center gap-2">
            <span className="text-foreground font-mono text-xs font-medium">@{message.commenterLogin}</span>
            <span className="text-muted-foreground text-xs">{new Date(message.createdAt).toLocaleString("en-GB")}</span>
          </div>
          <p className="text-foreground text-sm whitespace-pre-wrap">{message.body}</p>
        </div>
      ))}
    </div>
  );
}

function ThreadRow({
  thread,
  boardId,
  viewerLogin,
}: {
  thread: ClassifiedThread;
  boardId: string;
  viewerLogin: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const isViewerPr = thread.prAuthorLogin === viewerLogin;
  const isViewerCommenter = thread.commenterLogin === viewerLogin;
  // Neither the root commenter nor the PR author: the viewer only shows up here via a reply
  // (the "joined" role) — someone else's thread on someone else's PR.
  const role: ThreadRole = isViewerCommenter ? (isViewerPr ? "self" : "started") : isViewerPr ? "received" : "joined";

  return (
    <>
      <tr className="border-border/50 hover:bg-muted border-t">
        <td className="py-2 pr-1 align-top">
          <button
            onClick={() => {
              setExpanded((e) => !e);
            }}
            aria-label={expanded ? "Collapse discussion" : "Expand discussion"}
            aria-expanded={expanded}
            className="text-muted-foreground hover:text-foreground"
          >
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        </td>
        <td className="max-w-[320px] py-2 pr-3">
          <p className="text-foreground line-clamp-2 text-sm">{thread.commentSnippet}</p>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground font-mono text-xs">@{thread.commenterLogin}</span>
            <RoleBadge role={role} />
            <span className="text-muted-foreground flex items-center gap-1 text-xs">
              <MessageSquare size={12} />
              {thread.messageCount}
            </span>
          </div>
        </td>
        <td className="max-w-[260px] py-2 pr-3">
          <a
            href={thread.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground hover:text-primary block truncate text-sm font-medium"
          >
            #{thread.prNumber} {thread.prTitle}
          </a>
          <span className="text-muted-foreground font-mono text-xs">
            {thread.prRepo} · by @{thread.prAuthorLogin}
          </span>
        </td>
        <td className="py-2 pr-3">
          <IntentBadge intent={thread.intent} />
        </td>
        <td className="py-2 pr-3">
          <DomainBadge domain={thread.domain} />
        </td>
        <td className="text-muted-foreground py-2 text-xs">{new Date(thread.createdAt).toLocaleDateString("en-GB")}</td>
      </tr>
      {expanded && (
        <tr className="border-border/50 bg-muted/30 border-t">
          <td colSpan={6} className="px-3">
            <ThreadDiscussion
              boardId={boardId}
              viewerLogin={viewerLogin}
              threadRootCommentId={thread.threadRootCommentId}
            />
          </td>
        </tr>
      )}
    </>
  );
}

export default function ThreadsView({
  boardId,
  githubLogin: initialLogin,
  period: initialPeriod,
  contributor: initialContributor,
  contributors,
  initialFilters,
}: Props) {
  const [period, setPeriod] = useState<PeriodSlug>(initialPeriod);
  const [currentLogin, setCurrentLogin] = useState<string>(initialLogin);
  const [currentContributor, setCurrentContributor] = useState<ContributorInfo>(initialContributor);
  const [filters, setFilters] = useState<Filters>({
    intent: initialFilters?.intent,
    domain: initialFilters?.domain,
    prId: initialFilters?.prId,
    role: "all",
  });
  const [page, setPage] = useState(1);
  const [state, setState] = useState<FetchState<ClassifiedThreadsPage>>(idle());
  const [fetchKey, setFetchKey] = useState(0);
  const [syncState, setSyncState] = useState<FetchState<{ lastSyncedAt: string | null }>>(idle());

  useEffect(() => {
    const query = buildQuery(period, filters, page);
    void fetchSection<ClassifiedThreadsPage>(`/api/board/${boardId}/threads/${currentLogin}?${query}`, setState);
  }, [boardId, currentLogin, period, filters, page, fetchKey]);

  useEffect(() => {
    void fetchSection<{ lastSyncedAt: string | null }>(`/api/board/${boardId}/last-synced`, setSyncState);
  }, [boardId, fetchKey]);

  function handleSyncComplete() {
    setFetchKey((k) => k + 1);
  }

  useEffect(() => {
    const query = buildQuery(period, filters, page);
    history.replaceState(null, "", `/board/${boardId}/threads/${currentLogin}/${period}?${query}`);
  }, [boardId, currentLogin, period, filters, page]);

  function handlePeriodChange(slug: PeriodSlug) {
    setPage(1);
    setPeriod(slug);
  }

  function handleContributorChange(login: string) {
    const next = contributors.find((c) => c.githubLogin === login);
    if (!next) return;
    setPage(1);
    setCurrentLogin(login);
    setCurrentContributor(next);
  }

  function updateFilters(patch: Partial<Filters>) {
    setPage(1);
    setFilters((f) => ({ ...f, ...patch }));
  }

  const totalPages = state.data ? Math.max(1, Math.ceil(state.data.total / state.data.pageSize)) : 1;

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
            lastSyncedAt={syncState.data?.lastSyncedAt ?? null}
            boardId={boardId}
            onSyncComplete={handleSyncComplete}
          />
          <PeriodSelector period={period} onPeriodChange={handlePeriodChange} />
        </div>
      </div>

      {/* filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterDropdown
          value={filters.intent ?? ""}
          options={[
            { value: "", label: "All intents" },
            ...INTENT_CATEGORIES.map((c) => ({ value: c, label: INTENT_LABELS[c] })),
          ]}
          onChange={(v) => {
            updateFilters({ intent: v ? (v as IntentCategory) : undefined });
          }}
        />
        <FilterDropdown
          value={filters.domain ?? ""}
          options={[
            { value: "", label: "All domains" },
            ...DOMAIN_CATEGORIES.map((d) => ({ value: d, label: DOMAIN_LABELS[d] })),
          ]}
          onChange={(v) => {
            updateFilters({ domain: v ? (v as TechnicalDomain) : undefined });
          }}
        />
        <FilterDropdown
          value={filters.role}
          options={(["all", "started", "received", "self", "joined"] as const).map((r) => ({
            value: r,
            label: ROLE_LABELS[r],
          }))}
          onChange={(v) => {
            updateFilters({ role: (v || "all") as Role });
          }}
        />

        {filters.prId !== undefined && (
          <button
            onClick={() => {
              updateFilters({ prId: undefined });
            }}
            className="border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 rounded-lg border px-2 py-1.5 text-sm transition-colors"
          >
            PR #{filters.prId} ×
          </button>
        )}
      </div>

      {/* thread table */}
      <section className="border-border bg-card rounded-xl border p-5">
        {state.loading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="bg-muted h-10" />
            ))}
          </div>
        ) : state.error ? (
          <p className="text-sm text-red-500">{state.error}</p>
        ) : !state.data || state.data.threads.length === 0 ? (
          <p className="text-muted-foreground text-sm italic">No classified threads match these filters</p>
        ) : (
          <>
            <p className="text-muted-foreground mb-3 text-xs">
              {state.data.total} of {state.data.totalRootComments} threads classified
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px]">
                <thead>
                  <tr className="text-left">
                    <th className="pb-2"></th>
                    <th className="text-muted-foreground pb-2 text-xs font-medium">Comment</th>
                    <th className="text-muted-foreground pr-3 pb-2 text-xs font-medium">PR</th>
                    <th className="text-muted-foreground pr-3 pb-2 text-xs font-medium">Intent</th>
                    <th className="text-muted-foreground pr-3 pb-2 text-xs font-medium">Domain</th>
                    <th className="text-muted-foreground pb-2 text-xs font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {state.data.threads.map((thread) => (
                    <ThreadRow
                      key={thread.threadRootCommentId}
                      thread={thread}
                      boardId={boardId}
                      viewerLogin={currentLogin}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {/* pagination */}
            <div className="border-border mt-4 flex items-center justify-between border-t pt-3">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => {
                  setPage((p) => p - 1);
                }}
                className="border-primary/30 bg-card text-primary hover:bg-primary/10"
              >
                Previous
              </Button>
              <span className="text-muted-foreground text-xs">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => {
                  setPage((p) => p + 1);
                }}
                className="border-primary/30 bg-card text-primary hover:bg-primary/10"
              >
                Next
              </Button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
