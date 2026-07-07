import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function DeleteBoardDialog({ boardId, boardName }: { boardId: string; boardName: string }) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/board/${boardId}`, { method: "DELETE" });
      if (!res.ok) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- workers-types vs DOM `Response.json()` type disagreement; tsc resolves to `unknown` (assertion required), ESLint's incremental resolver disagrees (false positive)
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Failed to delete board. Please try again.");
        setSubmitting(false);
        return;
      }
      window.location.href = "/dashboard";
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          setOpen(true);
        }}
        className="border-red-500/40 bg-transparent text-red-500 hover:bg-red-50 hover:text-red-600"
      >
        Delete board
      </Button>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-red-600">
        This permanently deletes the board and all associated data including repositories, pull requests, and reviews.
        This cannot be undone.
      </p>
      <div>
        <label htmlFor="confirm-delete-board" className="mb-1 block text-xs text-red-600/80">
          Type <span className="font-mono font-semibold">{boardName}</span> to confirm
        </label>
        <input
          id="confirm-delete-board"
          value={confirmText}
          onChange={(e) => {
            setConfirmText(e.target.value);
          }}
          placeholder={boardName}
          className="bg-background text-foreground placeholder:text-muted-foreground w-full rounded-lg border border-red-500/40 px-3 py-2 focus:ring-2 focus:ring-red-400 focus:outline-none"
        />
      </div>
      {error && (
        <p className="flex items-center gap-2 text-sm text-red-500">
          <AlertTriangle className="size-4" />
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setOpen(false);
            setConfirmText("");
            setError(null);
          }}
          className="border-border bg-card text-foreground hover:bg-accent"
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={confirmText !== boardName || submitting}
          onClick={() => void handleDelete()}
        >
          {submitting ? (
            <span className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" />
              Deleting...
            </span>
          ) : (
            "Permanently delete board"
          )}
        </Button>
      </div>
    </div>
  );
}
