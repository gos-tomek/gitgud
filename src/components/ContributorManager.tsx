import { useState } from "react";
import { Plus, Trash2, Loader2, Search, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import type { BoardContributor } from "@/types";

interface CollaboratorItem {
  login: string;
  id: number;
  avatarUrl: string;
  type: string;
}

interface Repo {
  repoOwner: string;
  repoName: string;
}

interface ContributorManagerProps {
  boardId: string;
  initialContributors: BoardContributor[];
  repos: Repo[];
}

export default function ContributorManager({ boardId, initialContributors, repos }: ContributorManagerProps) {
  const [contributors, setContributors] = useState<BoardContributor[]>(initialContributors);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [collaborators, setCollaborators] = useState<CollaboratorItem[]>([]);
  const [collaboratorsLoading, setCollaboratorsLoading] = useState(false);
  const [collaboratorsError, setCollaboratorsError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<{ githubId: number; githubLogin: string } | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const existingIds = new Set(contributors.map((c) => c.githubId));

  const filteredCollaborators = collaborators
    .filter((c) => !existingIds.has(c.id))
    .filter((c) => c.login.toLowerCase().includes(filter.toLowerCase()));

  async function fetchCollaborators() {
    setCollaboratorsLoading(true);
    setCollaboratorsError(null);
    setCollaborators([]);
    try {
      const res = await fetch("/api/github/collaborators", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repos: repos.map((r) => ({ owner: r.repoOwner, name: r.repoName })) }),
      });
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- workers-types vs DOM `Response.json()` type disagreement; tsc resolves to `unknown` (assertion required), ESLint's incremental resolver disagrees (false positive)
      const data = (await res.json()) as { collaborators?: CollaboratorItem[]; error?: string };
      if (res.ok && data.collaborators) {
        setCollaborators(data.collaborators);
      } else {
        setCollaboratorsError(data.error ?? "Failed to load collaborators");
      }
    } catch {
      setCollaboratorsError("Network error — failed to load collaborators");
    } finally {
      setCollaboratorsLoading(false);
    }
  }

  function openDialog() {
    setDialogOpen(true);
    setFilter("");
    setSelected(new Set());
    setSaveError(null);
    void fetchCollaborators();
  }

  function toggleSelect(collab: CollaboratorItem) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(collab.id)) next.delete(collab.id);
      else next.add(collab.id);
      return next;
    });
  }

  async function handleSave() {
    if (selected.size === 0) return;
    setSaving(true);
    setSaveError(null);
    const toAdd = collaborators.filter((c) => selected.has(c.id));
    try {
      const res = await fetch(`/api/board/${boardId}/contributors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contributors: toAdd.map((c) => ({
            githubId: c.id,
            githubLogin: c.login,
            avatarUrl: c.avatarUrl,
          })),
        }),
      });
      if (!res.ok) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- workers-types vs DOM `Response.json()` type disagreement; tsc resolves to `unknown` (assertion required), ESLint's incremental resolver disagrees (false positive)
        const data = (await res.json()) as { error?: string };
        setSaveError(data.error ?? "Failed to add contributors. Please try again.");
        return;
      }
      const now = new Date().toISOString();
      const newContributors: BoardContributor[] = toAdd.map((c) => ({
        boardId,
        githubId: c.id,
        githubLogin: c.login,
        avatarUrl: c.avatarUrl || null,
        addedAt: now,
      }));
      setContributors((prev) => [...prev, ...newContributors]);
      setDialogOpen(false);
    } catch {
      setSaveError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (!removeTarget) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      const res = await fetch(`/api/board/${boardId}/contributors`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ githubId: removeTarget.githubId }),
      });
      if (!res.ok) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- workers-types vs DOM `Response.json()` type disagreement; tsc resolves to `unknown` (assertion required), ESLint's incremental resolver disagrees (false positive)
        const data = (await res.json()) as { error?: string };
        setRemoveError(data.error ?? "Failed to remove contributor. Please try again.");
        return;
      }
      setContributors((prev) => prev.filter((c) => c.githubId !== removeTarget.githubId));
      setRemoveTarget(null);
    } catch {
      setRemoveError("Network error. Please try again.");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="space-y-3">
      {contributors.length === 0 ? (
        <p className="text-muted-foreground text-sm italic">No contributors yet</p>
      ) : (
        <ul className="space-y-1">
          {contributors.map((contributor) => (
            <li key={contributor.githubId} className="flex items-center gap-2">
              <a
                href={`/board/${boardId}/impact/${contributor.githubLogin}/90d`}
                className="hover:bg-muted flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 transition-colors"
              >
                {contributor.avatarUrl ? (
                  <img src={contributor.avatarUrl} alt={contributor.githubLogin} className="h-6 w-6 rounded-full" />
                ) : (
                  <div className="bg-muted h-6 w-6 rounded-full" />
                )}
                <span className="text-foreground font-mono text-sm">@{contributor.githubLogin}</span>
              </a>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setRemoveTarget({ githubId: contributor.githubId, githubLogin: contributor.githubLogin });
                  setRemoveError(null);
                }}
                disabled={contributors.length <= 1}
                className="border-border h-6 px-2 text-red-500 hover:border-red-300 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={openDialog}
        className="border-primary/30 bg-card text-primary hover:bg-primary/10 text-xs"
      >
        <Plus className="mr-1 size-3.5" />
        Add contributors
      </Button>

      {/* Add contributors dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open && !saving) setDialogOpen(false);
        }}
      >
        <DialogContent className="bg-card max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add contributors</DialogTitle>
            <DialogDescription>Select collaborators from the board{"'"}s linked repositories.</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {collaboratorsLoading && (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="bg-muted h-10 w-full" />
                ))}
              </div>
            )}

            {!collaboratorsLoading && collaboratorsError && (
              <div className="rounded-md bg-red-50 p-3">
                <p className="text-sm text-red-600">{collaboratorsError}</p>
                <button
                  type="button"
                  onClick={() => void fetchCollaborators()}
                  className="text-muted-foreground hover:text-foreground mt-1 text-xs underline"
                >
                  Retry
                </button>
              </div>
            )}

            {!collaboratorsLoading && !collaboratorsError && (
              <>
                {collaborators.filter((c) => !existingIds.has(c.id)).length === 0 ? (
                  <div className="text-muted-foreground flex flex-col items-center gap-2 py-6">
                    <Users className="size-8" />
                    <p className="text-sm">No new collaborators found for the linked repositories.</p>
                  </div>
                ) : (
                  <>
                    <div className="relative">
                      <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                      <Input
                        placeholder="Filter contributors..."
                        value={filter}
                        onChange={(e) => {
                          setFilter(e.target.value);
                        }}
                        className="border-border bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-primary pl-9"
                      />
                    </div>

                    <div className="border-border max-h-60 space-y-0.5 overflow-y-auto rounded-lg border p-1">
                      {filteredCollaborators.length === 0 ? (
                        <p className="text-muted-foreground px-3 py-2 text-sm">No contributors match your filter.</p>
                      ) : (
                        filteredCollaborators.map((collab) => {
                          const isSelected = selected.has(collab.id);
                          return (
                            <label
                              key={collab.id}
                              className="hover:bg-accent flex cursor-pointer items-center gap-3 rounded-md px-3 py-2"
                            >
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={() => {
                                  toggleSelect(collab);
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

                    {selected.size > 0 && (
                      <p className="text-muted-foreground text-xs">
                        {selected.size} contributor{selected.size !== 1 ? "s" : ""} selected
                      </p>
                    )}
                  </>
                )}
              </>
            )}

            {saveError && <p className="text-xs text-red-500">{saveError}</p>}
          </div>

          <DialogFooter>
            <Button
              type="button"
              onClick={() => void handleSave()}
              disabled={selected.size === 0 || saving}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" />
                  Saving…
                </span>
              ) : (
                `Add ${selected.size > 0 ? selected.size : ""} contributor${selected.size !== 1 ? "s" : ""}`.trim()
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove confirmation */}
      <AlertDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open && !removing) {
            setRemoveTarget(null);
            setRemoveError(null);
          }
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove contributor?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-1 text-sm">
                <p>
                  <strong className="text-foreground font-mono">@{removeTarget?.githubLogin}</strong> will no longer
                  have access to this board.
                </p>
                <p className="text-muted-foreground">
                  Their historical PR and review data will remain — you can re-add them at any time to restore access.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          {removeError && <p className="text-xs text-red-500">{removeError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <Button type="button" variant="destructive" onClick={() => void handleRemove()} disabled={removing}>
              {removing && <Loader2 className="mr-2 size-4 animate-spin" />}
              Remove
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
