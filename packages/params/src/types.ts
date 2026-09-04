/**
 * Typed schema for one income year's Australian individual-tax parameter set
 * (PRD FR-15) and the ATO individual-return label taxonomy (PRD §8).
 *
 * This package is **data only** — no calculation logic. The deterministic engine
 * (T3 / T4) reads these values; it never hard-codes a rate or a threshold.
 * Rolling the tool to a new income year is a new dataset under `src/<year>/`
 * plus its golden tests — no engine change (see `README.md`).
 *
 * Every figure or figure group carries {@link Provenance}: the exact ato.gov.au
 * URL it was taken from and the date it was checked. Values that could not be
 * confirmed from a year-stamped ato.gov.au page are marked `unverified` and are
 * listed in `VERIFY-<year>.md` for a human to confirm before the golden set
 * (T5) is trusted.
 */

/** Where a figure (or figure group) came from and when it was checked. */
export interface Provenance {
  /** Exact ato.gov.au URL the figures were read from. */
  readonly source: string;
  /** ISO date (`YYYY-MM-DD`) the value was checked against {@link Provenance.source}. */
  readonly verifiedOn: string;
  /**
   * `true` when the value could not be confirmed from an authoritative,
   * year-stamped ato.gov.au page (e.g. it is derived, or only a secondary
   * source states it). Such values MUST be checked by a human — see
   * `VERIFY-<year>.md`.
   */
  readonly unverified?: boolean;
  /** Human-readable caveat, surfaced in `VERIFY-<year>.md`. */
  readonly note?: string;
}

/** A value plus its {@link Provenance}. */
export interface Sourced<T> extends Provenance {
  readonly value: T;
}

// ---------------------------------------------------------------------------
// Dataset metadata
// ---------------------------------------------------------------------------

export interface ParamsMeta {
  /** ATO income-year label, e.g. `"2025-26"`. */
  readonly targetYear: string;
  /** First day of the income year (`YYYY-MM-DD`). */
  readonly incomeYearStart: string;
  /** Last day of the income year (`YYYY-MM-DD`). */
  readonly incomeYearEnd: string;
  /**
   * Version of this curated dataset. Bumped on any figure change within the
   * same income year (`<year>.<n>`). Shown in the UI and on the export
   * (PRD FR-15).
   */
  readonly paramsVersion: string;
  /** Date the figures were researched / last revised (`YYYY-MM-DD`). */
  readonly researchedOn: string;
  /** Short disclaimer shown wherever the version is displayed. */
  readonly disclaimer: string;
}

// ---------------------------------------------------------------------------
// Resident income tax
// ---------------------------------------------------------------------------

/**
 * One marginal band of the resident individual income tax scale. Tax within the
 * band is `baseTax + rate * (taxableIncome - incomeOver)`, matching the ATO's
 * "\$X plus Yc for each \$1 over \$Z" phrasing.
 */
export interface TaxBracket {
  /** Marginal `rate` applies to each dollar of taxable income above this amount. */
  readonly incomeOver: number;
  /** Cumulative tax once taxable income reaches {@link TaxBracket.incomeOver}. */
  readonly baseTax: number;
  /** Marginal rate as a fraction (e.g. `0.16`). */
  readonly rate: number;
  /** Inclusive upper limit of the band; `null` for the top band. Informational. */
  readonly upTo: number | null;
}

// ---------------------------------------------------------------------------
// Medicare levy (PRD FR-9)
// ---------------------------------------------------------------------------

/** Lower / upper income limits of a Medicare levy reduction band. */
export interface MedicareLevyBand {
  /** At or below this income: no levy. */
  readonly lower: number;
  /** Above this income: the full levy rate. Between the two: the shade-in applies. */
  readonly upper: number;
}

export interface MedicareLevyParams {
  /** Full levy rate as a fraction (`0.02`). */
  readonly rate: number;
  /**
   * Shade-in ("phase-in") rate: for income between the lower and upper
   * thresholds the levy is `shadeInRate * (income - lower)`. The ATO sets each
   * upper threshold at `1.25 x lower`, i.e. a shade-in rate of `0.10`.
   */
  readonly shadeInRate: number;
  /** Single, not entitled to SAPTO / not a pensioner. */
  readonly single: MedicareLevyBand;
  /** Single and entitled to the seniors and pensioners tax offset (SAPTO). */
  readonly singleSeniorPensioner: MedicareLevyBand;
  /** Family (has a spouse and/or dependants), no SAPTO entitlement. */
  readonly family: MedicareLevyBand;
  /** Family and entitled to SAPTO. */
  readonly familySeniorPensioner: MedicareLevyBand;
  /** Amount each family threshold rises per dependent child. */
  readonly familyChildIncrement: MedicareLevyBand;
}

// ---------------------------------------------------------------------------
// Medicare levy surcharge (PRD FR-9, FR-23)
// ---------------------------------------------------------------------------

export type IncomeTier = "base" | "tier1" | "tier2" | "tier3";

