/**
 * The return domain model (PRD FR-1, FR-4, FR-5, FR-6, FR-7, FR-11, FR-22,
 * FR-24).
 *
 * A typed object covering every taxpayer/context detail, income label,
 * deduction label, the rental property schedule shape, private health, and the
 * gap-questionnaire answers, mapped to the 2025-26 ATO individual-return label
 * taxonomy (`@aus-tax-lodge/params` {@link getTaxonomy}). Each figure is a
 * {@link Provenanced} value; the item/label numbers and names live in the
 * taxonomy and are referenced from here, not duplicated — the `code`/`key` in
 * each doc comment is the taxonomy entry the field maps to.
 *
 * This module is the shape only. T7 populates the rental schedule, T11 the
 * extracted figures, T15/T18 the details form and questionnaire; T9 reads it for
 * out-of-scope detection and T8 for validation.
 */
import type { ResidencyStatus } from "@aus-tax-lodge/engine";
import { getTaxonomy, TARGET_YEAR } from "@aus-tax-lodge/params";
import type { RentalScheduleLabel } from "@aus-tax-lodge/params";

import { type Provenanced, unsetField } from "./provenance";
import { RETURN_MODEL_VERSION } from "./version";

// ---------------------------------------------------------------------------
// Domain constants (PRD Q25 / FR-5 / FR-24)
// ---------------------------------------------------------------------------

/**
 * A single "repairs and maintenance" rental line above this amount must be
 * confirmed a genuine repair, not a capital improvement (PRD Q25, FR-24, FR-13).
 * Model-local rather than in `@aus-tax-lodge/params` because it is a workflow
 * threshold, not a tax rate; revisit when real agent statements are seen.
 */
export const RENTAL_REPAIRS_CONFIRMATION_THRESHOLD = 1000;

/**
 * Cents-per-km work-related car claims are capped at this many business
 * kilometres per year (PRD FR-5 — D1, "≤ the annual cap"). The logbook method
 * (uncapped) is out of scope → FR-20.
 */
export const CAR_CENTS_PER_KM_MAX_KM = 5000;

// ---------------------------------------------------------------------------
// Taxpayer & context (PRD FR-1)
// ---------------------------------------------------------------------------

export interface PostalAddress {
  readonly line1: string;
  readonly line2: string;
  readonly suburb: string;
  readonly state: string;
  readonly postcode: string;
  readonly country: string;
}

export interface BankAccount {
  /** 6-digit BSB (validated at entry — PRD FR-1). */
  readonly bsb: string;
  readonly accountNumber: string;
  readonly accountName: string;
}

export interface TaxpayerDetails {
  readonly fullName: Provenanced<string>;
  /** ISO date `YYYY-MM-DD`. */
  readonly dateOfBirth: Provenanced<string>;
  readonly postalAddress: Provenanced<PostalAddress>;
  /** Full TFN. Masked in the UI (last 3) and never added to a prompt (PRD FR-17). */
  readonly taxFileNumber: Provenanced<string>;
  /** Refund destination — BSB + account number (PRD FR-1). */
  readonly refundAccount: Provenanced<BankAccount>;
}

/** Whether the taxpayer had a spouse during the income year (PRD FR-1, taxonomy `personalise.spouse`). */
export type SpouseStatus = "none" | "had-spouse";

export interface SpouseDetails {
  readonly status: Provenanced<SpouseStatus>;
  readonly name: Provenanced<string>;
  /** ISO date `YYYY-MM-DD`. */
  readonly dateOfBirth: Provenanced<string>;
  /** Spouse's taxable income — an estimate the user enters, marked "estimated" everywhere (PRD FR-1, FR-8). */
  readonly estimatedTaxableIncome: Provenanced<number>;
  /** Days the spouse held an appropriate private hospital cover (0–366). */
  readonly privateHospitalCoverDays: Provenanced<number>;
}

