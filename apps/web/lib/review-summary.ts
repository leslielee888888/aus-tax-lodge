/**
 * The whole-return review summary (PRD FR-5 final checkpoint, FR-10, FR-11).
 *
 * `buildReviewSummary` turns a confirmed {@link ReturnModel} + the engine's
 * {@link FullAssessment} into a flat, serialisable structure the
 * `review-summary` card renders line by line and the `approveReturn` /
 * `reopenLine` card actions read. It does no arithmetic of its own — every
 * figure comes from {@link buildEstimateBreakdown} (which only reads engine
 * output), so the review figures can never drift from the FR-10 estimate or the
 * FR-11 export package.
 *
 * Each line carries:
 * - a stable `lineKey`, so "That's not right" can name the line it reopens
 *   (see {@link reopenQuestionFor});
 * - a short `source` note ("from your pre-fill report" / "from what you told
 *   me"), in the {@link import("./conversation").PendingConfirmation} `source`
 *   style, tracing the line back to its inputs (FR-22);
 * - `estimated: true` on any line moved by the spouse's *estimated* taxable
 *   income (FR-10 caveat).
 *
 * The summary always shows the taxpayer's **name**, never the TFN.
 */
import { assess, type FullAssessment } from "@aus-tax-lodge/engine";
import {
  MissingFiguresError,
  toEngineInput,
  type Provenanced,
  type ReturnModel,
} from "@aus-tax-lodge/model";

import { buildEstimateBreakdown, type EstimateRowKind } from "./estimate/breakdown";
import { topicsOutstanding } from "./interview/topics";

// ---------------------------------------------------------------------------
// Types (all serialisable — this rides in a card payload)
// ---------------------------------------------------------------------------

export interface ReviewSummaryLine {
  /** Stable id for the line — what a "That's not right" reject names. */
  readonly lineKey: string;
  readonly label: string;
  /** Signed amount (a deduction / credit is negative). */
  readonly amount: number;
  /** {@link amount} already formatted for display. */
  readonly displayAmount: string;
  readonly kind: EstimateRowKind;
  /** Short qualifier after the label ("— a loss"), when the breakdown set one. */
  readonly note?: string;
  /** Where the line's inputs came from — "from your pre-fill report", etc. */
  readonly source: string;
  /** `true` when the line is influenced by the spouse's *estimated* taxable income. */
  readonly estimated?: boolean;
  /** `true` when rejecting this line can reopen the interview for it (an input, not a computed roll-up). */
  readonly reopenable: boolean;
}

export interface ReviewSummaryHeadline {
  readonly kind: "refund" | "payable";
  readonly label: string;
  readonly amount: number;
  readonly displayAmount: string;
}

export interface ReviewSummary {
  /** The taxpayer's name — never the TFN (PRD, TFN handling). */
  readonly taxpayerName: string;
  readonly lines: readonly ReviewSummaryLine[];
  /** `null` when the engine could not run yet (`incomplete: true`). */
  readonly headline: ReviewSummaryHeadline | null;
  /** Caveats shown under the summary — the first is always the "this is an estimate" line. */
  readonly caveats: readonly string[];
  /** `true` when the return still had a missing figure and no assessment could be built. */
  readonly incomplete: boolean;
  /** Plain-English list of what is still outstanding, when `incomplete`. */
  readonly missing: readonly string[];
  /** `true` when a spouse's estimated taxable income feeds any line. */
  readonly hasSpouseEstimate: boolean;
}

// ---------------------------------------------------------------------------
// Line classification — EstimateRow label → stable key + reopen-ability
// ---------------------------------------------------------------------------

interface LineClass {
  readonly lineKey: string;
  readonly reopenable: boolean;
}

