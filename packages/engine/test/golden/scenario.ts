/**
 * Golden-set scenario model (PRD T5 — "Calculation accuracy" non-functional,
 * FR-8–FR-11, FR-15, FR-23, FR-24).
 *
 * Each scenario is a worked example whose `expected` figures come from an
 * **authoritative source** (the ATO published rates/rules pages, or the ATO
 * online calculators where they cover the case) — recorded verbatim in `source`
 * and hand-worked there. **No `expected` value is ever produced by running
 * `assess()`** — that would defeat the purpose of the golden set.
 *
 * The golden runner (`../golden.test.ts`) feeds `input` through `assess()` and
 * asserts every `expected` field within its `tolerance` (default $0). A mismatch
 * fails `npm test` — this suite is the release gate for the engine.
 */
import type { EngineInput, FullAssessment } from "../../src/types";

/**
 * A single numeric output of {@link FullAssessment} a scenario can pin.
 *
 * `outcomeSigned` is the final assessed position as one signed number:
 * **positive = amount payable, negative = refund** (`payable` → `+amount`,
 * `refund` → `-amount`). It is the end-to-end check; the component fields
 * localise a failure.
 */
export type GoldenField =
  | "assessableIncomeTotal"
  | "netRental"
  | "taxableIncome"
  | "taxOnTaxableIncome"
  | "medicareLevy"
  | "medicareLevySurcharge"
  | "lowIncomeTaxOffset"
  | "beneficiaryTaxOffset"
  | "nonRefundableOffsetsApplied"
  | "taxAfterNonRefundableOffsets"
  | "studyLoanRepayment"
  | "frankingCreditOffset"
  | "paygWithheldCredit"
  | "repaymentIncome"
  | "mlsIncome"
  | "rebateTierIncome"
  | "phiRebateEntitlement"
  | "phiRebateAdjustment"
  | "totalTaxLiability"
  | "totalCredits"
  | "outcomeSigned";

/** Read one {@link GoldenField} off a {@link FullAssessment}. */
export function readField(a: FullAssessment, field: GoldenField): number {
  switch (field) {
    case "assessableIncomeTotal":
      return a.assessableIncome.total;
    case "netRental":
      return a.assessableIncome.netRental;
    case "taxableIncome":
      return a.taxableIncome;
    case "taxOnTaxableIncome":
      return a.taxOnTaxableIncome;
    case "medicareLevy":
      return a.medicareLevy;
    case "medicareLevySurcharge":
      return a.medicareLevySurcharge;
    case "lowIncomeTaxOffset":
      return a.lowIncomeTaxOffset;
    case "beneficiaryTaxOffset":
      return a.beneficiaryTaxOffset;
    case "nonRefundableOffsetsApplied":
      return a.nonRefundableOffsetsApplied;
    case "taxAfterNonRefundableOffsets":
      return a.taxAfterNonRefundableOffsets;
    case "studyLoanRepayment":
      return a.studyLoanRepayment;
    case "frankingCreditOffset":
      return a.frankingCreditOffset;
    case "paygWithheldCredit":
      return a.paygWithheldCredit;
    case "repaymentIncome":
      return a.incomeTests.repaymentIncome;
    case "mlsIncome":
      return a.incomeTests.mlsIncome;
    case "rebateTierIncome":
      return a.incomeTests.rebateTierIncome;
    case "phiRebateEntitlement":
      return a.privateHealthRebateReconciliation?.entitlement ?? Number.NaN;
    case "phiRebateAdjustment":
      return a.privateHealthRebateReconciliation?.adjustment ?? 0;
    case "totalTaxLiability":
      return a.totalTaxLiability;
    case "totalCredits":
      return a.totalCredits;
    case "outcomeSigned":
      return a.outcome.kind === "payable" ? a.outcome.amount : -a.outcome.amount;
  }
}

export interface Scenario {
  /** Stable id, e.g. `"G07"`. */
  readonly id: string;
  /** One-line human description. */
  readonly description: string;
  /**
   * The authoritative origin of every `expected` figure below, with the
   * hand-working shown. ATO rates pages / calculators — never `assess()`.
   */
  readonly source: string;
  readonly input: EngineInput;
  /** Expected engine outputs. Fields not listed are not asserted. */
  readonly expected: Partial<Record<GoldenField, number>>;
  /**
   * Per-field absolute tolerance in dollars. Omitted field → $0 (exact to the
   * dollar / cent). Per the accuracy bar, only the Medicare levy surcharge and
   * the PHI rebate reconciliation may carry a documented ≤ $1 tolerance.
   */
  readonly tolerance?: Partial<Record<GoldenField, number>>;
  /**
   * Set when `assess()` is known to disagree with the authoritative value and
   * the cause is a defect in the engine / params (T2–T4), not this test. The
   * runner then expects the assertion to fail (`it.fails`) so the scenario still
   * documents the correct answer and screams if the engine result later changes.
   * Every such scenario is listed in the PR body.
   */
  readonly defect?: string;
}
