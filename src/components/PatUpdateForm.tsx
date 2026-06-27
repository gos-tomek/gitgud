import { useState } from "react";
import { KeyRound, CheckCircle2, AlertTriangle, Loader2, CalendarClock } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { PasswordToggle } from "@/components/auth/PasswordToggle";
import { Button } from "@/components/ui/button";

interface PatUpdateFormProps {
  hasToken: boolean;
  currentLogin: string | null;
  currentExpiresAt: string | null;
}

type Status = "idle" | "submitting" | "success" | "error";

const EXPIRY_WARNING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function expiryBadgeClass(expiresAt: string): string {
  const msUntilExpiry = new Date(expiresAt).getTime() - Date.now();
  if (msUntilExpiry <= EXPIRY_WARNING_WINDOW_MS) return "bg-red-500/15 text-red-500";
  return "bg-muted text-foreground";
}

export default function PatUpdateForm({ hasToken, currentLogin, currentExpiresAt }: PatUpdateFormProps) {
  const [pat, setPat] = useState("");
  const [patVisible, setPatVisible] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [tokenSaved, setTokenSaved] = useState(hasToken);
  const [login, setLogin] = useState(currentLogin);
  const [expiresAt, setExpiresAt] = useState(currentExpiresAt);

  async function handleSubmit() {
    const trimmed = pat.trim();
    if (!trimmed) return;

    setStatus("submitting");
    setMessage(null);
    try {
      const res = await fetch("/api/profile/pat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pat: trimmed }),
      });
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- workers-types vs DOM `Response.json()` type disagreement; tsc resolves to `unknown` (assertion required), ESLint's incremental resolver disagrees (false positive)
      const data = (await res.json()) as { login?: string; expiresAt?: string | null; error?: string };
      if (!res.ok || !data.login) {
        setStatus("error");
        setMessage(data.error ?? "Token is invalid or expired");
        return;
      }
      setTokenSaved(true);
      setLogin(data.login);
      setExpiresAt(data.expiresAt ?? null);
      setPat("");
      setStatus("success");
    } catch {
      setStatus("error");
      setMessage("Network error — failed to save token");
    }
  }

  return (
    <div className="space-y-3">
      {tokenSaved ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="flex items-center gap-2 text-green-600">
            <CheckCircle2 className="size-4" />
            {login ? (
              <>
                Connected as <span className="font-semibold">@{login}</span>
              </>
            ) : (
              "Token configured"
            )}
          </span>
          <span
            className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${expiresAt ? expiryBadgeClass(expiresAt) : "bg-muted text-muted-foreground"}`}
          >
            <CalendarClock className="size-3" />
            {expiresAt ? `Expires ${new Date(expiresAt).toLocaleDateString()}` : "No expiration"}
          </span>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm italic">No token configured</p>
      )}

      <FormField
        id="pat-update"
        label="Update GitHub Personal Access Token"
        type={patVisible ? "text" : "password"}
        value={pat}
        onChange={(value) => {
          setPat(value);
          setStatus("idle");
          setMessage(null);
        }}
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
            with <code className="text-foreground">repo</code> and <code className="text-foreground">read:org</code>{" "}
            scopes.
          </p>
        }
      />

      {status === "error" && message && (
        <p className="flex items-center gap-2 text-sm text-red-500">
          <AlertTriangle className="size-4" />
          {message}
        </p>
      )}
      {status === "success" && <p className="text-sm text-green-600">Token updated successfully.</p>}

      <Button
        type="button"
        onClick={() => void handleSubmit()}
        disabled={!pat.trim() || status === "submitting"}
        className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg px-4 py-2 font-medium transition-colors disabled:opacity-50"
      >
        {status === "submitting" ? (
          <span className="flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" />
            Validating...
          </span>
        ) : (
          "Save token"
        )}
      </Button>
    </div>
  );
}
