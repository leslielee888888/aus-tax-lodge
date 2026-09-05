"use client";

import { useMemo, useState } from "react";

import type { ReturnModel } from "@aus-tax-lodge/model";

import { Badge } from "../../../../components/Badge";
import { Button } from "../../../../components/Button";
import { Card, CardBody, CardHeader, CardTitle } from "../../../../components/Card";
import { ArrowRightIcon } from "../../../../components/icons";
import { readExtractionScratch } from "../../../../lib/extraction-scratch";
import {
  buildReviewData,
  type ReviewData,
  type ReviewRow,
} from "../../../../lib/review/build-sections";
import { continueToQuestions, type ReviewActionResult } from "./actions";
import { FieldRow } from "./FieldRow";
import { InterestAccountRow } from "./InterestAccountRow";
import { MismatchRow } from "./MismatchRow";
import { PhiHeldRow } from "./PhiHeldRow";
import { RepairsGateRow } from "./RepairsGateRow";

export interface ReviewSectionsProps {
  readonly returnId: string;
  readonly initialModel: ReturnModel;
  readonly initialRevision: number;
  readonly documentsByDocId: Readonly<Record<string, string>>;
}

function rowKey(sectionId: string, row: ReviewRow): string {
  switch (row.kind) {
    case "field":
      return row.path;
    case "interest-account":
      return `interest-${row.accountId}`;
    case "mismatch":
      return `mismatch-${row.modelPath}`;
    case "repairs-gate":
      return `${sectionId}-repairs-gate`;
    case "phi-held":
      return `${sectionId}-phi-held`;
    case "computed":
      return `${sectionId}-computed-${row.label}`;
  }
}

/**
 * The interactive engine behind `/returns/[returnId]/review` (PRD FR-7,
 * FR-20, FR-21, FR-24). Holds the whole model client-side so every row
 * re-renders from one source of truth; each row's server action returns the
 * fresh saved model, which replaces this state directly — no client-side
 * re-implementation of `confirm`/`edit`/reconciliation logic.
 */
export function ReviewSections({
  returnId,
  initialModel,
  initialRevision,
  documentsByDocId,
}: ReviewSectionsProps) {
  const [model, setModel] = useState(initialModel);
  const [revision, setRevision] = useState(initialRevision);
  const [conflict, setConflict] = useState(false);
  const [continuePending, setContinuePending] = useState(false);
  const [continueError, setContinueError] = useState<string | null>(null);
  // Every row's own button disappears/changes the moment its action succeeds
  // (Confirmed badge, a resolved mismatch row vanishing, …), so a screen
  // reader has nothing left at the point of focus to announce that outcome —
  // this echoes it instead.
  const [announcement, setAnnouncement] = useState("");

  const data: ReviewData = useMemo(() => {
    const scratch = readExtractionScratch(model);
    return buildReviewData(model, scratch.pendingReconciliation, documentsByDocId);
  }, [model, documentsByDocId]);

  function handleResult(result: ReviewActionResult) {
    if (!result.ok) {
      if (result.conflict) setConflict(true);
      setAnnouncement(result.error ?? "Something went wrong.");
      return;
    }
    setAnnouncement("Saved.");
    setModel(result.model as ReturnModel);
    setRevision(result.revision as number);
  }

  async function handleContinue() {
    setContinuePending(true);
    setContinueError(null);
    const result = await continueToQuestions(returnId, revision);
    setContinuePending(false);
    if (!result.ok) {
      if (result.conflict) setConflict(true);
      setContinueError(result.error ?? "Something went wrong.");
    }
  }

  const progressPercent =
    data.progress.total === 0
      ? 100
      : Math.round((data.progress.confirmed / data.progress.total) * 100);

  return (
    <div className="flex flex-col gap-5">
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {conflict ? (
        <div
          role="alert"
          className="rounded-lg border border-danger bg-danger-soft p-3 text-xs font-medium text-danger"
        >
          This return changed in another tab — reload to see the latest version before continuing.{" "}
          <button type="button" onClick={() => window.location.reload()} className="underline">
            Reload now
          </button>
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
          <div
            className="h-full rounded-full bg-accent transition-[width]"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <span className="whitespace-nowrap text-xs text-muted">
          {data.progress.confirmed} of {data.progress.total} confirmed
        </span>
      </div>

      {data.sections.map((section) => (
        <Card key={section.id}>
          <CardHeader className="justify-between">
            <CardTitle>{section.title}</CardTitle>
            <span className="text-[11px] text-muted">
              {section.confirmedCount} of {section.totalCount} confirmed
            </span>
          </CardHeader>
          <CardBody className="divide-y divide-border p-0">
            {section.rows.map((row) => {
              const key = rowKey(section.id, row);
              switch (row.kind) {
                case "field":
                  return (
                    <FieldRow
                      key={key}
                      row={row}
                      returnId={returnId}
                      revision={revision}
                      onResult={handleResult}
                    />
                  );
                case "interest-account":
                  return (
                    <InterestAccountRow
                      key={key}
                      row={row}
                      returnId={returnId}
                      revision={revision}
                      onResult={handleResult}
                    />
                  );
                case "repairs-gate":
                  return (
                    <RepairsGateRow
                      key={key}
                      row={row}
                      returnId={returnId}
                      revision={revision}
                      onResult={handleResult}
                    />
                  );
                case "phi-held":
                  return (
                    <PhiHeldRow
                      key={key}
                      row={row}
                      returnId={returnId}
                      revision={revision}
                      onResult={handleResult}
                    />
                  );
                case "mismatch":
                  return (
                    <MismatchRow
                      key={key}
                      row={row}
                      returnId={returnId}
                      revision={revision}
                      onResult={handleResult}
                    />
                  );
                case "computed":
                  return (
                    <div
                      key={key}
                      className="flex flex-col gap-2 border-t-2 border-border px-5 py-3.5 sm:flex-row sm:items-center sm:gap-4"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-bold">{row.label}</div>
                        {row.sublabel ? (
                          <div className="mt-0.5 truncate text-[11px] text-muted">
                            {row.sublabel}
                          </div>
                        ) : null}
                      </div>
                      <div className="text-left font-mono text-[14px] font-bold tabular-nums text-accent sm:w-28 sm:text-right">
                        {row.displayValue}
                      </div>
                      <div className="sm:w-64">
                        <Badge tone="muted">Computed</Badge>
                      </div>
                      <div className="sm:w-56" aria-hidden="true" />
                    </div>
                  );
              }
            })}
          </CardBody>
        </Card>
      ))}

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted">Changes save as you confirm each figure.</span>
        <div className="text-right">
          <Button
            variant="primary"
            onClick={() => void handleContinue()}
            disabled={!data.canContinue || continuePending}
            aria-busy={continuePending}
          >
            {continuePending ? "Checking…" : "Continue to questions"}
            <ArrowRightIcon className="size-3.5" />
          </Button>
          {!data.canContinue && data.blockingReasons.length > 0 ? (
            <p className="mt-1.5 text-[11px] text-muted">
              Resolve {data.blockingReasons.join(", ")} to continue
            </p>
          ) : null}
          {continueError ? (
            <p role="alert" className="mt-1.5 text-[11px] font-medium text-danger">
              {continueError}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