export interface ReturnContext {
  /** Taxonomy `personalise.residency`. A non-`resident-full-year` value is out of scope → FR-20. */
  readonly residency: Provenanced<ResidencyStatus>;
  readonly spouse: SpouseDetails;
  /** Whether the taxpayer holds a HELP/HECS or other study/training support loan (PRD FR-1, FR-10). */
  readonly holdsStudyLoan: Provenanced<boolean>;
  /**
   * Days in the income year the taxpayer held an appropriate private hospital
   * cover (0–366). T15 collects the FR-1 cover *dates* and reduces them to this
   * count; the questionnaire (FR-6) confirms them. Drives the Medicare levy
   * surcharge (FR-9).
   */
  readonly privateHospitalCoverDays: Provenanced<number>;
  /** Number of dependent children (taxonomy `IT8`). Raises the family thresholds (FR-9). */
  readonly dependentChildren: Provenanced<number>;
}

// ---------------------------------------------------------------------------
// Income (PRD FR-4)
// ---------------------------------------------------------------------------

/** One employer's salary/wages line (taxonomy `1` + `1.taxWithheld`). */
export interface EmployerIncome {
  /** Stable local id for this employer within the return. */
  readonly id: string;
  readonly payerName: Provenanced<string>;
  /** Payer ABN — carried through to the export (PRD FR-4). */
  readonly payerAbn: Provenanced<string>;
  /** Gross salary and wages from this employer (label `1`). */
  readonly grossSalaryWages: Provenanced<number>;
  /** PAYG tax withheld by this employer (label `1.taxWithheld`). Kept to the cent (FR-15). */
  readonly paygWithheld: Provenanced<number>;
}

/** One interest-bearing account (taxonomy `10L` + `10M`). */
export interface InterestAccount {
  readonly id: string;
  readonly institution: Provenanced<string>;
  readonly accountDescription: Provenanced<string>;
  /** Gross interest credited to the **whole** account for the year (label `10L` basis). */
  readonly grossInterest: Provenanced<number>;
  /** TFN amounts withheld from that interest (label `10M`). */
  readonly tfnAmountsWithheld: Provenanced<number>;
  /**
   * The taxpayer's ownership share of this account, as a percentage 0–100
   * (PRD FR-4 / FR-6 — joint accounts are apportioned to the user's share).
   * `100` for a solely-owned account.
   */
  readonly ownershipSharePercent: Provenanced<number>;
}

/** One dividend-paying holding (taxonomy `11S` / `11T` / `11U` / `11V`). */
export interface DividendHolding {
  readonly id: string;
  readonly company: Provenanced<string>;
  /** Unfranked dividend amount (label `11S`). */
  readonly unfranked: Provenanced<number>;
  /** Franked dividend amount (label `11T`). */
  readonly franked: Provenanced<number>;
  /** Franking credits attached to the franked amount (label `11U`). Kept to the cent (FR-15). */
  readonly frankingCredits: Provenanced<number>;
  /** TFN amounts withheld from the dividends (label `11V`). */
  readonly tfnAmountsWithheld: Provenanced<number>;
}

export interface IncomeSection {
  /** Per-employer salary and wages (taxonomy `1`). Summed for the engine. */
  readonly salaryWages: readonly EmployerIncome[];
  /** Per-account gross interest (taxonomy `10L`). Apportioned by ownership share for the engine. */
  readonly interestAccounts: readonly InterestAccount[];
  /** Per-holding dividends (taxonomy `11`). Summed for the engine. */
  readonly dividends: readonly DividendHolding[];
  /**
   * Taxable Australian Government working-age allowances — JobSeeker, Youth
   * Allowance, Austudy (taxonomy `5`).
   */
  readonly governmentAllowances: Provenanced<number>;
  /** Total reportable fringe benefits from the income statement (taxonomy `IT1`). Feeds the FR-23 income tests. */
  readonly reportableFringeBenefits: Provenanced<number>;
  /** Reportable employer super contributions from the income statement (taxonomy `IT2`). Feeds the FR-23 income tests. */
  readonly reportableEmployerSuper: Provenanced<number>;
}

