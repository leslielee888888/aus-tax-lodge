import Link from "next/link";

import { TARGET_YEAR } from "@aus-tax-lodge/params";

import { formatDate, formatIncomeYear } from "../lib/format";
import type { ReturnListItem } from "../lib/returns";
import { Badge, type BadgeTone } from "./Badge";
import { buttonClassName } from "./Button";
import { Card } from "./Card";
import { ArrowRightIcon, FileIcon } from "./icons";
import { NewReturnButton } from "./NewReturnButton";

interface Row {
  title: string;
  badgeTone: BadgeTone;
  badgeLabel: string;
  /** The one-line "up to: <topic>" / status line under the title. */
  sublabel: string;
  actionLabel: string;
  href: string;
  /** Render the action as a quiet "view" link rather than a primary button. */
  quiet: boolean;
}

/**
 * A summary row. Every return — in-progress, exported, past read-only, or
 * hard-stopped — links to the one chat screen at `/returns/<id>` (PRD FR-13,
 * T9); v2 has no wizard steps to deep-link into.
 */
function toRow(item: ReturnListItem): Row {
  const { summary } = item;
  const year = formatIncomeYear(summary.targetYear);
  const href = `/returns/${summary.returnId}`;

  // Out-of-scope hard stop (PRD FR-9): still reachable so the user can read the
  // stop card and delete the return.
  if (item.phase === "stopped") {
    return {
      title: `${year} return`,
      badgeTone: "muted",
      badgeLabel: "Stopped",
      sublabel: item.stoppedReason ?? item.summaryLine,
      actionLabel: "View",
      href,
      quiet: true,
    };
  }

  if (summary.readOnly) {
    return {
      title: `Lodged — ${year}, read-only`,
      badgeTone: "muted",
      badgeLabel: "Lodged · read-only",
      sublabel: item.summaryLine,
      actionLabel: "View",
      href,
      quiet: true,
    };
  }

  if (summary.status === "exported") {
    return {
      title: `${year} return`,
      badgeTone: "ok",
      badgeLabel: "Exported",
      sublabel: item.summaryLine,
      actionLabel: "Open",
      href,
      quiet: false,
    };
  }

  return {
    title: `${year} return`,
    badgeTone: "warn",
    badgeLabel: "In progress",
    sublabel: item.summaryLine,
    actionLabel: "Resume",
    href,
    quiet: false,
  };
}

/**
 * The returns list (PRD FR-13 / §7 step 2). In-progress returns carry a
 * one-line "up to: <topic>" from the conversation state; exported and past
 * read-only returns are view-only; a hard-stopped return shows why it stopped.
 * Renders the empty state when there are none.
 */
export function ReturnsList({ items }: { items: readonly ReturnListItem[] }) {
  if (items.length === 0) {
    return (
      <Card className="mt-5 flex flex-col items-center px-6 py-10 text-center">
        <span
          className="mb-3 flex size-11 items-center justify-center rounded-card bg-surface-2 text-muted"
          aria-hidden="true"
        >
          <FileIcon className="size-5" />
        </span>
        <h2 className="font-serif text-base font-medium">No returns yet</h2>
        <p className="mb-4 mt-1.5 text-xs text-muted">
          Create your first return for the {formatIncomeYear(TARGET_YEAR)} income year.
        </p>
        <NewReturnButton />
      </Card>
    );
  }

  return (
    <Card className="mt-5 divide-y divide-border">
      {items.map((item) => {
        const row = toRow(item);
        return (
          <div
            key={item.summary.returnId}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-5 py-4"
          >
            <div className="min-w-0">
              <p className="font-medium">{row.title}</p>
              <p className="mt-1 truncate text-xs text-muted">{row.sublabel}</p>
              <p className="mt-0.5 text-[11px] text-muted">
                Last saved{" "}
                <time dateTime={item.summary.updatedAt}>{formatDate(item.summary.updatedAt)}</time>
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Badge tone={row.badgeTone}>{row.badgeLabel}</Badge>
              <Link
                href={row.href}
                className={buttonClassName({
                  variant: row.quiet ? "ghost" : "default",
                  size: "sm",
                })}
              >
                {row.actionLabel}
                {row.quiet ? null : <ArrowRightIcon className="size-3.5" />}
              </Link>
            </div>
          </div>
        );
      })}
    </Card>
  );
}
