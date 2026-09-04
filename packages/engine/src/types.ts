/**
 * Types for the deterministic calculation engine (PRD FR-8, FR-13, FR-15,
 * FR-23, FR-24). No LLM is ever in this path.
 *
 * `EngineInput` is the **full** input contract — T4 (levies, offsets, credits,
 * income tests) and T6 (return model → engine input) code against it verbatim.
 * T3 only reads the parts the core calc needs; every field is defined now so
 * downstream tasks have one stable shape.
 *
 * Every monetary field is AUD dollars with cents as the fraction, already
 * consolidated by T6 to a single figure per label (joint-account
 * apportionment, per-employer totals, etc. happen upstream).
 */
import type { IncomeTier, PhiAgeBracket } from "@aus-tax-lodge/params";

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/** Residency-for-tax-purposes for the whole income year (PRD FR-1). */
export type ResidencyStatus = "resident-full-year" | "non-resident" | "part-year-resident";

/** Dividend income, split the way the ATO return asks for it (item 11). */
export interface DividendIncome {
  /** Unfranked dividend amount (label S). */
  readonly unfranked: number;
  /** Franked dividend amount (label T). */
  readonly franked: number;
  /**
   * Franking credits attached to the franked amount (label U). Part of
   * assessable income (the gross-up); becomes a refundable offset in T4.
   */
  readonly frankingCredits: number;
}

/**
 * Private health insurance details from the PHI tax statement, needed for the
 * FR-11 rebate reconciliation. `null` when the taxpayer had no private health
 * cover in the year (the reconciliation is then skipped).
 *
 * `premiumsEligibleForRebate` and `rebateReceived` are the year totals from the
 * statement (T6 sums the statement's per-benefit-code lines into one figure
 * each). `coverDaysByPeriod`, when the statement splits the year at 1 April, lets
 * the reconciliation apportion the premium across the two rebate-adjustment
 * periods by actual cover days rather than by calendar days.
 */
export interface EnginePrivateHealthInput {
  /**
   * Total premiums paid in the year that are eligible for the Australian
   * Government rebate (PHI statement label J across all benefit-code rows).
   */
  readonly premiumsEligibleForRebate: number;
  /**
   * Australian Government rebate already received for the year, as a reduced
   * premium or paid direct (PHI statement label K across all rows).
   */
  readonly rebateReceived: number;
  /**
   * Age of the oldest person covered by the policy, at 30 June. Sets the rebate
   * age bracket (`under65` / `65to69` / `70plus`).
   */
  readonly oldestCoveredPersonAge: number;
  /**
   * Days of hospital/ancillary cover falling in each PHI rebate-adjustment
   * period, when the statement reports them separately. Omit to apportion the
   * premium by the number of calendar days each period contributes to the
   * income year.
   */
  readonly coverDaysByPeriod?: {
    /** Days of cover from 1 July to 31 March. */
    readonly firstPeriod: number;
    /** Days of cover from 1 April to 30 June. */
    readonly secondPeriod: number;
  };
}

export interface EngineIncomeInput {
  /** Salary and wages, all employers combined (item 1). */
  readonly salaryWages: number;
  /**
   * PAYG tax withheld from that salary and wages. A credit against the
   * assessment in T4 — **not** assessable income.
   */
  readonly paygWithheld: number;
  /** Gross interest, already apportioned to the taxpayer's share of any joint account (item 10). */
  readonly grossInterest: number;
  /** Dividends (item 11). */
  readonly dividends: DividendIncome;
  /**
   * Taxable Australian Government working-age allowances — JobSeeker, Youth
   * Allowance, Austudy (item 5 / item 6).
   */
  readonly governmentAllowances: number;
  /**
   * Net rental result from the T7 rental schedule (item 21): gross rent − total
   * rental deductions. **May be negative** (a negatively geared property). Added
   * to assessable income as-is; a net rental loss is added back for the T4
   * income tests (FR-23).
   */
  readonly netRentalResult: number;
  /**
   * Reportable fringe benefits from the income statement. Not assessable income;
   * used only by the T4 income tests (FR-23).
   */
  readonly reportableFringeBenefits: number;
  /**
   * Reportable employer superannuation contributions from the income statement.
   * Not assessable income; used only by the T4 income tests (FR-23).
   */
  readonly reportableEmployerSuper: number;
  /**
   * Private health insurance statement figures for the FR-11 rebate
   * reconciliation. `null` when the taxpayer held no private health cover.
   */
  readonly privateHealth: EnginePrivateHealthInput | null;
}

export interface EngineDeductionsInput {
  /**
   * Total of every confirmed deduction. T6 maps the individual ATO deduction
   * labels (work-related expenses incl. working-from-home fixed-rate, car
   * cents-per-km, travel, clothing/laundry, self-education, gifts/donations,
   * cost of managing tax affairs) onto this single figure — the engine does not
   * need the breakdown.
   */
  readonly total: number;
}

