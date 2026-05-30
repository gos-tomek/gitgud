import React, { useState } from "react";
import { flushSync } from "react-dom";
import { Layout as LayoutIcon } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { ServerError } from "@/components/auth/ServerError";
import { Button } from "@/components/ui/button";

interface Props {
  serverError?: string | null;
}

export default function CreateBoardForm({ serverError }: Props) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    if (!name.trim()) {
      e.preventDefault();
      setError("Board name is required");
      return;
    }
    flushSync(() => {
      setSubmitting(true);
    });
  }

  return (
    <form method="POST" action="/api/boards" className="space-y-4" onSubmit={handleSubmit} noValidate>
      <FormField
        id="name"
        label="Board name"
        value={name}
        onChange={(v) => {
          setName(v);
          if (error) setError(undefined);
        }}
        placeholder="e.g. Platform Team"
        error={error}
        icon={<LayoutIcon className="size-4" />}
      />

      <p className="text-sm text-blue-100/60">
        {"You'll be the "}
        <span className="font-semibold text-white">Supervisor (EM)</span> of this board.
      </p>

      <ServerError message={serverError} />

      <Button
        type="submit"
        disabled={submitting}
        className="w-full rounded-lg bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-500"
      >
        {submitting ? (
          <span className="flex items-center gap-2">
            <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            Creating...
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <LayoutIcon className="size-4" />
            Create board
          </span>
        )}
      </Button>
    </form>
  );
}
