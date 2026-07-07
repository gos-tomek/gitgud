import { useState, useRef } from "react";
import { Pencil, Check, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface BoardNameEditorProps {
  boardId: string;
  currentName: string;
}

export default function BoardNameEditor({ boardId, currentName }: BoardNameEditorProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(currentName);
  const [displayName, setDisplayName] = useState(currentName);
  const [checking, setChecking] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function startEdit() {
    setName(displayName);
    setNameError(null);
    setSaveError(null);
    setEditing(true);
  }

  function cancelEdit() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setChecking(false);
    setEditing(false);
    setNameError(null);
    setSaveError(null);
  }

  function handleNameChange(value: string) {
    setName(value);
    setNameError(null);
    setSaveError(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = value.trim();
    if (!trimmed || trimmed === displayName) {
      setChecking(false);
      return;
    }
    setChecking(true);
    debounceRef.current = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch("/api/board/check-name", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: trimmed, boardId }),
          });
          if (res.status === 409) {
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- workers-types vs DOM `Response.json()` type disagreement; tsc resolves to `unknown` (assertion required), ESLint's incremental resolver disagrees (false positive)
            const data = (await res.json()) as { error?: string };
            setNameError(data.error ?? "You already have a board with that name");
          }
        } catch {
          // network error — surface on save
        } finally {
          setChecking(false);
        }
      })();
    }, 500);
  }

  async function handleSave() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setChecking(false);
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError("Board name is required");
      return;
    }
    if (nameError) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/board/${boardId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (res.status === 409) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- workers-types vs DOM `Response.json()` type disagreement; tsc resolves to `unknown` (assertion required), ESLint's incremental resolver disagrees (false positive)
        const data = (await res.json()) as { error?: string };
        setNameError(data.error ?? "You already have a board with that name");
        return;
      }
      if (!res.ok) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- workers-types vs DOM `Response.json()` type disagreement; tsc resolves to `unknown` (assertion required), ESLint's incremental resolver disagrees (false positive)
        const data = (await res.json()) as { error?: string };
        setSaveError(data.error ?? "Failed to rename board. Please try again.");
        return;
      }
      setDisplayName(trimmed);
      setEditing(false);
    } catch {
      setSaveError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-1.5">
      {editing ? (
        <div className="space-y-1.5">
          <div className="flex gap-2">
            <Input
              value={name}
              onChange={(e) => {
                handleNameChange(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSave();
                if (e.key === "Escape") cancelEdit();
              }}
              className={cn(
                "border-border bg-background text-foreground focus-visible:ring-primary flex-1",
                nameError && "border-red-400 focus-visible:ring-red-400",
              )}
              autoFocus
              disabled={saving}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleSave()}
              disabled={saving || checking || !!nameError}
              className="border-border bg-card text-foreground hover:bg-accent"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={cancelEdit} disabled={saving}>
              <X className="size-4" />
            </Button>
          </div>
          {checking && (
            <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <Loader2 className="size-3 animate-spin" />
              Checking name…
            </div>
          )}
          {nameError && <p className="text-xs text-red-500">{nameError}</p>}
          {saveError && <p className="text-xs text-red-500">{saveError}</p>}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-foreground font-medium">{displayName}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={startEdit}
            className="text-muted-foreground hover:text-foreground h-6 px-2"
          >
            <Pencil className="size-3.5" />
            <span className="ml-1 text-xs">Edit</span>
          </Button>
        </div>
      )}
    </div>
  );
}