export interface EngineContextInput {
  /**
   * Residency for the full year. T3 supports `"resident-full-year"` only; any
   * other value throws a clear error (non-resident / part-year is out of scope —
   * PRD FR-20).
   */
  readonly residency: ResidencyStatus;
  /**
   * Spouse's taxable income for the year — an estimate the user enters (PRD
   * FR-1, marked "estimated" everywhere it is shown). `null` when the taxpayer
   * has no spouse. Used by the T4 family Medicare levy / surcharge / rebate
   * tests.
   */
  readonly spouseTaxableIncome: number | null;
  /**
   * Number of days in the income year the taxpayer held an appropriate private
   * hospital cover (0–366). Used by the T4 Medicare levy surcharge.
   */
  readonly privateHospitalCoverDays: number;
  /** Whether the taxpayer holds a HELP / study or training support loan (PRD FR-1, FR-10). */
  readonly holdsStudyLoan: boolean;
  /**
   * Number of dependent children for the year. Raises the family Medicare levy
   * reduction threshold (by `familyChildIncrement` per child) and the Medicare
   * levy surcharge / private-health rebate family income thresholds (by
   * `familyChildIncrement` per child *after the first*). Default `0`; a taxpayer
   * with a spouse and/or at least one dependent child is treated as a "family"
   * for the Medicare levy reduction.
   */
  readonly dependentChildren: number;
}

