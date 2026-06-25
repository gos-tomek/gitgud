import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const CONFIRM_PHRASE = "DELETE";

export default function DeleteAccountDialog() {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/profile", { method: "DELETE" });
      if (!res.ok) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- workers-types vs DOM `Response.json()` type disagreement; tsc resolves to `unknown` (assertion required), ESLint's incremental resolver disagrees (false positive)
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Failed to delete account. Please try again.");
        setSubmitting(false);
        return;
      }
      // The auth user is already gone server-side; this clears the now-stale session cookie.
      await fetch("/api/auth/signout", { method: "POST" });
      window.location.href = "/";
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
        className="border-red-500/40 bg-transparent text-red-300 hover:bg-red-900/30 hover:text-red-200"
      >
        Delete account
      </Button>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-red-200">
        This permanently deletes your account, all boards you own, and all associated data. This cannot be undone.
      </p>
      <div>
        <label htmlFor="confirm-delete" className="mb-1 block text-xs text-red-200/80">
          Type <span className="font-mono font-semibold">{CONFIRM_PHRASE}</span> to confirm
        </label>
        <input
          id="confirm-delete"
          value={confirmText}
          onChange={(e) => {
            setConfirmText(e.target.value);
          }}
          placeholder={CONFIRM_PHRASE}
          className="w-full rounded-lg border border-red-500/40 bg-black/30 px-3 py-2 text-white placeholder-white/30 focus:ring-2 focus:ring-red-400 focus:outline-none"
        />
      </div>
      {error && (
        <p className="flex items-center gap-2 text-sm text-red-300">
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
          className="border-white/20 bg-white/5 text-white hover:bg-white/10"
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={confirmText !== CONFIRM_PHRASE || submitting}
          onClick={() => void handleDelete()}
        >
          {submitting ? (
            <span className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" />
              Deleting...
            </span>
          ) : (
            "Permanently delete account"
          )}
        </Button>
      </div>
    </div>
  );
}
