import React, { useState, useRef } from "react";
import {
  Layout as LayoutIcon,
  ArrowRight,
  ArrowLeft,
  KeyRound,
  CheckCircle2,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { PasswordToggle } from "@/components/auth/PasswordToggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type PatStatus = "idle" | "validating" | "valid" | "error" | "warning";

interface PatValidation {
  status: PatStatus;
  login?: string;
  avatarUrl?: string;
  message?: string;
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
        status: "warning",
        message: "Fine-grained tokens have limited org access. Use a classic PAT for best compatibility.",
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
  }

  function handleBack() {
    setApiError(undefined);
    setStep(1);
  }

  async function handleCreate() {
    setApiError(undefined);
    setSubmitting(true);
    try {
      const res = await fetch("/api/boards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
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
              <p className="text-sm text-blue-100/60">
                {"You'll be the "}
                <span className="font-semibold text-white">Supervisor (EM)</span> of this board.
              </p>

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
              <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-blue-100/60">
                <p className="font-medium text-white">GitHub Repository</p>
                <p className="mt-1">Repository selection coming in the next step.</p>
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
                  disabled={submitting}
                  className="flex-1 rounded-lg bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-500"
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
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
