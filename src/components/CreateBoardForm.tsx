import React, { useState, useRef } from "react";
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
} from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { PasswordToggle } from "@/components/auth/PasswordToggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";

type PatStatus = "idle" | "validating" | "valid" | "error" | "warning";

interface PatValidation {
  status: PatStatus;
  login?: string;
  avatarUrl?: string;
  message?: string;
}

interface RepoItem {
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  pushAccess: boolean;
}

export default function CreateBoardForm() {
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | undefined>();
  const [apiError, setApiError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [checkingName, setCheckingName] = useState(false);

  // PAT state
  const [pat, setPat] = useState("");
  const [patVisible, setPatVisible] = useState(false);
  const [patValidation, setPatValidation] = useState<PatValidation>({ status: "idle" });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Repo picker state
  const [repos, setRepos] = useState<RepoItem[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [reposError, setReposError] = useState<string | undefined>();
  const [repoFilter, setRepoFilter] = useState("");
  const [selectedRepos, setSelectedRepos] = useState<RepoItem[]>([]);
  const lastFetchedPat = useRef<string>("");

  // Manual entry state
  const [manualEntry, setManualEntry] = useState("");
  const [manualEntryLoading, setManualEntryLoading] = useState(false);
  const [manualEntryError, setManualEntryError] = useState<string | undefined>();

  const filteredRepos = repos.filter((r) => r.fullName.toLowerCase().includes(repoFilter.toLowerCase()));

  async function validatePat(token: string) {
    try {
      const res = await fetch("/api/github/validate-pat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pat: token }),
      });
      const data = (await res.json()) as { login?: string; avatarUrl?: string; warning?: string; error?: string };
      if (res.ok && data.login) {
        setPatValidation({
          status: "valid",
          login: data.login,
          avatarUrl: data.avatarUrl,
          message: data.warning,
        });
      } else {
        setPatValidation({ status: "error", message: data.error ?? "Token is invalid or expired" });
      }
    } catch {
      setPatValidation({ status: "error", message: "Could not validate token — network error" });
    }
  }

  function handlePatChange(value: string) {
    setPat(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!value.trim()) {
      setPatValidation({ status: "idle" });
      return;
    }

    if (value.trim().startsWith("github_pat_")) {
      setPatValidation({
        status: "error",
        message: "Fine-grained tokens are not supported. Please use a classic PAT (starts with ghp_).",
      });
      return;
    }

    setPatValidation({ status: "validating" });
    debounceRef.current = setTimeout(() => {
      void validatePat(value.trim());
    }, 500);
  }

  function validateName(): boolean {
    if (!name.trim()) {
      setNameError("Board name is required");
      return false;
    }
    return !nameError;
  }

  async function fetchRepos() {
    setReposLoading(true);
    setReposError(undefined);
    try {
      const res = await fetch("/api/github/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pat }),
      });
      const data = (await res.json()) as { repos?: RepoItem[]; error?: string };
      if (res.ok && data.repos) {
        setRepos(data.repos);
        lastFetchedPat.current = pat;
      } else {
        setReposError(data.error ?? "Failed to load repositories");
      }
    } catch {
      setReposError("Network error — failed to load repositories");
    } finally {
      setReposLoading(false);
    }
  }

  async function handleNext() {
    if (!validateName()) return;
    if (patValidation.status !== "valid") return;
    setCheckingName(true);
    try {
      const res = await fetch("/api/boards/check-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (res.status === 409) {
        const data = (await res.json()) as { error?: string };
        setNameError(data.error ?? "You already have a board with that name");
        return;
      }
    } catch {
      // network error — let the final submit surface it
    } finally {
      setCheckingName(false);
    }
    setApiError(undefined);
    setStep(2);

    if (lastFetchedPat.current !== pat) {
      setSelectedRepos([]);
      void fetchRepos();
    } else if (repos.length === 0) {
      void fetchRepos();
    }
  }

  function handleBack() {
    setApiError(undefined);
    setStep(1);
  }

  async function handleAddManual() {
    const trimmed = manualEntry.trim();
    if (!trimmed) return;

    const slashIndex = trimmed.indexOf("/");
    if (slashIndex < 1 || slashIndex === trimmed.length - 1) {
      setManualEntryError("Enter in owner/name format (e.g. facebook/react)");
      return;
    }

    const owner = trimmed.slice(0, slashIndex);
    const repoName = trimmed.slice(slashIndex + 1);
    const fullName = `${owner}/${repoName}`;

    if (selectedRepos.some((r) => r.fullName.toLowerCase() === fullName.toLowerCase())) {
      setManualEntryError("Repository already added");
      return;
    }

    setManualEntryLoading(true);
    setManualEntryError(undefined);
    try {
      const res = await fetch("/api/github/validate-repo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pat, owner, name: repoName }),
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
        // Merge into picker list so the repo appears with its checkbox checked
        setRepos((prev) => {
          const exists = prev.some((r) => r.fullName.toLowerCase() === newRepo.fullName.toLowerCase());
          return exists ? prev : [...prev, newRepo];
        });
        setSelectedRepos((prev) => {
          const exists = prev.some((r) => r.fullName.toLowerCase() === newRepo.fullName.toLowerCase());
          return exists ? prev : [...prev, newRepo];
        });
        setManualEntry("");
      } else {
        setManualEntryError((data as { error?: string }).error ?? "Repository not found or not accessible");
      }
    } catch {
      setManualEntryError("Network error — could not validate repository");
    } finally {
      setManualEntryLoading(false);
    }
  }

  async function handleCreate() {
    setApiError(undefined);
    setSubmitting(true);
    try {
      const res = await fetch("/api/boards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          pat,
          repos: selectedRepos.map((r) => ({ owner: r.owner, name: r.name })),
        }),
      });
      const data = (await res.json()) as { id?: string; error?: string };
      if (!res.ok) {
        setApiError(data.error ?? "Something went wrong. Please try again.");
        return;
      }
      window.location.href = `/boards/${data.id}`;
    } catch {
      setApiError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const nextDisabled = checkingName || patValidation.status !== "valid";

  return (
    <div className="space-y-4">
      {/* Step indicator */}
      <div className="flex items-center justify-center gap-2">
        {[1, 2].map((n) => (
          <div
            key={n}
            className={`size-2 rounded-full transition-colors ${step === n ? "bg-purple-400" : "bg-white/20"}`}
          />
        ))}
        <span className="ml-2 text-xs text-blue-100/50">Step {step} of 2</span>
      </div>

      <Card className="border-white/10 bg-white/5">
        <CardContent className="pt-6">
          {step === 1 && (
            <div className="space-y-4">
              <FormField
                id="name"
                label="Board name"
                value={name}
                onChange={(v) => {
                  setName(v);
                  if (nameError) setNameError(undefined);
                }}
                placeholder="e.g. Platform Team"
                error={nameError}
                icon={<LayoutIcon className="size-4" />}
              />

              <FormField
                id="pat"
                label="GitHub Personal Access Token"
                type={patVisible ? "text" : "password"}
                value={pat}
                onChange={handlePatChange}
                placeholder="ghp_..."
                icon={<KeyRound className="size-4" />}
                endContent={
                  <PasswordToggle
                    visible={patVisible}
                    onToggle={() => {
                      setPatVisible((v) => !v);
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

              {patValidation.status === "validating" && (
                <div className="flex items-center gap-2 text-sm text-blue-100/60">
                  <Loader2 className="size-4 animate-spin" />
                  Validating token…
                </div>
              )}
              {patValidation.status === "valid" && (
                <div className="flex items-center gap-2 text-sm text-green-400">
                  <CheckCircle2 className="size-4" />
                  Connected as <span className="font-semibold">@{patValidation.login}</span>
                  {patValidation.message && <span className="ml-1 text-yellow-400/80">({patValidation.message})</span>}
                </div>
              )}
              {patValidation.status === "error" && <p className="text-sm text-red-300">{patValidation.message}</p>}
              {patValidation.status === "warning" && (
                <div className="flex items-start gap-2 rounded-md bg-yellow-500/10 p-3 text-sm text-yellow-300">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  {patValidation.message}
                </div>
              )}

              <Button
                type="button"
                onClick={handleNext}
                disabled={nextDisabled}
                className="w-full rounded-lg bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-500 disabled:opacity-50"
              >
                {checkingName ? (
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

          {step === 2 && (
            <div className="space-y-4">
              {/* Repo loading skeletons */}
              {reposLoading && (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-10 w-full bg-white/10" />
                  ))}
                </div>
              )}

              {/* Repo fetch error */}
              {!reposLoading && reposError && (
                <div className="rounded-md bg-red-500/10 p-3">
                  <p className="text-sm text-red-300">{reposError}</p>
                  <button
                    type="button"
                    onClick={() => void fetchRepos()}
                    className="mt-1 text-xs text-blue-100/60 underline hover:text-blue-100/80"
                  >
                    Retry
                  </button>
                </div>
              )}

              {/* Repo picker */}
              {!reposLoading && !reposError && repos.length > 0 && (
                <>
                  <div className="relative">
                    <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-blue-100/40" />
                    <Input
                      placeholder="Filter repositories..."
                      value={repoFilter}
                      onChange={(e) => {
                        setRepoFilter(e.target.value);
                      }}
                      className="border-white/10 bg-white/5 pl-9 text-white placeholder:text-blue-100/40 focus-visible:ring-purple-500"
                    />
                  </div>

                  <div className="max-h-60 space-y-0.5 overflow-y-auto rounded-lg border border-white/10 p-1">
                    {filteredRepos.length === 0 ? (
                      <p className="px-3 py-2 text-sm text-blue-100/50">No repositories match your filter.</p>
                    ) : (
                      filteredRepos.map((repo) => {
                        const isSelected = selectedRepos.some((r) => r.fullName === repo.fullName);
                        return (
                          <label
                            key={repo.fullName}
                            className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 hover:bg-white/5"
                          >
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  setSelectedRepos((prev) => [...prev, repo]);
                                } else {
                                  setSelectedRepos((prev) => prev.filter((r) => r.fullName !== repo.fullName));
                                }
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

                  {selectedRepos.length > 0 && (
                    <p className="text-xs text-blue-100/50">
                      {selectedRepos.length} repo{selectedRepos.length !== 1 ? "s" : ""} selected
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
                    value={manualEntry}
                    onChange={(e) => {
                      setManualEntry(e.target.value);
                      if (manualEntryError) setManualEntryError(undefined);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleAddManual();
                    }}
                    className="flex-1 border-white/10 bg-white/5 text-white placeholder:text-blue-100/40 focus-visible:ring-purple-500"
                  />
                  <Button
                    type="button"
                    onClick={() => void handleAddManual()}
                    disabled={!manualEntry.trim() || manualEntryLoading}
                    variant="outline"
                    className="border-white/20 bg-white/5 text-white hover:bg-white/10"
                  >
                    {manualEntryLoading ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  </Button>
                </div>
                {manualEntryError && <p className="text-sm text-red-300">{manualEntryError}</p>}
              </div>

              {apiError && <p className="rounded-md bg-red-500/10 p-3 text-sm text-red-300">{apiError}</p>}

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
                  onClick={handleCreate}
                  disabled={submitting || selectedRepos.length === 0}
                  className="flex-1 rounded-lg bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-500 disabled:opacity-50"
                >
                  {submitting ? (
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
              <p className="text-sm text-blue-100/60">
                {"You'll be the "}
                <span className="font-semibold text-white">Supervisor</span> of this board.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
