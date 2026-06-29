import { useState } from "react";
import { Lock, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { PasswordToggle } from "@/components/auth/PasswordToggle";
import { Button } from "@/components/ui/button";

type Status = "idle" | "submitting" | "success" | "error";

export default function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);

  function resetStatus() {
    setStatus("idle");
    setMessage(null);
  }

  async function handleSubmit() {
    if (!currentPassword || !newPassword || !confirmPassword) return;
    if (newPassword !== confirmPassword) {
      setStatus("error");
      setMessage("New passwords do not match");
      return;
    }

    setStatus("submitting");
    setMessage(null);
    try {
      const res = await fetch("/api/profile/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- workers-types vs DOM `Response.json()` type disagreement; tsc resolves to `unknown` (assertion required), ESLint's incremental resolver disagrees (false positive)
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setStatus("error");
        setMessage(data.error ?? "Failed to update password");
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setStatus("success");
    } catch {
      setStatus("error");
      setMessage("Network error — failed to update password");
    }
  }

  return (
    <div className="space-y-3">
      <FormField
        id="current-password"
        label="Current password"
        type={visible ? "text" : "password"}
        value={currentPassword}
        onChange={(value) => {
          setCurrentPassword(value);
          resetStatus();
        }}
        icon={<Lock className="size-4" />}
      />
      <FormField
        id="new-password"
        label="New password"
        type={visible ? "text" : "password"}
        value={newPassword}
        onChange={(value) => {
          setNewPassword(value);
          resetStatus();
        }}
        icon={<Lock className="size-4" />}
        hint={<p className="text-muted-foreground mt-1 text-xs">At least 6 characters.</p>}
      />
      <FormField
        id="confirm-password"
        label="Confirm new password"
        type={visible ? "text" : "password"}
        value={confirmPassword}
        onChange={(value) => {
          setConfirmPassword(value);
          resetStatus();
        }}
        icon={<Lock className="size-4" />}
        endContent={
          <PasswordToggle
            visible={visible}
            onToggle={() => {
              setVisible((v) => !v);
            }}
          />
        }
      />

      {status === "error" && message && (
        <p className="flex items-center gap-2 text-sm text-red-500">
          <AlertTriangle className="size-4" />
          {message}
        </p>
      )}
      {status === "success" && (
        <p className="flex items-center gap-2 text-sm text-green-600">
          <CheckCircle2 className="size-4" />
          Password updated successfully.
        </p>
      )}

      <Button
        type="button"
        onClick={() => void handleSubmit()}
        disabled={!currentPassword || !newPassword || !confirmPassword || status === "submitting"}
        className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg px-4 py-2 font-medium transition-colors disabled:opacity-50"
      >
        {status === "submitting" ? (
          <span className="flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" />
            Updating...
          </span>
        ) : (
          "Update password"
        )}
      </Button>
    </div>
  );
}
