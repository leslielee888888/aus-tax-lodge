"use client";

import { useId, useState } from "react";

import { Badge } from "../../../../components/Badge";
import { Button } from "../../../../components/Button";
import { AlertTriangleIcon } from "../../../../components/icons";
import { Input } from "../../../../components/Input";
import type { InterestAccountRowData } from "../../../../lib/review/build-sections";
import {
  confirmInterestAccount,
  editInterestAccount,
  markInterestAccountNotApplicable,
  type ReviewActionResult,
} from "./actions";

export interface InterestAccountRowProps {
  readonly row: InterestAccountRowData;
  readonly returnId: string;
  readonly revision: number;
  readonly onResult: (result: ReviewActionResult) => void;
}

/**
 * A joint (or sole) interest account (PRD FR-4): the gross interest and the
 * ownership share are two separate fields under the hood, confirmed / edited
 * / marked nil together as one row (the design shows a single apportioned
 * figure).
 */
export function InterestAccountRow({ row, returnId, revision, onResult }: InterestAccountRowProps) {
  const [editing, setEditing] = useState(false);
  const [grossDraft, setGrossDraft] = useState(row.grossInterest != null ? String(row.grossInterest) : "");
  const [shareDraft, setShareDraft] = useState(
    row.ownershipSharePercent != null ? String(row.ownershipSharePercent) : "",
  );
  const [expanded, setExpanded] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  const [pending, setPending] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const grossId = useId();
  const shareId = useId();

  const isConfirmed = row.status === "confirmed";
  const isNotApplicable = row.status === "not-applicable";
  const hasProposedValue = row.status === "proposed";
  const canConfirm = !row.unverified || everOpened;

  async function run(action: () => Promise<ReviewActionResult>) {
    setPending(true);
    setLocalError(null);
    const result = await action();
    setPending(false);
    if (!result.ok) {
      setLocalError(result.error ?? "Something went wrong.");
      return;
    }
    setEditing(false);
    onResult(result);
  }

  function toggleSource() {
    setExpanded((v) => !v);
    setEverOpened(true);
  }

  return (
    <div className={`flex flex-col gap-2 px-5 py-3.5 sm:flex-row sm:items-center sm:gap-4 ${row.unverified && !isConfirmed ? "bg-unverified-soft" : ""}`}>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{row.label}</div>
        {row.sublabel ? <div className="mt-0.5 truncate text-[11px] text-muted">{row.sublabel}</div> : null}
        {row.unverified && !isConfirmed ? (
          <div className="mt-1 flex items-start gap-1 text-[11px] font-medium text-unverified">
            <AlertTriangleIcon className="mt-0.5 size-3 shrink-0" />
            We couldn&rsquo;t locate this amount in the document automatically.
          </div>
        ) : null}
      </div>

      {editing ? (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={grossId} className="sr-only">
            Gross interest
          </label>
          <Input
            id={grossId}
            autoFocus
            mono
            inputMode="decimal"
            value={grossDraft}
            onChange={(e) => setGrossDraft(e.target.value)}
            className="max-w-[120px]"
            aria-label="Gross interest"
          />
          <label htmlFor={shareId} className="sr-only">
            Your ownership share (%)
          </label>
          <Input
            id={shareId}
            mono
            inputMode="decimal"
            value={shareDraft}
            onChange={(e) => setShareDraft(e.target.value)}
            className="max-w-[90px]"
            aria-label="Your ownership share, percent"
          />
          <Button
            size="sm"
            variant="primary"
            onClick={() => run(() => editInterestAccount(returnId, revision, row.accountId, grossDraft, shareDraft))}
            disabled={pending}
          >
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={pending}>
            Cancel
          </Button>
        </div>
      ) : (
        <>
          <div className="text-left font-mono text-[13px] font-semibold tabular-nums sm:w-28 sm:text-right">
            {row.displayValue}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 sm:w-64">
            {row.source.kind !== "none" ? (
              <button
                type="button"
                onClick={toggleSource}
                aria-expanded={expanded}
                className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[10.5px] text-muted transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {row.source.label}
              </button>
            ) : null}
            {row.shareSource.kind !== "none" ? (
              <span className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[10.5px] text-muted">
                {row.shareSource.label}
              </span>
            ) : null}
            {row.source.confidenceLabel ? <Badge tone={row.source.confidenceTone}>{row.source.confidenceLabel}</Badge> : null}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-1.5 sm:w-56">
            {isConfirmed ? (
              <Badge tone="ok">Confirmed</Badge>
            ) : isNotApplicable ? (
              <Badge tone="muted">Not applicable</Badge>
            ) : (
              <>
                {hasProposedValue && canConfirm ? (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => run(() => confirmInterestAccount(returnId, revision, row.accountId))}
                    disabled={pending}
                  >
                    Confirm
                  </Button>
                ) : null}
                {hasProposedValue && !canConfirm ? (
                  <span className="text-[11px] font-medium text-unverified">Open source to confirm</span>
                ) : null}
                <Button size="sm" variant="ghost" onClick={() => setEditing(true)} disabled={pending}>
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => run(() => markInterestAccountNotApplicable(returnId, revision, row.accountId))}
                  disabled={pending}
                >
                  Nil
                </Button>
              </>
            )}
          </div>
        </>
      )}

      {expanded && row.source.snippet ? (
        <p className="w-full rounded-md border border-border bg-surface-2 p-2 text-[11px] italic text-muted sm:order-last">
          &ldquo;{row.source.snippet}&rdquo;
        </p>
      ) : null}
      {localError ? (
        <p role="alert" className="w-full text-[11px] font-medium text-danger sm:order-last">
          {localError}
        </p>
      ) : null}
    </div>
  );
}
