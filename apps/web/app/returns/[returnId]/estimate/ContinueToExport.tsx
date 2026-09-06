"use client";

import { useState, useTransition } from "react";

import { Button } from "../../../../components/Button";
import { ArrowRightIcon } from "../../../../components/icons";
import { continueToExport } from "./actions";

/**
 * The primary "Continue to export" action. A Client Component because it needs a
 * pending state and to surface a save conflict inline — it calls the
 * `continueToExport` server action with plain values (no `FormData`), mirroring
 * the review screen's "Continue to questions" button.
 */
export function ContinueToExport({ returnId, revision }: { returnId: string; revision: number }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await continueToExport(returnId, revision);
      // On success the action redirects and this line is never reached.
      if (!result.ok) setError(result.error ?? "Something went wrong. Try again.");
    });
  }

  return (
    <div className="text-right">
      <Button variant="primary" onClick={handleClick} disabled={pending} aria-busy={pending}>
        {pending ? "Saving…" : "Continue to export"}
        <ArrowRightIcon className="size-3.5" aria-hidden="true" />
      </Button>
      {error ? (
        <p role="alert" className="mt-1.5 text-[11px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