/** One surcharge tier, tested against "income for MLS purposes" (FR-23). */
export interface MlsTier {
  readonly tier: IncomeTier;
  /** Inclusive lower bound of the single income range. */
  readonly singleFrom: number;
  /** Inclusive upper bound of the single income range; `null` for the top tier. */
  readonly singleTo: number | null;
  /** Inclusive lower bound of the family income range. */
  readonly familyFrom: number;
  /** Inclusive upper bound of the family income range; `null` for the top tier. */
  readonly familyTo: number | null;
  /** Surcharge rate as a fraction (`0`, `0.01`, `0.0125`, `0.015`). */
  readonly rate: number;
}

export interface MedicareLevySurchargeParams {
  /**
   * Amount the family income thresholds rise for **each** Medicare levy
   * surcharge dependent child **after the first**.
   */
  readonly familyChildIncrement: number;
  readonly tiers: readonly MlsTier[];
}

// ---------------------------------------------------------------------------
// Private health insurance rebate (PRD FR-11)
// ---------------------------------------------------------------------------

export type PhiAgeBracket = "under65" | "65to69" | "70plus";

export interface PhiIncomeTier {
  readonly tier: IncomeTier;
  readonly singleFrom: number;
  readonly singleTo: number | null;
  readonly familyFrom: number;
  readonly familyTo: number | null;
}

/**
 * One rebate-adjustment period. The rebate percentage is re-indexed on 1 April,
 * so an income year spans two periods.
 */
export interface PhiRebatePeriod {
  /** Human-readable span, e.g. `"1 July 2025 to 31 March 2026"`. */
  readonly label: string;
  /** First day the percentages apply (`YYYY-MM-DD`). */
  readonly startDate: string;
  /** Last day the percentages apply (`YYYY-MM-DD`). */
  readonly endDate: string;
  /**
   * Rebate **percentage** (as the ATO states it, e.g. `24.288` — not `0.24288`)
   * keyed by the age of the oldest person on the policy, then by income tier.
   */
  readonly rebatePercent: Readonly<Record<PhiAgeBracket, Readonly<Record<IncomeTier, number>>>>;
}

export interface PrivateHealthRebateParams {
  /** Amount the family income thresholds rise per MLS dependent child after the first. */
  readonly familyChildIncrement: number;
  readonly incomeTiers: readonly PhiIncomeTier[];
  /** The rebate-adjustment periods that fall within the income year (two). */
  readonly periods: readonly PhiRebatePeriod[];
}

// ---------------------------------------------------------------------------
// Low Income Tax Offset (PRD FR-11)
// ---------------------------------------------------------------------------

export interface LitoTaper {
  /** Reduction starts once taxable income exceeds this amount. */
  readonly incomeOver: number;
  /** Reduction stops at this income (the next taper, or the cut-out). */
  readonly incomeUpTo: number;
  /** Reduction per \$1 of income in the band, as a fraction (e.g. `0.05`). */
  readonly rate: number;
}

export interface LowIncomeTaxOffsetParams {
  /** Maximum offset. */
  readonly maxOffset: number;
  /** Full offset for taxable income at or below this amount. */
  readonly fullOffsetUpTo: number;
  /** Ordered taper bands from {@link LowIncomeTaxOffsetParams.fullOffsetUpTo} to {@link LowIncomeTaxOffsetParams.cutOut}. */
  readonly tapers: readonly LitoTaper[];
  /** Offset is nil for taxable income above this amount. */
  readonly cutOut: number;
}

// ---------------------------------------------------------------------------
// Beneficiary tax offset (PRD FR-11)
// ---------------------------------------------------------------------------

/**
 * Non-refundable offset that shields taxable Australian Government allowances
 * (item 5 / item 6) from tax when they are the taxpayer's main income.
 *
 * Offset = `firstComponentRate * max(0, rebatableBenefits - taxFreeAmount)`
 *   plus, if `rebatableBenefits > secondComponentThreshold`,
 *   `secondComponentRate * (rebatableBenefits - secondComponentThreshold)`.
 *
 * It cannot reduce the Medicare levy and any excess is not refundable.
 */
export interface BeneficiaryTaxOffsetParams {
  /** No offset at or below this amount of rebatable benefits. */
  readonly taxFreeAmount: number;
  /** First-component rate as a fraction. */
  readonly firstComponentRate: number;
  /**
   * Income at which the second component starts — the top of the lowest
   * marginal-rate band (`$45,000` since 2020-21).
   */
  readonly secondComponentThreshold: number;
  /** Second-component rate as a fraction. */
  readonly secondComponentRate: number;
}

// ---------------------------------------------------------------------------
// Study and training support loan repayment (PRD FR-10)
// ---------------------------------------------------------------------------

/**
 * One repayment band. From the 2025-26 income year the compulsory repayment is
 * **marginal** — charged only on repayment income above the minimum threshold.
 *
 * Repayment within a band is:
 *   - `flatRateOnTotal` set  -> `flatRateOnTotal * repaymentIncome` (top band); else
 *   - `baseRepayment + marginalRate * (repaymentIncome - marginalOver)`.
 */
