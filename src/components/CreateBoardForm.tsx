import React, { useReducer, useRef } from "react";
import {
  Layout as LayoutIcon,
  ArrowRight,
  ArrowLeft,
  KeyRound,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Search,
  Plus,
  Users,
} from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { PasswordToggle } from "@/components/auth/PasswordToggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { wizardReducer, initWizardState, type RepoItem, type CollaboratorItem, type StoredPat } from "./wizard-reducer";
import { cn } from "@/lib/utils";

interface CreateBoardFormProps {
  storedPat?: StoredPat | null;
  serverTime?: number;
}

// Repos/collaborators/validate-repo endpoints fall back to the stored PAT (decrypted
// server-side) when no raw token is sent — omit the key entirely instead of sending "".
function patBody(pat: string): { pat: string } | Record<string, never> {
  return pat ? { pat } : {};
}

export default function CreateBoardForm({ storedPat, serverTime = 0 }: CreateBoardFormProps) {
  const [state, dispatch] = useReducer(wizardReducer, storedPat ?? null, initWizardState);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestPatRef = useRef("");
  const lastFetchedPat = useRef("");

  const tokenExpired = Boolean(
    serverTime > 0 && state.patValidation.expiresAt && new Date(state.patValidation.expiresAt).getTime() < serverTime,
  );

  const filteredRepos =
    state.step === 2
      ? state.repos.filter((r) => r.fullName.toLowerCase().includes(state.repoFilter.toLowerCase()))
      : [];
  const filteredCollaborators =
    state.step === 3
      ? state.collaborators.filter((c) => c.login.toLowerCase().includes(state.contributorFilter.toLowerCase()))
      : [];

  async function validatePat(token: string) {
    try {
      const res = await fetch("/api/github/validate-pat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pat: token }),
      });
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- workers-types vs DOM `Response.json()` type disagreement; tsc resolves to `unknown` (assertion required), ESLint's incremental resolver disagrees (false positive)
      const data = (await res.json()) as {
        login?: string;
        avatarUrl?: string;
        warning?: string;
        error?: string;
        expiresAt?: string | null;
      };
      if (latestPatRef.current !== token) return;
      if (res.ok && data.login) {
        dispatch({
          type: "VALIDATE_PAT_SUCCESS",
          login: data.login,
          avatarUrl: data.avatarUrl,
          warnings: data.warning ? [data.warning] : undefined,
          expiresAt: data.expiresAt,
        });
      } else {
        dispatch({ type: "VALIDATE_PAT_ERROR", message: data.error ?? "Token is invalid or expired" });
      }
    } catch {
      if (latestPatRef.current !== token) return;
      dispatch({ type: "VALIDATE_PAT_ERROR", message: "Could not validate token — network error" });
    }
  }

  function handlePatChange(value: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    latestPatRef.current = value.trim();
    dispatch({ type: "SET_PAT", pat: value });

    const trimmed = value.trim();
    if (!trimmed || trimmed.startsWith("github_pat_")) return;

    debounceRef.current = setTimeout(() => {
      dispatch({ type: "VALIDATE_PAT_START" });
      void validatePat(trimmed);
    }, 500);
  }

  async function fetchRepos(pat: string) {
    dispatch({ type: "FETCH_REPOS_START" });
    try {
      const res = await fetch("/api/github/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patBody(pat)),
      });
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- workers-types vs DOM `Response.json()` type disagreement; tsc resolves to `unknown` (assertion required), ESLint's incremental resolver disagrees (false positive)
      const data = (await res.json()) as { repos?: RepoItem[]; error?: string };
      if (res.ok && data.repos) {
        dispatch({ type: "FETCH_REPOS_SUCCESS", repos: data.repos });
        lastFetchedPat.current = pat;
      } else {
        dispatch({ type: "FETCH_REPOS_ERROR", message: data.error ?? "Failed to load repositories" });
      }
    } catch {
      dispatch({ type: "FETCH_REPOS_ERROR", message: "Network error — failed to load repositories" });
    }
  }

  async function fetchCollaborators(pat: string, repos: RepoItem[]) {
    dispatch({ type: "FETCH_COLLABORATORS_START" });
    try {
      const res = await fetch("/api/github/collaborators", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...patBody(pat), repos: repos.map((r) => ({ owner: r.owner, name: r.name })) }),
      });
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- workers-types vs DOM `Response.json()` type disagreement; tsc resolves to `unknown` (assertion required), ESLint's incremental resolver disagrees (false positive)
      const data = (await res.json()) as { collaborators?: CollaboratorItem[]; error?: string };
      if (res.ok && data.collaborators) {
        dispatch({ type: "FETCH_COLLABORATORS_SUCCESS", collaborators: data.collaborators });
      } else {
        dispatch({ type: "FETCH_COLLABORATORS_ERROR", message: data.error ?? "Failed to load collaborators" });
      }
    } catch {
      dispatch({ type: "FETCH_COLLABORATORS_ERROR", message: "Network error — failed to load collaborators" });
    }
  }

  async function saveNewPat(pat: string): Promise<boolean> {
    try {
      const res = await fetch("/api/profile/pat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pat }),
      });
      if (!res.ok) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- workers-types vs DOM `Response.json()` type disagreement; tsc resolves to `unknown` (assertion required), ESLint's incremental resolver disagrees (false positive)
        const data = (await res.json()) as { error?: string };
        dispatch({ type: "VALIDATE_PAT_ERROR", message: data.error ?? "Failed to save token" });
        return false;
      }
      return true;
    } catch {
      dispatch({ type: "VALIDATE_PAT_ERROR", message: "Network error — failed to save token" });
      return false;
    }
  }

  async function handleNext() {
    if (state.step !== 1) return;
    if (!state.name.trim()) {
      dispatch({ type: "SET_NAME_ERROR", error: "Board name is required" });
      return;
    }
    if (state.patValidation.status !== "valid") return;

    const pat = state.pat;
    dispatch({ type: "SET_CHECKING_NAME", checking: true });

    // A freshly-entered token becomes the user's stored PAT going forward — save it before
    // moving on so create_board_atomic (which reads from user_profiles) finds it later.
    if (!state.usingStoredPat) {
      const saved = await saveNewPat(pat);
      if (!saved) {
        dispatch({ type: "SET_CHECKING_NAME", checking: false });
        return;
      }
    }

    try {
      const res = await fetch("/api/board/check-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: state.name.trim() }),
      });
      if (res.status === 409) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- workers-types vs DOM `Response.json()` type disagreement; tsc resolves to `unknown` (assertion required), ESLint's incremental resolver disagrees (false positive)
        const data = (await res.json()) as { error?: string };
        dispatch({ type: "SET_NAME_ERROR", error: data.error ?? "You already have a board with that name" });
        return;
      }
    } catch {
      // network error — let the final submit surface it
    } finally {
      dispatch({ type: "SET_CHECKING_NAME", checking: false });
    }

    const patChanged = lastFetchedPat.current !== pat;
    dispatch({ type: "NEXT_TO_STEP_2" });
    if (patChanged) dispatch({ type: "CLEAR_SELECTED_REPOS" });
    void fetchRepos(pat);
  }

  function handleBack() {
    dispatch({ type: "BACK_TO_STEP_1" });
  }

  function handleBackToStep2() {
    if (state.step !== 3) return;
    const pat = state.pat;
    dispatch({ type: "BACK_TO_STEP_2" });
    void fetchRepos(pat);
  }

  function handleNextToStep3() {
    if (state.step !== 2) return;
    if (state.selectedRepos.length === 0) return;
    const pat = state.pat;
    const repos = state.selectedRepos;
    dispatch({ type: "NEXT_TO_STEP_3" });
    void fetchCollaborators(pat, repos);
  }

  async function handleAddManual() {
    if (state.step !== 2) return;
    const trimmed = state.manualEntry.trim();
    if (!trimmed) return;

    const slashIndex = trimmed.indexOf("/");
    if (slashIndex < 1 || slashIndex === trimmed.length - 1) {
      dispatch({ type: "ADD_MANUAL_REPO_ERROR", message: "Enter in owner/name format (e.g. facebook/react)" });
      return;
    }

    const owner = trimmed.slice(0, slashIndex);
    const repoName = trimmed.slice(slashIndex + 1);
    const fullName = `${owner}/${repoName}`;

    if (state.selectedRepos.some((r) => r.fullName.toLowerCase() === fullName.toLowerCase())) {
      dispatch({ type: "ADD_MANUAL_REPO_ERROR", message: "Repository already added" });
      return;
    }

    dispatch({ type: "ADD_MANUAL_REPO_START" });
    try {
      const res = await fetch("/api/github/validate-repo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...patBody(state.pat), owner, name: repoName }),
      });
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- workers-types vs DOM `Response.json()` type disagreement; tsc resolves to `unknown` (assertion required), ESLint's incremental resolver disagrees (false positive)
      const data = (await res.json()) as RepoItem & { error?: string };
      if (res.ok) {
        const newRepo: RepoItem = {
          owner: data.owner,
          name: data.name,
          fullName: data.fullName,
          private: data.private,
          pushAccess: data.pushAccess,
        };
        dispatch({ type: "ADD_MANUAL_REPO_SUCCESS", repo: newRepo });
      } else {
        dispatch({
          type: "ADD_MANUAL_REPO_ERROR",
          message: (data as { error?: string }).error ?? "Repository not found or not accessible",
        });
      }
    } catch {
      dispatch({ type: "ADD_MANUAL_REPO_ERROR", message: "Network error — could not validate repository" });
    }
  }

  async function handleCreate() {
    if (state.step !== 3) return;
    dispatch({ type: "SUBMIT_START" });
    try {
      const res = await fetch("/api/board", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: state.name.trim(),
          repos: state.selectedRepos.map((r) => ({ owner: r.owner, name: r.name })),
          contributors: state.selectedContributors.map((c) => ({
            githubId: c.id,
            githubLogin: c.login,
            avatarUrl: c.avatarUrl,
          })),
        }),
      });
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- workers-types vs DOM `Response.json()` type disagreement; tsc resolves to `unknown` (assertion required), ESLint's incremental resolver disagrees (false positive)
      const data = (await res.json()) as { id?: string; error?: string };
      if (!res.ok) {
        dispatch({ type: "SUBMIT_ERROR", message: data.error ?? "Something went wrong. Please try again." });
        return;
      }
      window.location.href = `/board/${data.id}`;
    } catch {
      dispatch({ type: "SUBMIT_ERROR", message: "Network error. Please try again." });
    }
  }

  return (
    <div className="space-y-4">
      {/* Step indicator */}
      <div className="flex items-center justify-center gap-2">
        {[1, 2, 3].map((n) => (
          <div
            key={n}
            className={`size-2 rounded-full transition-colors ${state.step === n ? "bg-primary" : "bg-muted-foreground/20"}`}
          />
        ))}
        <span className="text-muted-foreground ml-2 text-xs">Step {state.step} of 3</span>
      </div>

      <Card className="border-border bg-card rounded-2xl">
        <CardContent className="pt-6">
          {state.step === 1 && (
            <div className="space-y-4">
              <FormField
                id="name"
                label="Board name"
                value={state.name}
                onChange={(v) => {
                  dispatch({ type: "SET_NAME", name: v });
                }}
                placeholder="e.g. Platform Team"
                error={state.nameError}
                icon={<LayoutIcon className="size-4" />}
              />

              {state.usingStoredPat ? (
                <div
                  className={cn(
                    "space-y-2 rounded-lg border px-3 py-2.5",
                    tokenExpired ? "border-red-300 bg-red-50" : "border-border bg-muted/50",
                  )}
                >
                  <div
                    className={cn("flex items-center gap-2 text-sm", tokenExpired ? "text-red-600" : "text-green-600")}
                  >
                    {tokenExpired ? <AlertTriangle className="size-4" /> : <CheckCircle2 className="size-4" />}
                    {state.patValidation.login ? (
                      <>
                        {tokenExpired ? "Expired token for" : "Connected as"}{" "}
                        <span className="font-semibold">@{state.patValidation.login}</span>
                      </>
                    ) : tokenExpired ? (
                      "Token expired"
                    ) : (
                      "Using saved token"
                    )}
                  </div>
                  {state.patValidation.expiresAt ? (
                    <p className={cn("text-xs", tokenExpired ? "text-red-500" : "text-muted-foreground")}>
                      {tokenExpired
                        ? `Expired on ${new Date(state.patValidation.expiresAt).toLocaleDateString()}`
                        : `Token expires ${new Date(state.patValidation.expiresAt).toLocaleDateString()}`}
                    </p>
                  ) : (
                    <p className="text-muted-foreground text-xs">No expiration set</p>
                  )}
                  {tokenExpired && (
                    <p className="text-xs font-medium text-red-600">Use a different token to continue.</p>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      dispatch({ type: "USE_DIFFERENT_TOKEN" });
                    }}
                    className={cn(
                      "text-xs underline",
                      tokenExpired
                        ? "font-medium text-red-600 hover:text-red-700"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    Use a different token
                  </button>
                </div>
              ) : (
                <>
                  {storedPat && (
                    <button
                      type="button"
                      onClick={() => {
                        dispatch({ type: "USE_STORED_PAT", login: storedPat.login, expiresAt: storedPat.expiresAt });
                      }}
                      className="text-muted-foreground hover:text-foreground text-xs underline"
                    >
                      {storedPat.login ? `Use stored token (@${storedPat.login})` : "Use saved token"}
                    </button>
                  )}

                  <FormField
                    id="pat"
                    label="GitHub Personal Access Token"
                    type={state.patVisible ? "text" : "password"}
                    value={state.pat}
                    onChange={handlePatChange}
                    placeholder="ghp_..."
                    icon={<KeyRound className="size-4" />}
                    endContent={
                      <PasswordToggle
                        visible={state.patVisible}
                        onToggle={() => {
                          dispatch({ type: "TOGGLE_PAT_VISIBLE" });
                        }}
                      />
                    }
                    hint={
                      <p className="text-muted-foreground mt-1 text-xs">
                        Requires a{" "}
                        <a
                          href="https://github.com/settings/tokens/new?scopes=repo,read:org&description=GitGud"
                          target="_blank"
                          rel="noreferrer"
                          className="hover:text-foreground underline"
                        >
                          classic PAT
                        </a>{" "}
                        with <code className="text-foreground">repo</code> and{" "}
                        <code className="text-foreground">read:org</code> scopes.
                      </p>
                    }
                  />

                  {state.patValidation.status === "validating" && (
                    <div className="text-muted-foreground flex items-center gap-2 text-sm">
                      <Loader2 className="size-4 animate-spin" />
                      Validating token…
                    </div>
                  )}
                  {state.patValidation.status === "valid" && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm text-green-600">
                        <CheckCircle2 className="size-4" />
                        Connected as <span className="font-semibold">@{state.patValidation.login}</span>
                      </div>
                      {state.patValidation.warnings?.map((warning) => (
                        <div
                          key={warning}
                          className="flex items-start gap-2 rounded-md bg-yellow-50 p-3 text-sm text-yellow-700"
                        >
                          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                          {warning}
                        </div>
                      ))}
                    </div>
                  )}
                  {state.patValidation.status === "error" && (
                    <p className="text-sm text-red-500">{state.patValidation.message}</p>
                  )}
                </>
              )}

              <Button
                type="button"
                onClick={() => void handleNext()}
                disabled={state.checkingName || state.patValidation.status !== "valid" || tokenExpired}
                className="bg-primary text-primary-foreground hover:bg-primary/90 w-full rounded-lg px-4 py-2 font-medium transition-colors disabled:opacity-50"
              >
                {state.checkingName ? (
                  <span className="flex items-center gap-2">
                    <span className="border-primary-foreground/30 border-t-primary-foreground size-4 animate-spin rounded-full border-2" />
                    Checking...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    Next
                    <ArrowRight className="size-4" />
                  </span>
                )}
              </Button>
            </div>
          )}

          {state.step === 2 && (
            <div className="space-y-4">
              {/* Repo loading skeletons */}
              {state.reposLoading && (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="bg-muted h-10 w-full" />
                  ))}
                </div>
              )}

              {/* Repo fetch error */}
              {!state.reposLoading && state.reposError && (
                <div className="rounded-md bg-red-50 p-3">
                  <p className="text-sm text-red-600">{state.reposError}</p>
                  <button
                    type="button"
                    onClick={() => void fetchRepos(state.pat)}
                    className="text-muted-foreground hover:text-foreground mt-1 text-xs underline"
                  >
                    Retry
                  </button>
                </div>
              )}

              {/* Repo picker */}
              {!state.reposLoading && !state.reposError && state.repos.length > 0 && (
                <>
                  <div className="relative">
                    <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                    <Input
                      placeholder="Filter repositories..."
                      value={state.repoFilter}
                      onChange={(e) => {
                        dispatch({ type: "SET_REPO_FILTER", filter: e.target.value });
                      }}
                      className="border-border bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-primary pl-9"
                    />
                  </div>

                  <div className="border-border max-h-60 space-y-0.5 overflow-y-auto rounded-lg border p-1">
                    {filteredRepos.length === 0 ? (
                      <p className="text-muted-foreground px-3 py-2 text-sm">No repositories match your filter.</p>
                    ) : (
                      filteredRepos.map((repo) => {
                        const isSelected = state.selectedRepos.some((r) => r.fullName === repo.fullName);
                        return (
                          <label
                            key={repo.fullName}
                            className="hover:bg-muted flex cursor-pointer items-center gap-3 rounded-md px-3 py-2"
                          >
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => {
                                dispatch({ type: "TOGGLE_REPO_SELECTION", repo });
                              }}
                              className="border-slate-300"
                            />
                            <img
                              src={`https://github.com/${repo.owner}.png?size=48`}
                              alt={repo.owner}
                              className="size-6 shrink-0 rounded-full"
                              width={24}
                              height={24}
                            />
                            <span className="text-foreground flex-1 truncate text-sm">{repo.fullName}</span>
                            <div className="flex shrink-0 gap-1">
                              {repo.private && (
                                <Badge variant="outline" className="border-border text-muted-foreground text-xs">
                                  Private
                                </Badge>
                              )}
                              {!repo.pushAccess && (
                                <Badge variant="secondary" className="text-xs">
                                  Read-only
                                </Badge>
                              )}
                            </div>
                          </label>
                        );
                      })
                    )}
                  </div>

                  {state.selectedRepos.length > 0 && (
                    <p className="text-muted-foreground text-xs">
                      {state.selectedRepos.length} repo{state.selectedRepos.length !== 1 ? "s" : ""} selected
                    </p>
                  )}
                </>
              )}

              {/* Manual repo entry */}
              <div className="space-y-2">
                <p className="text-muted-foreground text-xs">Add a public repo manually:</p>
                <div className="flex gap-2">
                  <Input
                    placeholder="owner/name (e.g. facebook/react)"
                    value={state.manualEntry}
                    onChange={(e) => {
                      dispatch({ type: "SET_MANUAL_ENTRY", value: e.target.value });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleAddManual();
                    }}
                    className="border-border bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-primary flex-1"
                  />
                  <Button
                    type="button"
                    onClick={() => void handleAddManual()}
                    disabled={!state.manualEntry.trim() || state.manualEntryLoading}
                    variant="outline"
                    className="border-primary/30 bg-card text-primary hover:bg-primary/10"
                  >
                    {state.manualEntryLoading ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Plus className="size-4" />
                    )}
                  </Button>
                </div>
                {state.manualEntryError && <p className="text-sm text-red-500">{state.manualEntryError}</p>}
              </div>

              {state.apiError && <p className="rounded-md bg-red-50 p-3 text-sm text-red-600">{state.apiError}</p>}

              <div className="flex gap-2">
                <Button
                  type="button"
                  onClick={handleBack}
                  variant="outline"
                  className="border-border bg-card text-foreground hover:bg-accent flex-1 rounded-lg"
                >
                  <span className="flex items-center gap-2">
                    <ArrowLeft className="size-4" />
                    Back
                  </span>
                </Button>
                <Button
                  type="button"
                  onClick={handleNextToStep3}
                  disabled={state.selectedRepos.length === 0}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 flex-1 rounded-lg px-4 py-2 font-medium transition-colors disabled:opacity-50"
                >
                  <span className="flex items-center gap-2">
                    Next
                    <ArrowRight className="size-4" />
                  </span>
                </Button>
              </div>
              <p className="text-muted-foreground text-sm">
                {"You'll be the "}
                <span className="text-foreground font-semibold">Supervisor</span> of this board.
              </p>
            </div>
          )}

          {state.step === 3 && (
            <div className="space-y-4">
              {/* Collaborator loading skeletons */}
              {state.collaboratorsLoading && (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="bg-muted h-10 w-full" />
                  ))}
                </div>
              )}

              {/* Collaborator fetch error */}
              {!state.collaboratorsLoading && state.collaboratorsError && (
                <div className="rounded-md bg-red-50 p-3">
                  <p className="text-sm text-red-600">{state.collaboratorsError}</p>
                  <button
                    type="button"
                    onClick={() => void fetchCollaborators(state.pat, state.selectedRepos)}
                    className="text-muted-foreground hover:text-foreground mt-1 text-xs underline"
                  >
                    Retry
                  </button>
                </div>
              )}

              {/* Collaborator picker */}
              {!state.collaboratorsLoading && !state.collaboratorsError && (
                <>
                  {state.collaborators.length > 0 ? (
                    <>
                      <div className="relative">
                        <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                        <Input
                          placeholder="Filter contributors..."
                          value={state.contributorFilter}
                          onChange={(e) => {
                            dispatch({ type: "SET_CONTRIBUTOR_FILTER", filter: e.target.value });
                          }}
                          className="border-border bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-primary pl-9"
                        />
                      </div>

                      <div className="border-border max-h-60 space-y-0.5 overflow-y-auto rounded-lg border p-1">
                        {filteredCollaborators.length === 0 ? (
                          <p className="text-muted-foreground px-3 py-2 text-sm">No contributors match your filter.</p>
                        ) : (
                          filteredCollaborators.map((collab) => {
                            const isSelected = state.selectedContributors.some((c) => c.id === collab.id);
                            return (
                              <label
                                key={collab.id}
                                className="hover:bg-muted flex cursor-pointer items-center gap-3 rounded-md px-3 py-2"
                              >
                                <Checkbox
                                  checked={isSelected}
                                  onCheckedChange={() => {
                                    dispatch({ type: "TOGGLE_CONTRIBUTOR_SELECTION", contributor: collab });
                                  }}
                                  className="border-slate-300"
                                />
                                <img
                                  src={collab.avatarUrl}
                                  alt={collab.login}
                                  className="size-8 rounded-full"
                                  width={32}
                                  height={32}
                                />
                                <span className="text-foreground flex-1 truncate text-sm">@{collab.login}</span>
                                <span className="text-muted-foreground shrink-0 text-xs">{collab.type}</span>
                              </label>
                            );
                          })
                        )}
                      </div>

                      {state.selectedContributors.length > 0 && (
                        <p className="text-muted-foreground text-xs">
                          {state.selectedContributors.length} contributor
                          {state.selectedContributors.length !== 1 ? "s" : ""} selected
                        </p>
                      )}
                    </>
                  ) : (
                    <div className="text-muted-foreground flex flex-col items-center gap-2 py-6">
                      <Users className="size-8" />
                      <p className="text-sm">No collaborators found for the selected repositories.</p>
                    </div>
                  )}
                </>
              )}

              {state.apiError && <p className="rounded-md bg-red-50 p-3 text-sm text-red-600">{state.apiError}</p>}

              <div className="flex gap-2">
                <Button
                  type="button"
                  onClick={handleBackToStep2}
                  variant="outline"
                  className="border-border bg-card text-foreground hover:bg-accent flex-1 rounded-lg"
                >
                  <span className="flex items-center gap-2">
                    <ArrowLeft className="size-4" />
                    Back
                  </span>
                </Button>
                <Button
                  type="button"
                  onClick={() => void handleCreate()}
                  disabled={state.submitting || state.selectedContributors.length === 0}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 flex-1 rounded-lg px-4 py-2 font-medium transition-colors disabled:opacity-50"
                >
                  {state.submitting ? (
                    <span className="flex items-center gap-2">
                      <span className="border-primary-foreground/30 border-t-primary-foreground size-4 animate-spin rounded-full border-2" />
                      Creating...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <LayoutIcon className="size-4" />
                      Create Board
                    </span>
                  )}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
