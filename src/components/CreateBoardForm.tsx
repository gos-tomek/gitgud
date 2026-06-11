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
import { wizardReducer, initialState, type RepoItem, type CollaboratorItem } from "./wizard-reducer";

export default function CreateBoardForm() {
  const [state, dispatch] = useReducer(wizardReducer, initialState);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestPatRef = useRef("");
  const lastFetchedPat = useRef("");

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
      const data = (await res.json()) as { login?: string; avatarUrl?: string; warning?: string; error?: string };
      if (latestPatRef.current !== token) return;
      if (res.ok && data.login) {
        dispatch({
          type: "VALIDATE_PAT_SUCCESS",
          login: data.login,
          avatarUrl: data.avatarUrl,
          warnings: data.warning ? [data.warning] : undefined,
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
        body: JSON.stringify({ pat }),
      });
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
        body: JSON.stringify({ pat, repos: repos.map((r) => ({ owner: r.owner, name: r.name })) }),
      });
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

  async function handleNext() {
    if (state.step !== 1) return;
    if (!state.name.trim()) {
      dispatch({ type: "SET_NAME_ERROR", error: "Board name is required" });
      return;
    }
    if (state.patValidation.status !== "valid") return;

    const pat = state.pat;
    dispatch({ type: "SET_CHECKING_NAME", checking: true });
    try {
      const res = await fetch("/api/boards/check-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: state.name.trim() }),
      });
      if (res.status === 409) {
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
        body: JSON.stringify({ pat: state.pat, owner, name: repoName }),
      });
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
      const res = await fetch("/api/boards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: state.name.trim(),
          pat: state.pat,
          repos: state.selectedRepos.map((r) => ({ owner: r.owner, name: r.name })),
          contributors: state.selectedContributors.map((c) => ({
            githubId: c.id,
            githubLogin: c.login,
            avatarUrl: c.avatarUrl,
          })),
        }),
      });
      const data = (await res.json()) as { id?: string; error?: string };
      if (!res.ok) {
        dispatch({ type: "SUBMIT_ERROR", message: data.error ?? "Something went wrong. Please try again." });
        return;
      }
      window.location.href = `/boards/${data.id}`;
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
            className={`size-2 rounded-full transition-colors ${state.step === n ? "bg-purple-400" : "bg-white/20"}`}
          />
        ))}
        <span className="ml-2 text-xs text-blue-100/50">Step {state.step} of 3</span>
      </div>

      <Card className="border-white/10 bg-white/5">
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
                  <p className="mt-1 text-xs text-blue-100/50">
                    Requires a{" "}
                    <a
                      href="https://github.com/settings/tokens/new?scopes=repo,read:org&description=GitGud"
                      target="_blank"
                      rel="noreferrer"
                      className="underline hover:text-blue-100/80"
                    >
                      classic PAT
                    </a>{" "}
                    with <code className="text-blue-100/70">repo</code> and{" "}
                    <code className="text-blue-100/70">read:org</code> scopes.
                  </p>
                }
              />

              {state.patValidation.status === "validating" && (
                <div className="flex items-center gap-2 text-sm text-blue-100/60">
                  <Loader2 className="size-4 animate-spin" />
                  Validating token…
                </div>
              )}
              {state.patValidation.status === "valid" && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm text-green-400">
                    <CheckCircle2 className="size-4" />
                    Connected as <span className="font-semibold">@{state.patValidation.login}</span>
                  </div>
                  {state.patValidation.warnings?.map((warning) => (
                    <div
                      key={warning}
                      className="flex items-start gap-2 rounded-md bg-yellow-500/10 p-3 text-sm text-yellow-300"
                    >
                      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                      {warning}
                    </div>
                  ))}
                </div>
              )}
              {state.patValidation.status === "error" && (
                <p className="text-sm text-red-300">{state.patValidation.message}</p>
              )}

              <Button
                type="button"
                onClick={() => void handleNext()}
                disabled={state.checkingName || state.patValidation.status !== "valid"}
                className="w-full rounded-lg bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-500 disabled:opacity-50"
              >
                {state.checkingName ? (
                  <span className="flex items-center gap-2">
                    <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
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
                    <Skeleton key={i} className="h-10 w-full bg-white/10" />
                  ))}
                </div>
              )}

              {/* Repo fetch error */}
              {!state.reposLoading && state.reposError && (
                <div className="rounded-md bg-red-500/10 p-3">
                  <p className="text-sm text-red-300">{state.reposError}</p>
                  <button
                    type="button"
                    onClick={() => void fetchRepos(state.pat)}
                    className="mt-1 text-xs text-blue-100/60 underline hover:text-blue-100/80"
                  >
                    Retry
                  </button>
                </div>
              )}

              {/* Repo picker */}
              {!state.reposLoading && !state.reposError && state.repos.length > 0 && (
                <>
                  <div className="relative">
                    <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-blue-100/40" />
                    <Input
                      placeholder="Filter repositories..."
                      value={state.repoFilter}
                      onChange={(e) => {
                        dispatch({ type: "SET_REPO_FILTER", filter: e.target.value });
                      }}
                      className="border-white/10 bg-white/5 pl-9 text-white placeholder:text-blue-100/40 focus-visible:ring-purple-500"
                    />
                  </div>

                  <div className="max-h-60 space-y-0.5 overflow-y-auto rounded-lg border border-white/10 p-1">
                    {filteredRepos.length === 0 ? (
                      <p className="px-3 py-2 text-sm text-blue-100/50">No repositories match your filter.</p>
                    ) : (
                      filteredRepos.map((repo) => {
                        const isSelected = state.selectedRepos.some((r) => r.fullName === repo.fullName);
                        return (
                          <label
                            key={repo.fullName}
                            className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 hover:bg-white/5"
                          >
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => {
                                dispatch({ type: "TOGGLE_REPO_SELECTION", repo });
                              }}
                            />
                            <span className="flex-1 truncate text-sm text-white">{repo.fullName}</span>
                            <div className="flex shrink-0 gap-1">
                              {repo.private && (
                                <Badge variant="outline" className="border-white/20 text-xs text-blue-100/50">
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
                    <p className="text-xs text-blue-100/50">
                      {state.selectedRepos.length} repo{state.selectedRepos.length !== 1 ? "s" : ""} selected
                    </p>
                  )}
                </>
              )}

              {/* Manual repo entry */}
              <div className="space-y-2">
                <p className="text-xs text-blue-100/60">Add a public repo manually:</p>
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
                    className="flex-1 border-white/10 bg-white/5 text-white placeholder:text-blue-100/40 focus-visible:ring-purple-500"
                  />
                  <Button
                    type="button"
                    onClick={() => void handleAddManual()}
                    disabled={!state.manualEntry.trim() || state.manualEntryLoading}
                    variant="outline"
                    className="border-white/20 bg-white/5 text-white hover:bg-white/10"
                  >
                    {state.manualEntryLoading ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Plus className="size-4" />
                    )}
                  </Button>
                </div>
                {state.manualEntryError && <p className="text-sm text-red-300">{state.manualEntryError}</p>}
              </div>

              {state.apiError && <p className="rounded-md bg-red-500/10 p-3 text-sm text-red-300">{state.apiError}</p>}

              <div className="flex gap-2">
                <Button
                  type="button"
                  onClick={handleBack}
                  variant="outline"
                  className="flex-1 rounded-lg border-white/20 bg-white/5 text-white hover:bg-white/10"
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
                  className="flex-1 rounded-lg bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-500 disabled:opacity-50"
                >
                  <span className="flex items-center gap-2">
                    Next
                    <ArrowRight className="size-4" />
                  </span>
                </Button>
              </div>
              <p className="text-sm text-blue-100/60">
                {"You'll be the "}
                <span className="font-semibold text-white">Supervisor</span> of this board.
              </p>
            </div>
          )}

          {state.step === 3 && (
            <div className="space-y-4">
              {/* Collaborator loading skeletons */}
              {state.collaboratorsLoading && (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-10 w-full bg-white/10" />
                  ))}
                </div>
              )}

              {/* Collaborator fetch error */}
              {!state.collaboratorsLoading && state.collaboratorsError && (
                <div className="rounded-md bg-red-500/10 p-3">
                  <p className="text-sm text-red-300">{state.collaboratorsError}</p>
                  <button
                    type="button"
                    onClick={() => void fetchCollaborators(state.pat, state.selectedRepos)}
                    className="mt-1 text-xs text-blue-100/60 underline hover:text-blue-100/80"
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
                        <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-blue-100/40" />
                        <Input
                          placeholder="Filter contributors..."
                          value={state.contributorFilter}
                          onChange={(e) => {
                            dispatch({ type: "SET_CONTRIBUTOR_FILTER", filter: e.target.value });
                          }}
                          className="border-white/10 bg-white/5 pl-9 text-white placeholder:text-blue-100/40 focus-visible:ring-purple-500"
                        />
                      </div>

                      <div className="max-h-60 space-y-0.5 overflow-y-auto rounded-lg border border-white/10 p-1">
                        {filteredCollaborators.length === 0 ? (
                          <p className="px-3 py-2 text-sm text-blue-100/50">No contributors match your filter.</p>
                        ) : (
                          filteredCollaborators.map((collab) => {
                            const isSelected = state.selectedContributors.some((c) => c.id === collab.id);
                            return (
                              <label
                                key={collab.id}
                                className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 hover:bg-white/5"
                              >
                                <Checkbox
                                  checked={isSelected}
                                  onCheckedChange={() => {
                                    dispatch({ type: "TOGGLE_CONTRIBUTOR_SELECTION", contributor: collab });
                                  }}
                                />
                                <img
                                  src={collab.avatarUrl}
                                  alt={collab.login}
                                  className="size-8 rounded-full"
                                  width={32}
                                  height={32}
                                />
                                <span className="flex-1 truncate text-sm text-white">@{collab.login}</span>
                                <span className="shrink-0 text-xs text-blue-100/40">{collab.type}</span>
                              </label>
                            );
                          })
                        )}
                      </div>

                      {state.selectedContributors.length > 0 && (
                        <p className="text-xs text-blue-100/50">
                          {state.selectedContributors.length} contributor
                          {state.selectedContributors.length !== 1 ? "s" : ""} selected
                        </p>
                      )}
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-2 py-6 text-blue-100/50">
                      <Users className="size-8" />
                      <p className="text-sm">No collaborators found for the selected repositories.</p>
                    </div>
                  )}
                </>
              )}

              {state.apiError && <p className="rounded-md bg-red-500/10 p-3 text-sm text-red-300">{state.apiError}</p>}

              <div className="flex gap-2">
                <Button
                  type="button"
                  onClick={handleBackToStep2}
                  variant="outline"
                  className="flex-1 rounded-lg border-white/20 bg-white/5 text-white hover:bg-white/10"
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
                  className="flex-1 rounded-lg bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-500 disabled:opacity-50"
                >
                  {state.submitting ? (
                    <span className="flex items-center gap-2">
                      <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
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
