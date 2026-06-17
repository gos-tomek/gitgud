import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface Props {
  lastSyncedAt: string | null;
  boardId: string;
  onSyncComplete: () => void;
}

export function SyncIndicator({ lastSyncedAt, boardId, onSyncComplete }: Props) {
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function triggerSync() {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/github/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boardId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Sync failed");
      } else {
        onSyncComplete();
      }
    } catch {
      setError("Network error");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="flex items-center gap-2 text-sm text-blue-100/50">
      <span>{lastSyncedAt ? `Synced ${formatRelativeTime(lastSyncedAt)}` : "Never synced"}</span>
      {error && <span className="text-xs text-red-400">{error}</span>}
      <Button
        variant="ghost"
        size="icon"
        onClick={triggerSync}
        disabled={syncing}
        className="h-7 w-7 text-blue-100/50 hover:bg-white/10 hover:text-white"
        title="Refresh data"
      >
        <RefreshCw className={cn("size-3.5", syncing && "animate-spin")} />
      </Button>
    </div>
  );
}