export interface StudyLoanBand {
  /** Inclusive lower bound of the repayment-income range. */
  readonly incomeFrom: number;
  /** Inclusive upper bound; `null` for the top band. */
  readonly incomeTo: number | null;
  /** Fixed repayment carried into this band. */
  readonly baseRepayment: number;
  /** Marginal rate as a fraction on income above {@link StudyLoanBand.marginalOver}. */
  readonly marginalRate: number;
  /** Income above which {@link StudyLoanBand.marginalRate} applies. */
  readonly marginalOver: number;
  /** Set on the top band: repayment is this fraction of the whole repayment income. */
  readonly flatRateOnTotal: number | null;
}

export interface StudyLoanParams {
  /** `"marginal"` from 2025-26; `"flat-rate"` for 2024-25 and earlier. */
  readonly system: "marginal" | "flat-rate";
  /** Repayment income at or below this amount: no compulsory repayment. */
  readonly minRepaymentThreshold: number;
  readonly bands: readonly StudyLoanBand[];
}

// ---------------------------------------------------------------------------
// Rounding rules (PRD FR-15)
// ---------------------------------------------------------------------------

export interface RoundingParams {
  /** Taxable income is rounded **down** to a whole dollar before tax is worked out. */
  readonly taxableIncome: "floor-to-whole-dollar";
  /** Income tax, Medicare levy, surcharge and offsets are computed on that whole-dollar taxable income. */
  readonly taxLeviesAndOffsets: "computed-on-whole-dollar-taxable-income";
  /** Franking credits and PAYG withholding are kept to the cent. */
  readonly frankingCreditsAndWithholding: "keep-cents";
  /** The final assessment result (refund or amount owing) is expressed to the cent. */
  readonly finalResult: "keep-cents";
  /** Compulsory study-loan repayment is worked out on whole-dollar repayment income. */
  readonly studyLoanRepaymentIncome: "floor-to-whole-dollar";
  /** Notes / edge cases. */
  readonly notes: readonly string[];
}

// ---------------------------------------------------------------------------
// The full parameter set
// ---------------------------------------------------------------------------

export interface TaxParams {
  readonly meta: ParamsMeta;
  readonly residentRates: Sourced<readonly TaxBracket[]>;
  readonly medicareLevy: Sourced<MedicareLevyParams>;
  readonly medicareLevySurcharge: Sourced<MedicareLevySurchargeParams>;
  readonly privateHealthRebate: Sourced<PrivateHealthRebateParams>;
  readonly lowIncomeTaxOffset: Sourced<LowIncomeTaxOffsetParams>;
  readonly beneficiaryTaxOffset: Sourced<BeneficiaryTaxOffsetParams>;
  readonly studyLoan: Sourced<StudyLoanParams>;
  readonly rounding: Sourced<RoundingParams>;
}

// ---------------------------------------------------------------------------
// ATO individual-return label taxonomy (PRD §8)
// ---------------------------------------------------------------------------

/** myTax on-screen sections, in the order they are presented (PRD FR-14). */
export type MyTaxSection =
  | "personalise"
  | "income"
  | "deductions"
  | "tax-losses"
  | "tax-offsets"
  | "adjustments"
  | "medicare-and-phi"
  | "spouse-and-income-tests"
  | "estimate";

/** One item / label on the individual return. */
export interface ReturnLabel {
  /** ATO code — item number or label, e.g. `"1"`, `"10L"`, `"D9"`, `"M1"`, `"IT1"`. */
  readonly code: string;
  /** ATO name of the item / label. */
  readonly name: string;
  /** Which myTax section it appears in. */
  readonly section: MyTaxSection;
  /** `"main"` return or `"supplement"` (supplementary section). */
  readonly form: "main" | "supplement";
  /** Whether this tool populates / calculates the label in the current scope. */
  readonly inScope: boolean;
  /** Scope / handling note. */
  readonly note?: string;
}

/** How a rental-schedule line rolls up to the paper item-21 labels. */
export type RentalPaperLabel = "P" | "Q" | "F" | "U" | "net";

/** One line of the rental property schedule (item 21). */
export interface RentalScheduleLabel {
  /** Stable key for this line within the schedule. */
  readonly key: string;
  /** Display name (agent statements / QS schedules use varying wording). */
  readonly name: string;
  readonly kind: "income" | "deduction" | "computed";
  /** Paper item-21 label this line is summed into. */
  readonly paperLabel: RentalPaperLabel;
  readonly inScope: boolean;
  readonly note?: string;
}

export interface LabelTaxonomy extends Provenance {
  /** myTax sections in on-screen order (drives the export layout, PRD FR-14). */
  readonly myTaxSectionOrder: readonly MyTaxSection[];
  readonly labels: readonly ReturnLabel[];
  /** Item 21 rental property schedule — income + deduction sub-labels. */
  readonly rentalSchedule: readonly RentalScheduleLabel[];
}

// ---------------------------------------------------------------------------
// One year's complete curated dataset
// ---------------------------------------------------------------------------

export interface YearDataset {
  readonly params: TaxParams;
  readonly taxonomy: LabelTaxonomy;
}