// ---------------------------------------------------------------------------
// Deductions (PRD FR-5)
// ---------------------------------------------------------------------------

/** A deduction with a substantiation reference and an unsubstantiated flag (PRD FR-5). */
export interface SubstantiatedDeduction {
  readonly amount: Provenanced<number>;
  /** Receipt / logbook / record reference backing the claim. */
  readonly substantiationRef: Provenanced<string>;
  /** `true` when the claim has no substantiation on file — surfaced by validation (FR-13). */
  readonly unsubstantiated: boolean;
}

/** Work-related car expenses, cents-per-km method only (taxonomy `D1`, PRD FR-5). */
export interface CarKmDeduction {
  readonly method: "cents-per-km";
  /** Business kilometres claimed — capped at {@link CAR_CENTS_PER_KM_MAX_KM}. */
  readonly businessKilometres: Provenanced<number>;
  /** Rate per kilometre in dollars for the target year. */
  readonly ratePerKm: Provenanced<number>;
  /** The claim: `min(businessKilometres, cap) × ratePerKm` (use {@link computeCarKmDeduction}). */
  readonly amount: Provenanced<number>;
  readonly substantiationRef: Provenanced<string>;
  readonly unsubstantiated: boolean;
}

/** Working from home, fixed-rate method only — part of "other work-related expenses" (taxonomy `D5`, PRD FR-5). */
export interface WorkFromHomeDeduction {
  readonly method: "fixed-rate";
  /** Hours worked from home in the year (the hours record). */
  readonly hours: Provenanced<number>;
  /** Fixed rate per hour in dollars for the target year. */
  readonly ratePerHour: Provenanced<number>;
  /** The claim: `hours × ratePerHour` (use {@link computeWfhFixedRateDeduction}). */
  readonly amount: Provenanced<number>;
  readonly substantiationRef: Provenanced<string>;
  readonly unsubstantiated: boolean;
}

export interface DeductionsSection {
  /** Work-related car expenses (taxonomy `D1`). */
  readonly workRelatedCar: CarKmDeduction;
  /** Work-related travel expenses (taxonomy `D2`). */
  readonly workRelatedTravel: SubstantiatedDeduction;
  /** Work-related clothing, laundry and dry-cleaning (taxonomy `D3`). */
  readonly workRelatedClothing: SubstantiatedDeduction;
  /** Work-related self-education (taxonomy `D4`). */
  readonly selfEducation: SubstantiatedDeduction;
  /** Other work-related expenses, excluding working from home (taxonomy `D5`). */
  readonly otherWorkRelated: SubstantiatedDeduction;
  /** Working from home, fixed-rate method — also part of taxonomy `D5`. */
  readonly workFromHome: WorkFromHomeDeduction;
  /** Gifts or donations to deductible-gift-recipient bodies (taxonomy `D9`). */
  readonly giftsAndDonations: SubstantiatedDeduction;
  /** Cost of managing tax affairs (taxonomy `D10`). */
  readonly costOfManagingTaxAffairs: SubstantiatedDeduction;
}

// ---------------------------------------------------------------------------
// Rental property schedule — shape only (PRD FR-24; T7 populates)
// ---------------------------------------------------------------------------

/**
 * The in-scope rental deduction sub-labels (taxonomy `rentalSchedule`, item 21).
 * Keyed identically to `getTaxonomy().rentalSchedule` entries of
 * `kind: "deduction"` and `inScope: true` — {@link assertRentalExpenseKeysMatchTaxonomy}
 * pins the two together. `netRent` (computed) and `travelExpenses` (denied,
 * out of scope) are deliberately excluded.
 */
