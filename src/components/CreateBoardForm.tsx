import React, { useState } from "react";
import { Layout as LayoutIcon, ArrowRight, ArrowLeft } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function CreateBoardForm() {
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | undefined>();
  const [apiError, setApiError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [checkingName, setCheckingName] = useState(false);

  function validateName(): boolean {
    if (!name.trim()) {
      setNameError("Board name is required");
      return false;
    }
    return !nameError;
  }

  async function handleNext() {
    if (!validateName()) return;
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
              <Button
                type="button"
                onClick={handleNext}
                disabled={checkingName}
                className="w-full rounded-lg bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-500"
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
