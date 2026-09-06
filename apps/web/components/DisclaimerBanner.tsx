import { DISCLAIMER_BANNER_POINTS } from "@aus-tax-lodge/export/disclaimer";

import { ShieldIcon } from "./icons";

/**
 * The persistent amber strip at the very top of every screen (PRD FR-19). It
 * lives in `app/layout.tsx` above the route content so it is always present —
 * on the unlock gate, the first-run acknowledge screen, every wizard step, the
 * settings screen and the FR-20 hard-stop screen alike.
 *
 * The wording is drawn from the one canonical disclaimer module
 * (`@aus-tax-lodge/export/disclaimer`) shared with the acknowledge screen and
 * the PDF cover page, so the three can never drift apart.
 */
export function DisclaimerBanner() {
  return (
    <div
      role="note"
      aria-label="Disclaimer"
      className="flex items-center gap-2 border-b border-border bg-warn-soft px-4 py-2 text-[11.5px] text-warn md:px-10"
    >
      <ShieldIcon className="size-3.5 shrink-0" aria-hidden="true" />
      <p className="text-pretty">
        {DISCLAIMER_BANNER_POINTS.map((point, i) => (
          <span key={point}>
            {i > 0 ? <span aria-hidden="true"> · </span> : null}
            {point}
          </span>
        ))}
      </p>
    </div>
  );
}