export type RentalExpenseKey =
  | "interestOnLoans"
  | "capitalWorks"
  | "declineInValue"
  | "borrowingExpenses"
  | "advertising"
  | "bodyCorporate"
  | "cleaning"
  | "councilRates"
  | "gardeningLawn"
  | "insurance"
  | "landTax"
  | "legalFees"
  | "pestControl"
  | "agentFees"
  | "repairsAndMaintenance"
  | "stationeryPhonePostage"
  | "waterCharges"
  | "sundryExpenses";

export const RENTAL_EXPENSE_KEYS: readonly RentalExpenseKey[] = [
  "interestOnLoans",
  "capitalWorks",
  "declineInValue",
  "borrowingExpenses",
  "advertising",
  "bodyCorporate",
  "cleaning",
  "councilRates",
  "gardeningLawn",
  "insurance",
  "landTax",
  "legalFees",
  "pestControl",
  "agentFees",
  "repairsAndMaintenance",
  "stationeryPhonePostage",
  "waterCharges",
  "sundryExpenses",
];

/** Where a rental expense figure was sourced (PRD FR-24). */
export type RentalExpenseSource = "agent-statement" | "loan-summary" | "qs-schedule" | "owner-paid";

export interface RentalExpenseLine {
  readonly amount: Provenanced<number>;
  /** Which document (or the owner) this line comes from. `null` until set by T7. */
  readonly source: RentalExpenseSource | null;
}

export interface RentalPropertyIdentity {
  readonly addressLine1: Provenanced<string>;
  readonly suburb: Provenanced<string>;
  readonly state: Provenanced<string>;
  readonly postcode: Provenanced<string>;
  /** ISO date the property first earned rental income / was first available (PRD FR-24). */
  readonly firstEarnedIncomeOn: Provenanced<string>;
}

/**
 * Item 21 rental schedule. `present: false` on a return with no rental — the
 * engine then gets `netRentalResult: 0`. When `present`, every field is filled
 * by T7 from the agent statement, the loan summary and the QS schedule (plus
 * owner-paid lines), and `netRentalResult` is recomputed via
 * {@link recomputeNetRentalResult}.
 */
export interface RentalSchedule {
  readonly present: boolean;
  readonly property: RentalPropertyIdentity;
  /** Scope gate (FR-24 / FR-20): the property is solely owned. */
  readonly soleOwnership: Provenanced<boolean>;
  /** Scope gate: let or genuinely available for rent the whole year. */
  readonly rentedOrAvailableAllYear: Provenanced<boolean>;
  /** Scope gate: no private use during the year. */
  readonly noPrivateUse: Provenanced<boolean>;
  /** Gross rent received / entitled to (taxonomy rental key `grossRent`, paper label P). */
  readonly grossRent: Provenanced<number>;
  /** Other rental-related income — retained bond, insurance payout for lost rent (key `otherRentalIncome`, label P). */
  readonly otherRentalIncome: Provenanced<number>;
  /** Every in-scope rental deduction line, keyed by {@link RentalExpenseKey}. Always holds all keys. */
  readonly expenses: Readonly<Record<RentalExpenseKey, RentalExpenseLine>>;
  /**
   * `true` once the user has confirmed any repairs line over
   * {@link RENTAL_REPAIRS_CONFIRMATION_THRESHOLD} is a genuine repair, not a
   * capital improvement (PRD Q25, FR-24, FR-13).
   */
  readonly repairsConfirmedNotCapital: boolean;
  /**
   * Computed net rental result = gross rent + other income − total rental
   * deductions (key `netRent`, paper label net). May be a loss. Flows into
   * assessable income (FR-8) and the FR-23 net-rental-loss add-back.
   */
  readonly netRentalResult: Provenanced<number>;
}

// ---------------------------------------------------------------------------
// Private health (PRD FR-11)
// ---------------------------------------------------------------------------

