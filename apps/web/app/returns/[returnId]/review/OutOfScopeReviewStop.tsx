import Link from "next/link";

import type { OutOfScopeFinding } from "@aus-tax-lodge/scope";

import { buttonClassName } from "../../../../components/Button";
import { AlertTriangleIcon } from "../../../../components/icons";
import { DeleteReturnButton } from "./DeleteReturnButton";

export interface OutOfScopeReviewStopProps {
  readonly returnId: string;
  readonly findings: readonly OutOfScopeFinding[];
}

/**
 * The hard-stop screen (PRD FR-20, Q12): a return with any out-of-scope
 * finding cannot proceed past review. No override exists — the only paths
 * out are back to documents (to remove/reclassify what triggered it) or
 * deleting the return outright.
 */
export function OutOfScopeReviewStop({ returnId, findings }: OutOfScopeReviewStopProps) {
  return (
    <main className="mx-auto flex max-w-2xl justify-center px-6 py-14 md:px-10">
      <div className="w-full overflow-hidden rounded-card border border-border bg-surface shadow-card">
        <div className="h-1 bg-danger" aria-hidden="true" />
        <div className="p-7">
          <div className="mb-3 flex items-center gap-3">
            <span
              className="flex size-9 shrink-0 items-center justify-center rounded-[9px] bg-danger-soft text-danger"
              aria-hidden="true"
            >
              <AlertTriangleIcon className="size-[18px]" />
            </span>
            <h1 className="text-pretty font-serif text-xl">This return needs a tax agent</h1>
          </div>

          <p className="text-sm text-muted">
            This assistant only prepares a simple resident individual return, and can&rsquo;t
            continue past what it found:
          </p>

          <ul className="mt-4 flex flex-col gap-3">
            {findings.map((finding) => (
              <li key={finding.code} className="rounded-lg border border-border bg-surface-2 p-3">
                <p className="text-sm font-semibold">{finding.item}</p>
                <p className="mt-1 text-xs text-muted">{finding.detail}</p>
              </li>
            ))}
          </ul>

          <div className="mb-2 mt-6 text-[13px] font-semibold">What you can do</div>
          <ul className="mb-6 list-disc pl-[18px] text-xs leading-relaxed text-muted">
            <li>
              Lodge through a registered tax agent — find one at{" "}
              <a href="https://www.tpb.gov.au" target="_blank" rel="noopener noreferrer">
                tpb.gov.au
              </a>
            </li>
            <li>Or lodge yourself in ATO myTax, which handles these items</li>
          </ul>

          <div className="flex flex-wrap gap-2.5">
            <Link
              href={`/returns/${returnId}/documents`}
              className={buttonClassName({ variant: "default" })}
            >
              Back to documents
            </Link>
            <DeleteReturnButton returnId={returnId} />
          </div>
        </div>
      </div>
    </main>
  );
}