/** Map one breakdown row (by its label) to a stable key + whether rejecting it reopens the interview. */
function classifyRow(label: string): LineClass {
  if (label === "Assessable income") return { lineKey: "assessable-income", reopenable: false };
  if (label === "Salary & wages") return { lineKey: "salary-wages", reopenable: true };
  if (label === "Gross interest") return { lineKey: "interest", reopenable: true };
  if (label.startsWith("Dividends")) return { lineKey: "dividends", reopenable: true };
  if (label === "Government allowances")
    return { lineKey: "government-allowances", reopenable: true };
  if (
    label === "Gross rent" ||
    label === "less Rental deductions" ||
    label === "Net rental result"
  ) {
    return { lineKey: "rental", reopenable: true };
  }
  if (label === "less Deductions") return { lineKey: "deductions", reopenable: true };
  if (label === "Taxable income") return { lineKey: "taxable-income", reopenable: false };
  if (label === "Tax on taxable income") return { lineKey: "tax", reopenable: false };
  if (label.includes("tax offset") || label === "Tax after offsets") {
    return { lineKey: "offsets", reopenable: false };
  }
  if (label.startsWith("plus Medicare levy"))
    return { lineKey: "medicare-levy", reopenable: false };
  if (label === "Medicare levy surcharge") {
    return { lineKey: "medicare-levy-surcharge", reopenable: false };
  }
  if (label === "plus Study loan repayment") {
    return { lineKey: "study-loan-repayment", reopenable: false };
  }
  if (label === "Total tax and levies") return { lineKey: "total-tax", reopenable: false };
  if (label === "less PAYG tax withheld") return { lineKey: "payg-withheld", reopenable: true };
  if (label === "less Franking credits") return { lineKey: "dividends", reopenable: true };
  if (label === "Private health rebate adjustment") {
    return { lineKey: "private-health", reopenable: true };
  }
  return { lineKey: "net-result", reopenable: false };
}

// ---------------------------------------------------------------------------
// Line source — trace a line back to its inputs (PRD FR-22)
// ---------------------------------------------------------------------------

const COMPUTED_SOURCE = "worked out by the tax engine from the figures above";

/** "from your pre-fill report" / "from what you told me" / a blend, from a set of fields' origins. */
function describeOrigins(fields: readonly Provenanced<unknown>[]): string {
  let hasDocument = false;
  let hasAnswer = false;
  for (const field of fields) {
    const kind = field.origin?.kind;
    if (kind === "document") hasDocument = true;
    else if (kind === "user-answer") hasAnswer = true;
  }
  if (hasDocument && hasAnswer) return "from your pre-fill report and what you told me";
  if (hasDocument) return "from your pre-fill report and uploads";
  return "from what you told me";
}

function lineSource(lineKey: string, model: ReturnModel): string {
  switch (lineKey) {
    case "salary-wages":
      return describeOrigins(
        model.income.salaryWages.flatMap((e) => [e.grossSalaryWages, e.paygWithheld]),
      );
    case "payg-withheld":
      return describeOrigins(model.income.salaryWages.map((e) => e.paygWithheld));
    case "interest":
      return describeOrigins(model.income.interestAccounts.map((a) => a.grossInterest));
    case "dividends":
      return describeOrigins(
        model.income.dividends.flatMap((d) => [d.unfranked, d.franked, d.frankingCredits]),
      );
    case "government-allowances":
      return describeOrigins([model.income.governmentAllowances]);
    case "rental":
      return describeOrigins([
        model.rental.grossRent,
        model.rental.otherRentalIncome,
        ...Object.values(model.rental.expenses).map((line) => line.amount),
      ]);
    case "deductions":
      return describeOrigins(Object.values(model.deductions).flatMap(deductionFields));
    case "private-health":
      return describeOrigins([
        model.privateHealth.premiumsEligibleForRebate,
        model.privateHealth.rebateReceived,
      ]);
    default:
      return COMPUTED_SOURCE;
  }
}