/** From the private-health tax statement (taxonomy `phi.policyDetails`). */
export interface PrivateHealthSection {
  /** Whether the taxpayer held private health cover in the year. */
  readonly held: Provenanced<boolean>;
  /** Premiums paid that are eligible for the Australian Government rebate (statement label J). */
  readonly premiumsEligibleForRebate: Provenanced<number>;
  /** Rebate already received as a reduced premium or paid direct (statement label K). */
  readonly rebateReceived: Provenanced<number>;
  /** Age of the oldest person covered by the policy, at 30 June. */
  readonly oldestCoveredPersonAge: Provenanced<number>;
  /** Days of hospital/ancillary cover in the year. */
  readonly coverDays: Provenanced<number>;
}

// ---------------------------------------------------------------------------
// Gap questionnaire answers (PRD FR-6)
// ---------------------------------------------------------------------------

/** The rental scope gate (PRD FR-6 / FR-24) — every part must be `true` to stay in scope. */
export interface RentalScopeGateAnswer {
  readonly solelyOwned: boolean;
  readonly rentedOrAvailableAllYear: boolean;
  readonly noPrivateUse: boolean;
  /** Not bought or sold during the year (a sale is CGT → FR-20). */
  readonly notBoughtOrSoldThisYear: boolean;
}

export interface QuestionnaireAnswers {
  /** Was the taxpayer an Australian resident for tax purposes for the full year? */
  readonly residencyFullYear: Provenanced<boolean>;
  /** The user has supplied their ownership share for every joint interest account. */
  readonly jointAccountSharesProvided: Provenanced<boolean>;
  /** Does the taxpayer hold a HELP/study or training support loan? */
  readonly studyLoanHeld: Provenanced<boolean>;
  /** The user has confirmed their private-hospital-cover dates. */
  readonly privateCoverDatesConfirmed: Provenanced<boolean>;
  /** `true` = no WFH hours were also claimed as a separate expense (guards a double-claim, PRD FR-6). */
  readonly wfhHoursNotDoubleClaimed: Provenanced<boolean>;
  /** The rental scope gate (only asked when the return has a rental). */
  readonly rentalScopeGate: Provenanced<RentalScopeGateAnswer>;
}

// ---------------------------------------------------------------------------
// The return model
// ---------------------------------------------------------------------------

export interface ReturnModel {
  /** {@link RETURN_MODEL_VERSION} the model was written against. */
  readonly modelVersion: number;
  /** ATO income year, e.g. `"2025-26"` — the taxonomy/params version to read. */
  readonly targetYear: string;
  readonly taxpayer: TaxpayerDetails;
  readonly context: ReturnContext;
  readonly income: IncomeSection;
  readonly deductions: DeductionsSection;
  readonly rental: RentalSchedule;
  readonly privateHealth: PrivateHealthSection;
  readonly questionnaire: QuestionnaireAnswers;
}

// ---------------------------------------------------------------------------
// Roll-up helpers
// ---------------------------------------------------------------------------

