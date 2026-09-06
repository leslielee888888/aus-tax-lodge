import Link from "next/link";

import { Card, CardBody, CardHeader, CardTitle } from "../../../../components/Card";
import { InfoIcon } from "../../../../components/icons";
import type { EstimateBreakdown, EstimateRow } from "../../../../lib/estimate/breakdown";

/**
 * The "Your estimate" headline card + the "How we got there" line-by-line
 * breakdown (PRD FR-12), from `Estimate.dc.html`. Purely presentational — every
 * figure and every caveat is decided in `lib/estimate/breakdown.ts`, so this
 * component is a plain Server Component with no engine or model imports.
 */
export function EstimateBreakdownCard({ breakdown }: { breakdown: EstimateBreakdown }) {
  const { headline, rows } = breakdown;
  const positive = headline.kind === "refund";

  return (
    <div className="flex flex-col gap-4">
      <section
        aria-labelledby="estimate-headline-label"
        className={`rounded-card border border-border p-6 ${positive ? "bg-ok-soft" : "bg-warn-soft"}`}
      >
        <p
          id="estimate-headline-label"
          className={`font-sans text-xs font-semibold uppercase tracking-[0.06em] ${positive ? "text-ok" : "text-warn"}`}
        >
          {headline.label}
        </p>
        <p
          className={`mt-1 font-mono text-[40px] font-medium leading-none tracking-[-1px] tabular-nums ${positive ? "text-ok" : "text-warn"}`}
        >
          {headline.displayAmount}
        </p>
        {headline.caveats.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {headline.caveats.map((caveat) => (
              <li
                key={caveat}
                className="inline-flex items-center gap-1.5 rounded-md bg-warn-soft px-2 py-1 text-[11px] text-warn"
              >
                <InfoIcon className="size-3 shrink-0" aria-hidden="true" />
                {caveat}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>How we got there</CardTitle>
        </CardHeader>
        <CardBody>
          <dl>
            {rows.map((row, index) => (
              <BreakdownRowLine key={`${row.kind}-${row.label}-${index}`} row={row} />
            ))}
          </dl>
        </CardBody>
      </Card>
    </div>
  );
}

function BreakdownRowLine({ row }: { row: EstimateRow }) {
  const negative = row.amount < 0;
  const isNet = row.kind === "net";
  const isSubtotal = row.kind === "subtotal";
  const isSub = row.kind === "sub";

  const rowClass = [
    "flex items-baseline justify-between gap-3",
    isSub ? "py-1 pl-4 text-[12.5px] text-muted" : "py-2 text-[13.5px]",
    isSubtotal || isNet ? "mt-1.5 border-t border-border pt-3 font-semibold" : "",
    isNet ? "pt-3.5 text-base" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const amountClass = [
    "font-mono tabular-nums",
    isSub ? "" : "font-medium",
    isNet ? (row.label === "Estimated refund" ? "text-ok" : "text-warn") : "",
    !isNet && negative ? "text-muted" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const label = (
    <dt className="flex flex-wrap items-baseline gap-x-1.5">
      <span>{row.label}</span>
      {row.note ? <span className="text-[11px] text-muted">{row.note}</span> : null}
      {row.estimated ? (
        <span className="text-[11px] text-warn">· spouse income estimated</span>
      ) : null}
      {row.href ? (
        <Link
          href={row.href}
          className="text-[11px] text-muted underline decoration-dotted underline-offset-2 transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <span aria-hidden="true">view</span>
          <span className="sr-only">{`View the inputs behind ${row.label}`}</span>
        </Link>
      ) : null}
    </dt>
  );

  return (
    <div className={rowClass}>
      {label}
      <dd className={amountClass}>{row.displayAmount}</dd>
    </div>
  );
}
