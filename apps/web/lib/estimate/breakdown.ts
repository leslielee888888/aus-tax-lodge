/**
 * Estimate-screen row assembly (PRD FR-12, FR-15, FR-23, FR-24).
 *
 * Pure and React-free so it can be unit-tested on its own: given a confirmed
 * {@link ReturnModel} and the {@link FullAssessment} the engine produced from
 * it, it returns the refund/owing headline plus the "How we got there"
 * line-by-line breakdown the estimate page renders. It only *reads* engine
 * output and model figures — no maths of its own beyond re-deriving the rental
 * gross / deductions split the engine collapses into a single net figure
 * (FR-24), and picking signs for display.
 *
 * Mirrors `lib/review/build-sections.ts`: the page (a Server Component) calls
 * this once per request against a freshly loaded model, so any edit on review /
 * questions is reflected the next time this screen is opened (FR-12 "recomputes
 * on edit").
 */
import { getParams, type FullAssessment } from "@aus-tax-lodge/engine";
import { RENTAL_EXPENSE_KEYS, type ReturnModel } from "@aus-tax-lodge/model";

import { formatMoney } from "../review/format";

// ---------------------------------------------------------------------------
// Row / headline types
// ---------------------------------------------------------------------------

export type EstimateRowKind =
  /** A named income group with its own total; its component `"sub"` rows follow. */
  | "group"
  /** An indented component of the group above (an income type, a rental part). */
  | "sub"
  /** A plain running line — a deduction, a tax, a levy, an offset, a credit. */
  | "line"
  /** A bold, top-bordered running subtotal (taxable income, total tax and levies). */
  | "subtotal"
  /** The final assessed position. */
  | "net";

export interface EstimateRow {
  readonly label: string;
  /** The figure as displayed (already signed: a deduction / credit is negative). */
  readonly amount: number;
  /** {@link amount} run through {@link formatMoney}. */
  readonly displayAmount: string;
  readonly kind: EstimateRowKind;
  /** A short muted qualifier shown after the label ("— a loss", "refundable"). */
  readonly note?: string;
  /** Link back to where this figure's inputs are confirmed (the review screen). */
  readonly href?: string;
  /** `true` when this line is influenced by the spouse's *estimated* taxable income. */
  readonly estimated?: boolean;
}

export interface EstimateHeadline {
  readonly kind: "refund" | "payable";
  readonly label: string;
  /** Positive amount, to the cent. */
  readonly amount: number;
  readonly displayAmount: string;
  /** The caveat chips shown under the headline figure. */
  readonly caveats: readonly string[];
}

