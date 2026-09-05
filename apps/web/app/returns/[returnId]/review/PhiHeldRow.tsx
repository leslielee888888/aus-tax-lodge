"use client";

import { useState } from "react";

import { Badge } from "../../../../components/Badge";
import { Button } from "../../../../components/Button";
import type { PhiHeldRowData } from "../../../../lib/review/build-sections";
import { setPrivateHealthHeld, type ReviewActionResult } from "./actions";

export interface PhiHeldRowProps {
  readonly row: PhiHeldRowData;
  readonly returnId: string;
  readonly revision: number;
  readonly onResult: (result: ReviewActionResult) => void;
}

/**
 * "Did you hold private health cover?" — a yes/no answer that gates whether
 * the premium / rebate / cover-day rows below apply, and feeds
 * `toEngineInput`'s required `privateHealth.held`.
 */
export function PhiHeldRow({ row, returnId, revision, onResult }: PhiHeldRowProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const settled = row.status === "confirmed" || row.status === "not-applicable";

  async function choose(held: boolean) {
    setPending(true);
    setError(null);
    const result = await setPrivateHealthHeld(returnId, revision, held);
    setPending(false);
    if (!result.ok) {
      setError(result.error ?? "Something went wrong.");
      return;
    }
    onResult(result);
  }

  return (
    <div className="flex flex-col gap-2 px-5 py-3.5 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 flex-1">
        <div className="font-medium">Did you hold private health cover this year?</div>
      </div>
      <div className="flex items-center justify-end gap-1.5 sm:ml-auto">
        {settled ? (
          <Badge tone="ok">{row.held ? "Yes" : "No"}</Badge>
        ) : (
          <>
            <Button size="sm" variant={row.held === true ? "primary" : "default"} onClick={() => void choose(true)} disabled={pending}>
              Yes
            </Button>
            <Button size="sm" variant={row.held === false ? "primary" : "default"} onClick={() => void choose(false)} disabled={pending}>
              No
            </Button>
          </>
        )}
      </div>
      {error ? (
        <p role="alert" className="w-full text-[11px] font-medium text-danger sm:order-last">
          {error}
        </p>
      ) : null}
    </div>
  );
}
