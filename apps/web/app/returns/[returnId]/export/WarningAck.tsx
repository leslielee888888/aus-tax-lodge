"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "../../../../components/Button";
import { acknowledgeExportWarnings } from "./actions";

/**
 * "Acknowledge" control for one FR-13 validation warning on the export screen
 * (PRD FR-14 c). Records the acknowledgement server-side (encrypted at rest),
 * then refreshes so the checks list and the download controls re-evaluate.
 */
export function WarningAck({
  returnId,
  warningId,
}: {
  readonly returnId: string;
  readonly warningId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await acknowledgeExportWarnings(returnId, [warningId]);
      if (!result.ok) {
        setError(result.error ?? "Could not record that. Try again.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="default"
        onClick={handleClick}
        disabled={pending}
        aria-busy={pending}
      >
        {pending ? "Saving…" : "Acknowledge"}
      </Button>
      {error ? (
        <span role="alert" className="text-[11px] text-danger">
          {error}
        </span>
      ) : null}
    </span>
  );
}
