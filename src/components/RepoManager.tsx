import { useState } from "react";
import { Plus, Trash2, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";

interface Repo {
  repoOwner: string;
  repoName: string;
}

interface RepoManagerProps {
  boardId: string;
  initialRepos: Repo[];
}

export default function RepoManager({ boardId, initialRepos }: RepoManagerProps) {
  const [repos, setRepos] = useState<Repo[]>(initialRepos);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addInput, setAddInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Repo | null>(null);
  const [confirmInput, setConfirmInput] = useState("");
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const confirmText = removeTarget ? `${removeTarget.repoOwner}/${removeTarget.repoName}` : "";

  function openRemoveDialog(repo: Repo) {
    setRemoveTarget(repo);
    setConfirmInput("");
    setRemoveError(null);
  }

  function closeRemoveDialog() {
    if (removing) return;
    setRemoveTarget(null);
    setConfirmInput("");
    setRemoveError(null);
  }

  async function handleRemove() {
    if (!removeTarget || confirmInput !== confirmText) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      const res = await fetch(`/api/board/${boardId}/repos`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner: removeTarget.repoOwner, name: removeTarget.repoName }),
      });
      if (!res.ok) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- workers-types vs DOM `Response.json()` type disagreement; tsc resolves to `unknown` (assertion required), ESLint's incremental resolver disagrees (false positive)
        const data = (await res.json()) as { error?: string };
        setRemoveError(data.error ?? "Failed to remove repository. Please try again.");
        return;
      }
      setRepos((prev) =>
        prev.filter((r) => !(r.repoOwner === removeTarget.repoOwner && r.repoName === removeTarget.repoName)),
      );
      setRemoveTarget(null);
    } catch {
      setRemoveError("Network error. Please try again.");
    } finally {
      setRemoving(false);
    }
  }

  async function handleAdd() {
    const trimmed = addInput.trim();
    if (!trimmed) return;
    const slash = trimmed.indexOf("/");
    if (slash < 1 || slash === trimmed.length - 1) {
      setAddError("Enter in owner/name format (e.g. facebook/react)");
      return;
    }
    const owner = trimmed.slice(0, slash);
    const name = trimmed.slice(slash + 1);
    if (
      repos.some(
        (r) => r.repoOwner.toLowerCase() === owner.toLowerCase() && r.repoName.toLowerCase() === name.toLowerCase(),
      )
    ) {
      setAddError("Repository already added");
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      // Validate repo exists on GitHub using the stored PAT
      const validateRes = await fetch("/api/github/validate-repo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner, name }),
      });
      if (!validateRes.ok) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- workers-types vs DOM `Response.json()` type disagreement; tsc resolves to `unknown` (assertion required), ESLint's incremental resolver disagrees (false positive)
        const data = (await validateRes.json()) as { error?: string };
        setAddError(data.error ?? "Repository not found or not accessible");
        return;
      }

      const res = await fetch(`/api/board/${boardId}/repos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner, name }),
      });
      if (res.status === 409) {
        setAddError("Repository is already linked to this board");
        return;
      }
      if (!res.ok) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- workers-types vs DOM `Response.json()` type disagreement; tsc resolves to `unknown` (assertion required), ESLint's incremental resolver disagrees (false positive)
        const data = (await res.json()) as { error?: string };
        setAddError(data.error ?? "Failed to add repository. Please try again.");
        return;
      }
      setRepos((prev) => [...prev, { repoOwner: owner, repoName: name }]);
      setAddInput("");
      setShowAddForm(false);
    } catch {
      setAddError("Network error. Please try again.");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="space-y-3">
      {repos.length === 0 ? (
        <p className="text-muted-foreground text-sm italic">No repositories linked</p>
      ) : (
        <ul className="space-y-1">
          {repos.map((repo) => (
            <li key={`${repo.repoOwner}/${repo.repoName}`} className="flex items-center justify-between gap-2">
              <span className="text-foreground font-mono text-sm">
                {repo.repoOwner}/{repo.repoName}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  openRemoveDialog(repo);
                }}
                disabled={repos.length <= 1}
                className="border-border h-6 px-2 text-red-500 hover:border-red-300 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {showAddForm ? (
        <div className="space-y-1.5">
          <div className="flex gap-2">
            <Input
              placeholder="owner/name (e.g. facebook/react)"
              value={addInput}
              onChange={(e) => {
                setAddInput(e.target.value);
                setAddError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleAdd();
                if (e.key === "Escape") {
                  setShowAddForm(false);
                  setAddInput("");
                  setAddError(null);
                }
              }}
              className="border-border bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-primary flex-1"
              autoFocus
              disabled={adding}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleAdd()}
              disabled={adding || !addInput.trim()}
              className="border-primary/30 bg-card text-primary hover:bg-primary/10"
            >
              {adding ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setShowAddForm(false);
                setAddInput("");
                setAddError(null);
              }}
              disabled={adding}
              className="border-border"
            >
              <X className="size-4" />
            </Button>
          </div>
          {addError && <p className="text-xs text-red-500">{addError}</p>}
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setShowAddForm(true);
          }}
          className="border-primary/30 bg-card text-primary hover:bg-primary/10 text-xs"
        >
          <Plus className="mr-1 size-3.5" />
          Add repository
        </Button>
      )}

      <AlertDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) closeRemoveDialog();
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove repository?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Removing <strong className="text-foreground font-mono">{confirmText}</strong> will permanently delete
                  all linked pull requests, reviews, and review comments from this board.
                </p>
                <p className="font-medium text-red-600">This action cannot be undone.</p>
                <p>
                  Type <strong className="font-mono">{confirmText}</strong> to confirm:
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={confirmInput}
            onChange={(e) => {
              setConfirmInput(e.target.value);
              setRemoveError(null);
            }}
            placeholder={confirmText}
            className="border-border bg-background font-mono text-sm"
            disabled={removing}
          />
          {removeError && <p className="text-xs text-red-500">{removeError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel onClick={closeRemoveDialog} disabled={removing}>
              Cancel
            </AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleRemove()}
              disabled={confirmInput !== confirmText || removing}
            >
              {removing && <Loader2 className="mr-2 size-4 animate-spin" />}
              Remove
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
