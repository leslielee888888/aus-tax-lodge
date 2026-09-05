"use client";

import { useId, useState } from "react";

import { Badge } from "../../../../components/Badge";
import { Button } from "../../../../components/Button";
import { AlertTriangleIcon } from "../../../../components/icons";
import { Input } from "../../../../components/Input";
import type { FieldRowData } from "../../../../lib/review/build-sections";
import { confirmField, editField, markFieldNotApplicable, type ReviewActionResult } from "./actions";

export interface FieldRowProps {
  readonly row: FieldRowData;
  readonly returnId: string;
  readonly revision: number;
  readonly onResult: (result: ReviewActionResult) => void;
}

/**
 * One confirmable figure (PRD FR-7): value, source chip (expands the verbatim
 * snippet — "opening" it), confidence badge, and Accept / Edit / Nil. An
 * `unverified` figure's Accept stays hidden until the source has been opened.
 */
export function FieldRow({ row, returnId, revision, onResult }: FieldRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.rawValue != null ? String(row.rawValue) : "");
  const [expanded, setExpanded] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  const [pending, setPending] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const inputId = useId();

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

  const rowTone = row.unverified && !isConfirmed ? "bg-unverified-soft" : row.unsubstantiated ? "bg-warn-soft" : "";

  return (
    <div className={`flex flex-col gap-2 px-5 py-3.5 sm:flex-row sm:items-center sm:gap-4 ${rowTone}`}>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{row.label}</div>
        {row.sublabel ? <div className="mt-0.5 truncate text-[11px] text-muted">{row.sublabel}</div> : null}
        {row.unverified && !isConfirmed ? (
          <div className="mt-1 flex items-start gap-1 text-[11px] font-medium text-unverified">
            <AlertTriangleIcon className="mt-0.5 size-3 shrink-0" />
            We couldn&rsquo;t locate this amount in the document automatically.
          </div>
        ) : null}
        {row.unsubstantiated ? (
          <div className="mt-1 text-[11px] font-medium text-warn">No substantiation on file</div>
        ) : null}
      </div>

      {editing ? (
        <div className="flex items-center gap-2">
          <label htmlFor={inputId} className="sr-only">
            {row.label} value
          </label>
          <Input
            id={inputId}
            autoFocus
            mono
            inputMode="decimal"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="max-w-[130px]"
          />
          <Button size="sm" variant="primary" onClick={() => run(() => editField(returnId, revision, row.path, draft))} disabled={pending}>
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
                  <Button size="sm" variant="primary" onClick={() => run(() => confirmField(returnId, revision, row.path))} disabled={pending}>
                    Confirm
                  </Button>
                ) : null}
                {hasProposedValue && !canConfirm ? (
                  <span className="text-[11px] font-medium text-unverified">Open source to confirm</span>
                ) : null}
                <Button size="sm" variant="ghost" onClick={() => setEditing(true)} disabled={pending}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => run(() => markFieldNotApplicable(returnId, revision, row.path))} disabled={pending}>
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