export interface EstimateBreakdown {
  readonly headline: EstimateHeadline;
  readonly rows: readonly EstimateRow[];
  /** `true` when the return has a negatively geared rental — drives the FR-23 add-back note. */
  readonly rentalLossAddBack: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The income year runs 1 July – 30 June; neither 2025–26 nor its neighbours contain 29 Feb. */
const FULL_YEAR_COVER_DAYS = 365;

function rentalGrossIncome(model: ReturnModel): number {
  return (model.rental.grossRent.value ?? 0) + (model.rental.otherRentalIncome.value ?? 0);
}

function rentalDeductionsTotal(model: ReturnModel): number {
  return RENTAL_EXPENSE_KEYS.reduce(
    (sum, key) => sum + (model.rental.expenses[key].amount.value ?? 0),
    0,
  );
}

/** `0.02` → `"2%"`, `0.005` → `"0.5%"`. */
function formatRate(rate: number): string {
  return `${Number((rate * 100).toFixed(2))}%`;
}

function hasSpouse(model: ReturnModel): boolean {
  return model.context.spouse.status.value === "had-spouse";
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/**
 * Assemble the estimate headline and breakdown rows for `assessment` (the
 * engine's output for `model`). `returnId` is only used to build the
 * back-to-review `href` on each line.
 */
export function buildEstimateBreakdown(
  model: ReturnModel,
  assessment: FullAssessment,
  returnId: string,
): EstimateBreakdown {
  const reviewHref = `/returns/${returnId}/review`;
  const ai = assessment.assessableIncome;
  const spouse = hasSpouse(model);
  const rentalPresent = model.rental.present;
  const rentalLossAddBack = rentalPresent && ai.netRental < 0;

  // The engine reads the statutory levy rate from `getParams()` (default year),
  // so this display reads it the same way to stay in lock-step.
  const levyRate = getParams().medicareLevy.value.rate;

  const rows: EstimateRow[] = [];
  const push = (row: EstimateRow) => rows.push(row);

  // --- Assessable income, by type (FR-12) --------------------------------
  push({
    label: "Assessable income",
    amount: ai.total,
    displayAmount: formatMoney(ai.total),
    kind: "group",
    href: reviewHref,
  });
  push({
    label: "Salary & wages",
    amount: ai.salaryWages,
    displayAmount: formatMoney(ai.salaryWages),
    kind: "sub",
    href: reviewHref,
  });
  if (ai.interest !== 0) {
    push({
      label: "Gross interest",
      amount: ai.interest,
      displayAmount: formatMoney(ai.interest),
      kind: "sub",
      note: interestShareNote(model),
      href: reviewHref,
    });
  }
  if (ai.dividendsGrossedUp !== 0) {
    push({
      label: "Dividends incl. franking credits",
      amount: ai.dividendsGrossedUp,
      displayAmount: formatMoney(ai.dividendsGrossedUp),
      kind: "sub",
      href: reviewHref,
    });
  }
  if (ai.allowances !== 0) {
    push({
      label: "Government allowances",
      amount: ai.allowances,
      displayAmount: formatMoney(ai.allowances),
      kind: "sub",
      href: reviewHref,
    });
  }

  // --- Rental broken out: gross rent − deductions = net result (FR-24) ---
  if (rentalPresent) {
    const gross = rentalGrossIncome(model);
    const deductions = rentalDeductionsTotal(model);
    push({
      label: "Gross rent",
      amount: gross,
      displayAmount: formatMoney(gross),
      kind: "sub",
      href: reviewHref,
    });
    push({
      label: "less Rental deductions",
      amount: -deductions,
      displayAmount: formatMoney(-deductions),
      kind: "sub",
      href: reviewHref,
    });
    push({
      label: "Net rental result",
      amount: ai.netRental,
      displayAmount: formatMoney(ai.netRental),
      kind: "sub",
      note: ai.netRental < 0 ? "— a loss" : undefined,
      href: reviewHref,
    });
  }

  // --- less Deductions → taxable income ---------------------------------
  push({
    label: "less Deductions",
    amount: -assessment.deductionsTotal,
    displayAmount: formatMoney(-assessment.deductionsTotal),
    kind: "line",
    href: reviewHref,
  });
  push({
    label: "Taxable income",
    amount: assessment.taxableIncome,
    displayAmount: formatMoney(assessment.taxableIncome),
    kind: "subtotal",
    href: reviewHref,
  });

  // --- Tax, non-refundable offsets, levies -----------------------------
  push({
    label: "Tax on taxable income",
    amount: assessment.taxOnTaxableIncome,
    displayAmount: formatMoney(assessment.taxOnTaxableIncome),
    kind: "line",
    href: reviewHref,
  });

  const hasNonRefundableOffset =
    assessment.lowIncomeTaxOffset > 0 || assessment.beneficiaryTaxOffset > 0;
  if (assessment.beneficiaryTaxOffset > 0) {
    push({
      label: "less Beneficiary tax offset",
      amount: -assessment.beneficiaryTaxOffset,
      displayAmount: formatMoney(-assessment.beneficiaryTaxOffset),
      kind: "line",
      href: reviewHref,
    });
  }
  if (assessment.lowIncomeTaxOffset > 0) {
    push({
      label: "less Low income tax offset",
      amount: -assessment.lowIncomeTaxOffset,
      displayAmount: formatMoney(-assessment.lowIncomeTaxOffset),
      kind: "line",
      href: reviewHref,
    });
  }
  if (hasNonRefundableOffset) {
    const clamped =
      assessment.nonRefundableOffsetsApplied <
      assessment.lowIncomeTaxOffset + assessment.beneficiaryTaxOffset - 0.005;
    push({
      label: "Tax after offsets",
      amount: assessment.taxAfterNonRefundableOffsets,
      displayAmount: formatMoney(assessment.taxAfterNonRefundableOffsets),
      kind: "subtotal",
      note: clamped ? "— offsets can't reduce tax below zero" : undefined,
      href: reviewHref,
    });
  }

  push({
    label: `plus Medicare levy (${formatRate(levyRate)})`,
    amount: assessment.medicareLevy,
    displayAmount: formatMoney(assessment.medicareLevy),
    kind: "line",
    note: spouse ? "includes your spouse's estimated income" : undefined,
    estimated: spouse || undefined,
    href: reviewHref,
  });

  push(medicareLevySurchargeRow(model, assessment, spouse, reviewHref));

  if (assessment.studyLoanRepayment > 0) {
    push({
      label: "plus Study loan repayment",
      amount: assessment.studyLoanRepayment,
      displayAmount: formatMoney(assessment.studyLoanRepayment),
      kind: "line",
      note: rentalLossAddBack ? "on your repayment income (rental loss added back)" : undefined,
      href: reviewHref,
    });
  }

  push({
    label: "Total tax and levies",
    amount: assessment.totalTaxLiability,
    displayAmount: formatMoney(assessment.totalTaxLiability),
    kind: "subtotal",
    href: reviewHref,
  });

  // --- Credits and the private-health rebate reconciliation -----------
  push({
    label: "less PAYG tax withheld",
    amount: -assessment.paygWithheldCredit,
    displayAmount: formatMoney(-assessment.paygWithheldCredit),
    kind: "line",
    href: reviewHref,
  });
  if (assessment.frankingCreditOffset > 0) {
    push({
      label: "less Franking credits",
      amount: -assessment.frankingCreditOffset,
      displayAmount: formatMoney(-assessment.frankingCreditOffset),
      kind: "line",
      note: "refundable",
      href: reviewHref,
    });
  }

  const phi = assessment.privateHealthRebateReconciliation;
  if (phi && phi.adjustment !== 0) {
    // `net = … − phiRebateAdjustment`, so a positive adjustment behaves like a
    // credit (shown negative); a negative one is a debt (shown positive).
    push({
      label: "Private health rebate adjustment",
      amount: -phi.adjustment,
      displayAmount: formatMoney(-phi.adjustment),
      kind: "line",
      note: phi.adjustment > 0 ? "refundable top-up" : "excess rebate to repay",
      estimated: spouse || undefined,
      href: reviewHref,
    });
  }

  // --- The final assessed position (FR-12) ----------------------------
  const { outcome } = assessment;
  push({
    label: outcome.kind === "refund" ? "Estimated refund" : "Estimated amount owing",
    amount: outcome.amount,
    displayAmount: formatMoney(outcome.amount),
    kind: "net",
  });

  return {
    headline: {
      kind: outcome.kind,
      label: outcome.kind === "refund" ? "Estimated refund" : "Estimated amount owing",
      amount: outcome.amount,
      displayAmount: formatMoney(outcome.amount),
      caveats: buildCaveats(spouse, rentalLossAddBack),
    },
    rows,
    rentalLossAddBack,
  };
}

// ---------------------------------------------------------------------------
// Row-level detail
// ---------------------------------------------------------------------------

/** `"your 50% share"` when exactly one account is jointly held, a generic note for several. */
function interestShareNote(model: ReturnModel): string | undefined {
  const shared = model.income.interestAccounts.filter(
    (a) => a.ownershipSharePercent.value != null && a.ownershipSharePercent.value < 100,
  );
  if (shared.length === 0) return undefined;
  if (shared.length === 1) return `your ${shared[0]!.ownershipSharePercent.value}% share`;
  return "your share of each joint account";
}

function medicareLevySurchargeRow(
  model: ReturnModel,
  assessment: FullAssessment,
  spouse: boolean,
  reviewHref: string,
): EstimateRow {
  const coverDays = model.context.privateHospitalCoverDays.value ?? 0;
  const fullCover = coverDays >= FULL_YEAR_COVER_DAYS;
  let note: string | undefined;
  if (assessment.medicareLevySurcharge === 0) {
    note = fullCover ? "— adequate cover all year" : "— below the surcharge threshold";
  }
  return {
    label: "Medicare levy surcharge",
    amount: assessment.medicareLevySurcharge,
    displayAmount: formatMoney(assessment.medicareLevySurcharge),
    kind: "line",
    note,
    estimated: spouse && assessment.medicareLevySurcharge > 0 ? true : undefined,
    href: reviewHref,
  };
}

function buildCaveats(spouse: boolean, rentalLossAddBack: boolean): string[] {
  const caveats: string[] = [];
  if (spouse) caveats.push("Spouse income is an estimate");
  if (rentalLossAddBack) {
    caveats.push("Net rental loss is added back for the study-loan and surcharge income tests");
  }
  caveats.push(
    "Excludes anything the ATO knows that you haven't entered — prior-year losses, PAYG instalments, loan indexation timing",
  );
  return caveats;
}