function num(field: Provenanced<number>): number {
  return field.value ?? 0;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** `min(businessKilometres, cap) × ratePerKm`, to the cent (PRD FR-5 — D1). */
export function computeCarKmDeduction(businessKilometres: number, ratePerKm: number): number {
  return round2(Math.min(businessKilometres, CAR_CENTS_PER_KM_MAX_KM) * ratePerKm);
}

/** `hours × ratePerHour`, to the cent (PRD FR-5 — D5 working from home). */
export function computeWfhFixedRateDeduction(hours: number, ratePerHour: number): number {
  return round2(hours * ratePerHour);
}

/** Sum of every rental expense line's amount, to the cent. */
export function totalRentalDeductions(schedule: RentalSchedule): number {
  return round2(
    RENTAL_EXPENSE_KEYS.reduce((sum, key) => sum + num(schedule.expenses[key].amount), 0),
  );
}

/**
 * Net rental result = `grossRent + otherRentalIncome − totalRentalDeductions`,
 * to the cent. May be negative (PRD FR-24).
 */
export function computeNetRentalResult(schedule: RentalSchedule): number {
  const income = num(schedule.grossRent) + num(schedule.otherRentalIncome);
  return round2(income - totalRentalDeductions(schedule));
}

/**
 * Return the schedule with `netRentalResult` re-proposed from its parts (a
 * {@link ComputedOrigin}), leaving the field `proposed` for the estimate to use.
 */
export function recomputeNetRentalResult(schedule: RentalSchedule): RentalSchedule {
  const value = computeNetRentalResult(schedule);
  return {
    ...schedule,
    netRentalResult: {
      value,
      status: "proposed",
      origin: {
        kind: "computed",
        from: "gross rent + other rental income − total rental deductions",
      },
      proposedValue: value,
      edits: schedule.netRentalResult.edits,
    },
  };
}

/** Sum of the non-rental deduction labels (D1–D10), to the cent. */
export function totalWorkAndPersonalDeductions(deductions: DeductionsSection): number {
  return round2(
    num(deductions.workRelatedCar.amount) +
      num(deductions.workRelatedTravel.amount) +
      num(deductions.workRelatedClothing.amount) +
      num(deductions.selfEducation.amount) +
      num(deductions.otherWorkRelated.amount) +
      num(deductions.workFromHome.amount) +
      num(deductions.giftsAndDonations.amount) +
      num(deductions.costOfManagingTaxAffairs.amount),
  );
}

/** The taxpayer's apportioned share of one account's gross interest (PRD FR-4). */
export function apportionedInterest(account: InterestAccount): number {
  return round2(num(account.grossInterest) * (num(account.ownershipSharePercent) / 100));
}

// ---------------------------------------------------------------------------
// Taxonomy cross-check
// ---------------------------------------------------------------------------

/**
 * Throw if {@link RENTAL_EXPENSE_KEYS} has drifted from the in-scope deduction
 * lines in `getTaxonomy().rentalSchedule`. Called from the test suite so a
 * taxonomy change surfaces here rather than silently dropping a label.
 */
export function assertRentalExpenseKeysMatchTaxonomy(year?: string): void {
  const taxonomyKeys = getTaxonomy(year)
    .rentalSchedule.filter((l: RentalScheduleLabel) => l.kind === "deduction" && l.inScope)
    .map((l) => l.key)
    .sort();
  const modelKeys = [...RENTAL_EXPENSE_KEYS].sort();
  const missing = taxonomyKeys.filter((k) => !modelKeys.includes(k as RentalExpenseKey));
  const extra = modelKeys.filter((k) => !taxonomyKeys.includes(k));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `RENTAL_EXPENSE_KEYS out of sync with the taxonomy — missing: [${missing.join(", ")}], extra: [${extra.join(", ")}]`,
    );
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function emptySubstantiated(): SubstantiatedDeduction {
  return {
    amount: unsetField<number>(),
    substantiationRef: unsetField<string>(),
    unsubstantiated: false,
  };
}

function emptyRentalExpenses(): Record<RentalExpenseKey, RentalExpenseLine> {
  const entries = RENTAL_EXPENSE_KEYS.map(
    (key) => [key, { amount: unsetField<number>(), source: null }] as const,
  );
  return Object.fromEntries(entries) as Record<RentalExpenseKey, RentalExpenseLine>;
}

/** Build a fresh, empty employer line with the given local id. */
export function createEmptyEmployerIncome(id: string): EmployerIncome {
  return {
    id,
    payerName: unsetField<string>(),
    payerAbn: unsetField<string>(),
    grossSalaryWages: unsetField<number>(),
    paygWithheld: unsetField<number>(),
  };
}

/** Build a fresh, empty interest account with the given local id. */
export function createEmptyInterestAccount(id: string): InterestAccount {
  return {
    id,
    institution: unsetField<string>(),
    accountDescription: unsetField<string>(),
    grossInterest: unsetField<number>(),
    tfnAmountsWithheld: unsetField<number>(),
    ownershipSharePercent: unsetField<number>(),
  };
}

/** Build a fresh, empty dividend holding with the given local id. */
export function createEmptyDividendHolding(id: string): DividendHolding {
  return {
    id,
    company: unsetField<string>(),
    unfranked: unsetField<number>(),
    franked: unsetField<number>(),
    frankingCredits: unsetField<number>(),
    tfnAmountsWithheld: unsetField<number>(),
  };
}

/**
 * A brand-new, empty return model for the current target year (PRD FR-16 — a new
 * return). Every figure is `unset`; the income lists are empty; the rental
 * schedule is absent.
 */
export function createEmptyReturnModel(targetYear: string = TARGET_YEAR): ReturnModel {
  return {
    modelVersion: RETURN_MODEL_VERSION,
    targetYear,
    taxpayer: {
      fullName: unsetField<string>(),
      dateOfBirth: unsetField<string>(),
      postalAddress: unsetField<PostalAddress>(),
      taxFileNumber: unsetField<string>(),
      refundAccount: unsetField<BankAccount>(),
    },
    context: {
      residency: unsetField<ResidencyStatus>(),
      spouse: {
        status: unsetField<SpouseStatus>(),
        name: unsetField<string>(),
        dateOfBirth: unsetField<string>(),
        estimatedTaxableIncome: unsetField<number>(),
        privateHospitalCoverDays: unsetField<number>(),
      },
      holdsStudyLoan: unsetField<boolean>(),
      privateHospitalCoverDays: unsetField<number>(),
      dependentChildren: unsetField<number>(),
    },
    income: {
      salaryWages: [],
      interestAccounts: [],
      dividends: [],
      governmentAllowances: unsetField<number>(),
      reportableFringeBenefits: unsetField<number>(),
      reportableEmployerSuper: unsetField<number>(),
    },
    deductions: {
      workRelatedCar: {
        method: "cents-per-km",
        businessKilometres: unsetField<number>(),
        ratePerKm: unsetField<number>(),
        amount: unsetField<number>(),
        substantiationRef: unsetField<string>(),
        unsubstantiated: false,
      },
      workRelatedTravel: emptySubstantiated(),
      workRelatedClothing: emptySubstantiated(),
      selfEducation: emptySubstantiated(),
      otherWorkRelated: emptySubstantiated(),
      workFromHome: {
        method: "fixed-rate",
        hours: unsetField<number>(),
        ratePerHour: unsetField<number>(),
        amount: unsetField<number>(),
        substantiationRef: unsetField<string>(),
        unsubstantiated: false,
      },
      giftsAndDonations: emptySubstantiated(),
      costOfManagingTaxAffairs: emptySubstantiated(),
    },
    rental: {
      present: false,
      property: {
        addressLine1: unsetField<string>(),
        suburb: unsetField<string>(),
        state: unsetField<string>(),
        postcode: unsetField<string>(),
        firstEarnedIncomeOn: unsetField<string>(),
      },
      soleOwnership: unsetField<boolean>(),
      rentedOrAvailableAllYear: unsetField<boolean>(),
      noPrivateUse: unsetField<boolean>(),
      grossRent: unsetField<number>(),
      otherRentalIncome: unsetField<number>(),
      expenses: emptyRentalExpenses(),
      repairsConfirmedNotCapital: false,
      netRentalResult: unsetField<number>(),
    },
    privateHealth: {
      held: unsetField<boolean>(),
      premiumsEligibleForRebate: unsetField<number>(),
      rebateReceived: unsetField<number>(),
      oldestCoveredPersonAge: unsetField<number>(),
      coverDays: unsetField<number>(),
    },
    questionnaire: {
      residencyFullYear: unsetField<boolean>(),
      jointAccountSharesProvided: unsetField<boolean>(),
      studyLoanHeld: unsetField<boolean>(),
      privateCoverDatesConfirmed: unsetField<boolean>(),
      wfhHoursNotDoubleClaimed: unsetField<boolean>(),
      rentalScopeGate: unsetField<RentalScopeGateAnswer>(),
    },
  };
}