/** The full input to the calculation engine. */
export interface EngineInput {
  readonly income: EngineIncomeInput;
  readonly deductions: EngineDeductionsInput;
  readonly context: EngineContextInput;
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

/** Total assessable income broken out by type (PRD FR-12). */
export interface AssessableIncomeBreakdown {
  /** Salary and wages (item 1). */
  readonly salaryWages: number;
  /** Gross interest (item 10). */
  readonly interest: number;
  /** Dividends grossed up for franking credits: `unfranked + franked + frankingCredits` (item 11). */
  readonly dividendsGrossedUp: number;
  /** Taxable government allowances (item 5 / item 6). */
  readonly allowances: number;
  /** Net rental result (item 21) — may be negative. */
  readonly netRental: number;
  /** Sum of the lines above — total assessable income. */
  readonly total: number;
}

/**
 * The core assessment T3 produces: assessable income → deductions → taxable
 * income → resident income tax on taxable income. Designed to be **extended, not
 * replaced**.
 *
 * T4 introduces `FullAssessment extends CoreAssessment` adding:
 *   // T4: medicareLevy, medicareLevySurcharge, lowIncomeTaxOffset,
 *   //     beneficiaryTaxOffset, privateHealthRebateReconciliation,
 *   //     studyLoanRepayment, frankingCreditOffset, paygWithheldCredit,
 *   //     incomeTests (HELP / MLS / rebate-tier income with the net-rental-loss
 *   //     add-back — FR-23), and the final refund / amount owing.
 */
export interface CoreAssessment {
  readonly assessableIncome: AssessableIncomeBreakdown;
  /** Total deductions applied (kept to the cent). */
  readonly deductionsTotal: number;
  /**
   * Taxable income: `assessable total − deductions`, rounded **down** to a whole
   * dollar and floored at 0, per the FR-15 rounding rules.
   */
  readonly taxableIncome: number;
  /**
   * Resident income tax on `taxableIncome` per the FR-15 resident scale, before
   * any levy, offset or credit.
   */
  readonly taxOnTaxableIncome: number;
}

// ---------------------------------------------------------------------------
// Full assessment (T4 — PRD FR-9, FR-10, FR-11, FR-12, FR-23, FR-24)
// ---------------------------------------------------------------------------

/**
 * The "income for [X] purposes" figures (PRD FR-23), each a whole-dollar amount.
 * In the v1 scope all three share one grossed-up base —
 * `taxable income + reportable fringe benefits + reportable employer super
 * + net rental loss added back` — because net financial-investment losses,
 * reportable personal super and exempt foreign income are all nil (FR-23). They
 * are kept as separate fields because their ATO definitions differ and a future
 * year's dataset may need to diverge them.
 */
export interface IncomeTestResults {
  /** Repayment income for the compulsory study / training support loan repayment (FR-10). */
  readonly repaymentIncome: number;
  /** Income for Medicare levy surcharge purposes — the surcharge tier test (FR-9). */
  readonly mlsIncome: number;
  /** Income for private-health-rebate-tier purposes — the rebate percentage test (FR-11). */
  readonly rebateTierIncome: number;
}

/** One rebate-adjustment period's contribution to the PHI rebate entitlement. */
export interface PhiRebatePeriodEntitlement {
  /** The period label from the params dataset, e.g. `"1 July 2025 to 31 March 2026"`. */
  readonly label: string;
  /** Rebate percentage applied for this period (as the ATO states it, e.g. `24.288`). */
  readonly rebatePercent: number;
  /** Portion of `premiumsEligibleForRebate` apportioned to this period. */
  readonly premiumApportioned: number;
  /** `rebatePercent% × premiumApportioned` — this period's entitlement. */
  readonly entitlement: number;
}

/**
 * FR-11 private health insurance rebate reconciliation: the rebate the taxpayer
 * was *entitled* to (at their FR-23 rebate-tier income and age bracket, across
 * both adjustment periods) against what they *received* as a premium reduction
 * or direct payment.
 */
export interface PrivateHealthRebateReconciliation {
  /** Total rebate entitlement across both adjustment periods. */
  readonly entitlement: number;
  /** Rebate already received (the input figure, echoed for the FR-12 breakdown). */
  readonly received: number;
  /**
   * `entitlement − received`. Positive → a refundable **top-up** that increases
   * the refund; negative → an **excess-rebate recovery** that increases the
   * amount owing.
   */
  readonly adjustment: number;
  /** Rebate tier the taxpayer's FR-23 rebate-tier income falls in. */
  readonly tier: IncomeTier;
  /** Age bracket of the oldest covered person. */
  readonly ageBracket: PhiAgeBracket;
  /** Per-period breakdown, for the FR-12 explanation. */
  readonly periods: readonly PhiRebatePeriodEntitlement[];
}

/** The final assessed position (PRD FR-12). Expressed to the cent (FR-15). */
export interface AssessmentOutcome {
  /** `"refund"` when money comes back to the taxpayer; `"payable"` when money is owed. */
  readonly kind: "refund" | "payable";
  /** The refund or amount owing, as a positive number to the cent. */
  readonly amount: number;
}

/**
 * The full assessment (PRD FR-12): the T3 {@link CoreAssessment} extended with
 * every levy, offset, credit, income test and the final refund / amount owing.
 * Produced by {@link assess}, which calls `assessCore` first.
 *
 * Final equation (FR-15 rounding — levies and offsets on whole-dollar taxable
 * income, franking credits and PAYG to the cent, result to the cent):
 *
 * ```
 * taxAfterNonRefundableOffsets = max(0, taxOnTaxableIncome − lowIncomeTaxOffset − beneficiaryTaxOffset)
 * totalTaxLiability            = taxAfterNonRefundableOffsets + medicareLevy + medicareLevySurcharge + studyLoanRepayment
 * totalCredits                 = frankingCreditOffset + paygWithheldCredit
 * net                          = totalTaxLiability − totalCredits − phiRebateAdjustment
 * net > 0 → payable(net);  net ≤ 0 → refund(−net)
 * ```
 * where `phiRebateAdjustment` is `privateHealthRebateReconciliation.adjustment`
 * (0 when there was no cover).
 */
export interface FullAssessment extends CoreAssessment {
  /** The FR-23 "income for [X] purposes" figures. */
  readonly incomeTests: IncomeTestResults;
  /** Medicare levy after the low-income reduction / shade-in (FR-9). Never negative. */
  readonly medicareLevy: number;
  /** Medicare levy surcharge for the days without adequate private hospital cover (FR-9). */
  readonly medicareLevySurcharge: number;
  /** Low Income Tax Offset actually available (FR-11). Non-refundable; capped so it can't create a refund. */
  readonly lowIncomeTaxOffset: number;
  /** Beneficiary tax offset (FR-11). Non-refundable. `0` unless government allowances are the main income. */
  readonly beneficiaryTaxOffset: number;
  /** `lowIncomeTaxOffset + beneficiaryTaxOffset`, clamped so it can't exceed `taxOnTaxableIncome`. */
  readonly nonRefundableOffsetsApplied: number;
  /** `max(0, taxOnTaxableIncome − nonRefundableOffsetsApplied)`. */
  readonly taxAfterNonRefundableOffsets: number;
  /** FR-11 private-health rebate reconciliation, or `null` when the taxpayer had no cover. */
  readonly privateHealthRebateReconciliation: PrivateHealthRebateReconciliation | null;
  /** Compulsory study / training support loan repayment on repayment income (FR-10). `0` unless `holdsStudyLoan`. */
  readonly studyLoanRepayment: number;
  /** Franking credits from item 11 — a **refundable** offset (FR-11). To the cent. */
  readonly frankingCreditOffset: number;
  /** PAYG tax withheld from salary and wages — a credit against the assessment. To the cent. */
  readonly paygWithheldCredit: number;
  /** `taxAfterNonRefundableOffsets + medicareLevy + medicareLevySurcharge + studyLoanRepayment`. */
  readonly totalTaxLiability: number;
  /** `frankingCreditOffset + paygWithheldCredit`. */
  readonly totalCredits: number;
  /** The final refund or amount owing (FR-12). */
  readonly outcome: AssessmentOutcome;
}

/**
 * The engine's result type. Re-pointed by T4 from {@link CoreAssessment} to
 * {@link FullAssessment} now the full estimate exists; `assessCore` still
 * returns the {@link CoreAssessment} slice for callers that only need it.
 */
export type EngineResult = FullAssessment;
