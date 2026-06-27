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

const TERMINAL_STATUSES = new Set(["complete", "errored", "terminated"]);
const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 120_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function SyncIndicator({ lastSyncedAt, boardId, onSyncComplete }: Props) {
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // POST dispatches the Workflow and returns immediately — the actual sync+classify run happens
  // asynchronously, so we poll the instance's status until it reaches a terminal state before
  // refreshing the dashboard. Without this, onSyncComplete() would fire before the Workflow's
  // `update-last-synced` step lands, refetching stale data.
  // Returns whether the sync reached "complete" — callers must not refresh the dashboard on
  // false, since that would show stale data as if the sync had succeeded.
  async function pollUntilDone(instanceId: string, initialStatus: string): Promise<boolean> {
    let status = initialStatus;
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (!TERMINAL_STATUSES.has(status) && Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const res = await fetch(`/api/github/sync/status?boardId=${boardId}&instanceId=${instanceId}`);
      if (!res.ok) break;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- workers-types vs DOM `Response.json()` type disagreement; tsc resolves to `unknown` (assertion required), ESLint's incremental resolver disagrees (false positive)
      const body = (await res.json()) as { status?: string };
      if (!body.status) break;
      status = body.status;
    }
    if (status === "complete") return true;
    setError(status === "running" ? "Sync timed out" : "Sync failed");
    return false;
  }

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
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- workers-types vs DOM `Response.json()` type disagreement; tsc resolves to `unknown` (assertion required), ESLint's incremental resolver disagrees (false positive)
      const { instanceId, status } = (await res.json()) as { instanceId: string; status: string };
      const completed = await pollUntilDone(instanceId, status);
      if (completed) onSyncComplete();
    } catch {
      setError("Network error");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="text-muted-foreground flex items-center gap-2 text-sm">
      <span>{lastSyncedAt ? `Synced ${formatRelativeTime(lastSyncedAt)}` : "Never synced"}</span>
      {error && <span className="text-xs text-red-500">{error}</span>}
      <Button
        variant="ghost"
        size="icon"
        onClick={triggerSync}
        disabled={syncing}
        className="text-muted-foreground hover:bg-accent hover:text-foreground h-7 w-7"
        title="Refresh data"
      >
        <RefreshCw className={cn("size-3.5", syncing && "animate-spin")} />
      </Button>
    </div>
  );
}
