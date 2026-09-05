"use client";

import { useId, useState } from "react";

import { Badge } from "../../../../components/Badge";
import { Button } from "../../../../components/Button";
import { AlertTriangleIcon } from "../../../../components/icons";
import type { MismatchRowData } from "../../../../lib/review/build-sections";
import { resolveMismatch, type ReviewActionResult } from "./actions";

export interface MismatchRowProps {
  readonly row: MismatchRowData;
  readonly returnId: string;
  readonly revision: number;
  readonly onResult: (result: ReviewActionResult) => void;
}

/**
 * A side-by-side pick between two or more sources that disagree (PRD FR-21).
 * `suggestedIndex` only pre-selects a candidate — the user still has to click
 * "Use …" to resolve it; nothing here auto-applies a pick.
 */
export function MismatchRow({ row, returnId, revision, onResult }: MismatchRowProps) {
  const [selected, setSelected] = useState(row.suggestedIndex);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const groupName = useId();

  async function use() {
    setPending(true);
    setError(null);
    const result = await resolveMismatch(returnId, revision, row.modelPath, selected);
    setPending(false);
    if (!result.ok) {
      setError(result.error ?? "Something went wrong.");
      return;
    }
    onResult(result);
  }

  const chosen = row.candidates[selected];

  return (
    <div className="flex flex-col gap-3 bg-danger-soft px-5 py-4">
      <div>
        <div className="flex items-center gap-1.5 font-medium text-danger">
          <AlertTriangleIcon className="size-3.5 shrink-0" />
          {row.label}
          <Badge tone="danger">Sources disagree</Badge>
        </div>
        {row.sublabel ? (
          <div className="mt-0.5 truncate text-[11px] text-muted">{row.sublabel}</div>
        ) : null}
      </div>

      <fieldset className="m-0 flex flex-wrap gap-3 border-0 p-0">
        <legend className="sr-only">Pick a value for {row.label}</legend>
        {row.candidates.map((candidate, index) => {
          const isSelected = index === selected;
          return (
            <label
              key={`${candidate.source}-${index}`}
              className={[
                "min-w-[150px] cursor-pointer rounded-lg border px-3 py-2 text-left transition-colors has-[:focus-visible]:outline-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent",
                isSelected
                  ? "border-accent bg-surface"
                  : "border-border bg-surface hover:bg-surface-2",
              ].join(" ")}
            >
              <input
                type="radio"
                name={groupName}
                checked={isSelected}
                onChange={() => setSelected(index)}
                className="sr-only"
              />
              <div className="flex items-center gap-1.5 text-[11px] text-muted">
                <span
                  aria-hidden="true"
                  className={[
                    "size-3 shrink-0 rounded-full border-[1.5px]",
                    isSelected ? "border-accent bg-accent" : "border-border",
                  ].join(" ")}
                />
                {candidate.source}
              </div>
              <div className="mt-1 font-mono text-base font-semibold tabular-nums">
                {candidate.displayValue}
              </div>
              <Badge tone={candidate.confidenceTone}>{candidate.confidenceLabel}</Badge>
            </label>
          );
        })}
      </fieldset>

      <div>
        <Button size="sm" variant="primary" onClick={() => void use()} disabled={pending}>
          Use {chosen?.displayValue ?? ""}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-[11px] font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
