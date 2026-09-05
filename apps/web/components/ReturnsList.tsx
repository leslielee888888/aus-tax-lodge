import Link from "next/link";

import type { ReturnSummary } from "@aus-tax-lodge/store";
import { TARGET_YEAR } from "@aus-tax-lodge/params";

import { formatDate, formatIncomeYear } from "../lib/format";
import { stepLabel } from "../lib/steps";
import { Badge, type BadgeTone } from "./Badge";
import { buttonClassName } from "./Button";
import { Card } from "./Card";
import { ArrowRightIcon, FileIcon } from "./icons";
import { NewReturnButton } from "./NewReturnButton";

interface Row {
  title: string;
  badgeTone: BadgeTone;
  badgeLabel: string;
  actionLabel: string;
  href: string;
  readOnly: boolean;
}

function toRow(summary: ReturnSummary): Row {
  const year = formatIncomeYear(summary.targetYear);
  const step = summary.currentStep || "details";
  const href = `/returns/${summary.returnId}/${step}`;

  if (summary.readOnly) {
    return {
      title: `Lodged — ${year}, read-only`,
      badgeTone: "muted",
      badgeLabel: "Lodged · read-only",
      actionLabel: "View",
      href,
      readOnly: true,
    };
  }
  if (summary.status === "exported") {
    return {
      title: `${year} return`,
      badgeTone: "ok",
      badgeLabel: "Exported",
      actionLabel: "Open",
      href,
      readOnly: false,
    };
  }
  return {
    title: `${year} return`,
    badgeTone: "warn",
    badgeLabel: `In progress · ${stepLabel(step)}`,
    actionLabel: "Resume",
    href,
    readOnly: false,
  };
}

/**
 * The returns list (PRD FR-16 / §7 step 2). In-progress and exported returns
 * are actionable; past returns built against a retired parameter set show as
 * "Lodged — <year>, read-only" and are view-only. Renders the empty state when
 * there are none.
 */
export function ReturnsList({ returns }: { returns: readonly ReturnSummary[] }) {
  if (returns.length === 0) {
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
      {returns.map((summary) => {
        const row = toRow(summary);
        return (
          <div
            key={summary.returnId}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-5 py-4"
          >
            <div className="min-w-0">
              <p className="font-medium">{row.title}</p>
              <p className="mt-1 text-xs text-muted">
                Last saved{" "}
                <time dateTime={summary.updatedAt}>{formatDate(summary.updatedAt)}</time>
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Badge tone={row.badgeTone}>{row.badgeLabel}</Badge>
              <Link
                href={row.href}
                className={buttonClassName({
                  variant: row.readOnly ? "ghost" : "default",
                  size: "sm",
                })}
              >
                {row.actionLabel}
                {row.readOnly ? null : <ArrowRightIcon className="size-3.5" />}
              </Link>
            </div>
          </div>
        );
      })}
    </Card>
  );
}