/** The `Provenanced` figure(s) inside one deduction entry (car / WFH carry extra inputs). */
function deductionFields(entry: unknown): Provenanced<unknown>[] {
  if (!entry || typeof entry !== "object") return [];
  const record = entry as Record<string, Provenanced<unknown> | unknown>;
  const out: Provenanced<unknown>[] = [];
  for (const key of ["amount", "businessKilometres", "hours"]) {
    const field = record[key];
    if (field && typeof field === "object" && "status" in (field as object)) {
      out.push(field as Provenanced<unknown>);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reopen questions — lineKey → the plain question the reopened interview asks
// ---------------------------------------------------------------------------

/** lineKey → a short noun phrase naming what the reopened interview should revisit (PRD FR-5). */
export const REOPEN_TOPICS: Readonly<Record<string, string>> = {
  "salary-wages": "your salary and wages",
  "payg-withheld": "the PAYG tax withheld from your pay",
  interest: "your bank interest",
  dividends: "your dividends and franking credits",
  "government-allowances": "your government allowances",
  rental: "your rental property figures",
  deductions: "your deductions",
  "private-health": "your private health insurance details",
};

/** The assistant message that reopens the interview for `lineKey` (PRD FR-5). */
export function reopenQuestionFor(lineKey: string, fallbackLabel: string): string {
  const topic = REOPEN_TOPICS[lineKey] ?? `“${fallbackLabel}”`;
  return `Let's fix ${topic}. What should it be?`;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

const ESTIMATE_CAVEAT =
  "This is an estimate, not the ATO's assessment. The ATO works out the final figures when you lodge in myTax, and may assess your return differently.";

function taxpayerName(model: ReturnModel): string {
  const name = model.taxpayer.fullName.value?.trim();
  return name && name.length > 0 ? name : "You";
}

function hasSpouseEstimate(model: ReturnModel): boolean {
  return model.context.spouse.status.value === "had-spouse";
}

/**
 * Build the whole-return review summary. Pass the engine assessment (or `null`
 * when a figure is still missing — the summary is then `incomplete` and the
 * card shows what is outstanding rather than a headline figure).
 */
export function buildReviewSummary(
  model: ReturnModel,
  assessment: FullAssessment | null,
): ReviewSummary {
  const name = taxpayerName(model);
  const spouseEstimate = hasSpouseEstimate(model);

  if (!assessment) {
    return {
      taxpayerName: name,
      lines: [],
      headline: null,
      caveats: [ESTIMATE_CAVEAT],
      incomplete: true,
      missing: topicsOutstanding(model),
      hasSpouseEstimate: spouseEstimate,
    };
  }

  // `returnId` is only used by `buildEstimateBreakdown` to build a back-to-review
  // `href` on each row — the card identifies lines by `lineKey`, not a link, so
  // pass an empty id and drop `href` when mapping.
  const breakdown = buildEstimateBreakdown(model, assessment, "");

  const lines: ReviewSummaryLine[] = breakdown.rows.map((row) => {
    const { lineKey, reopenable } = classifyRow(row.label);
    return {
      lineKey,
      label: row.label,
      amount: row.amount,
      displayAmount: row.displayAmount,
      kind: row.kind,
      ...(row.note ? { note: row.note } : {}),
      source: lineSource(lineKey, model),
      ...(row.estimated ? { estimated: true } : {}),
      reopenable: reopenable && row.kind !== "net",
    };
  });

  return {
    taxpayerName: name,
    lines,
    headline: {
      kind: breakdown.headline.kind,
      label: breakdown.headline.label,
      amount: breakdown.headline.amount,
      displayAmount: breakdown.headline.displayAmount,
    },
    caveats: [ESTIMATE_CAVEAT, ...breakdown.headline.caveats],
    incomplete: false,
    missing: [],
    hasSpouseEstimate: spouseEstimate,
  };
}

/**
 * Build the review summary straight from a model — runs the engine, falling back
 * to an `incomplete` summary if a figure is still missing (or the model can't be
 * assessed at all). Used by {@link import("./interview-loop").applyInterviewStep}
 * when it drops the `review-summary` card on a `done` step.
 */
export function reviewSummaryForModel(model: ReturnModel): ReviewSummary {
  let assessment: FullAssessment | null = null;
  try {
    assessment = assess(toEngineInput(model));
  } catch (err) {
    if (!(err instanceof MissingFiguresError)) {
      // A malformed model shouldn't break the conversation save — the card will
      // render the "still outstanding" state.
      console.error("review summary: could not assess the return", err);
    }
  }
  return buildReviewSummary(model, assessment);
}
