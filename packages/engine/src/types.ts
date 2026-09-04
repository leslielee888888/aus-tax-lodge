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

/**
 * What the T3 core calc returns today. Kept as its own name so callers read
 * against a result type; T4 will re-point this (or add `FullAssessment`) once
 * the full estimate exists.
 */
export type EngineResult = CoreAssessment;
