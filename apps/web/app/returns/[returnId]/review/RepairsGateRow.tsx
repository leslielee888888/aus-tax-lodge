"use client";

import { useState } from "react";

import { Badge } from "../../../../components/Badge";
import { Button } from "../../../../components/Button";
import type { RepairsGateRowData } from "../../../../lib/review/build-sections";
import { confirmRepairs, reclassifyRepairs, type ReviewActionResult } from "./actions";

export interface RepairsGateRowProps {
  readonly row: RepairsGateRowData;
  readonly returnId: string;
  readonly revision: number;
  readonly onResult: (result: ReviewActionResult) => void;
}

/**
 * The rental repairs-vs-capital gate (PRD Q25, FR-13, FR-24): a single
 * "repairs and maintenance" line over the confirmation threshold blocks
 * Continue until the user says which it is.
 */
export function RepairsGateRow({ row, returnId, revision, onResult }: RepairsGateRowProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<ReviewActionResult>) {
    setPending(true);
    setError(null);
    const result = await action();
    setPending(false);
    if (!result.ok) {
      setError(result.error ?? "Something went wrong.");
      return;
    }
    onResult(result);
  }

  return (
    <div className="flex flex-col gap-2 bg-warn-soft px-5 py-3.5 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 flex-1">
        <div className="font-medium">Repairs and maintenance</div>
        <div className="mt-0.5 text-[11px] text-warn">{row.sublabel}</div>
      </div>
      <div className="text-left font-mono text-[13px] font-semibold tabular-nums sm:w-28 sm:text-right">
        {row.displayValue}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 sm:w-64">
        {row.source.kind !== "none" ? (
          <span className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[10.5px] text-muted">
            {row.source.label}
          </span>
        ) : null}
        <Badge tone="warn">Confirm</Badge>
      </div>
      <div className="flex items-center justify-end gap-1.5 sm:w-56">
        <Button size="sm" variant="primary" onClick={() => run(() => confirmRepairs(returnId, revision))} disabled={pending}>
          It&rsquo;s a repair
        </Button>
        <Button size="sm" variant="ghost" onClick={() => run(() => reclassifyRepairs(returnId, revision))} disabled={pending}>
          Capital
        </Button>
      </div>
      {error ? (
        <p role="alert" className="w-full text-[11px] font-medium text-danger sm:order-last">
          {error}
        </p>
      ) : null}
    </div>
  );
}
