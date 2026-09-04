import type { ReactNode } from "react";

import { TARGET_YEAR } from "@aus-tax-lodge/params";

import { formatIncomeYear } from "../lib/format";
import { MarkIcon } from "./icons";

export interface TopBarProps {
  /**
   * Replaces the default `"2025–26 income year"` chip — e.g. a return's
   * `"<taxpayer> · 2025–26"` context on the wizard screens.
   */
  context?: string;
  /** Right-aligned slot: an "Unlocked" chip, a "Save & exit" button, etc. */
  children?: ReactNode;
}

/**
 * App header: the mark, the "Return Assistant" wordmark, a context chip, and a
 * right-aligned slot. Server Component — screens that need interactive controls
 * on the right pass them in as `children`.
 */
export function TopBar({ context, children }: TopBarProps) {
  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-border bg-surface px-4 py-3 md:px-10">
      <span
        className="flex size-[26px] shrink-0 items-center justify-center rounded-[7px] bg-accent text-accent-ink"
        aria-hidden="true"
      >
        <MarkIcon className="size-4" />
      </span>
      <span className="font-serif text-[15px] font-semibold" translate="no">
        Return Assistant
      </span>
      <span className="rounded-full border border-border px-2.5 py-0.5 text-[11px] text-muted">
        {context ?? `${formatIncomeYear(TARGET_YEAR)} income year`}
      </span>
      <span className="flex-1" />
      {children}
    </header>
  );
}
