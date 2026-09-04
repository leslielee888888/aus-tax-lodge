/**
 * Full assessment (PRD FR-9, FR-10, FR-11, FR-12, FR-23, FR-24): everything from
 * whole-dollar taxable income to the final refund / amount owing — Medicare levy
 * + surcharge, the Low Income Tax Offset, the beneficiary tax offset, the
 * private-health rebate reconciliation, the compulsory study-loan repayment, the
 * franking-credit and PAYG credits, and the FR-23 "income for [X] purposes"
 * figures with the net-rental-loss add-back.
 *
 * Pure functions only, no `any`, no LLM. Every rate and threshold is read from
 * `@aus-tax-lodge/params` (PRD FR-15). {@link assess} calls `assessCore` first
 * and never reimplements it.
 */
import { getParams } from "@aus-tax-lodge/params";
import type {
  BeneficiaryTaxOffsetParams,
  IncomeTier,
  LowIncomeTaxOffsetParams,
  MedicareLevyParams,
  MedicareLevySurchargeParams,
  PhiAgeBracket,
  PrivateHealthRebateParams,
  StudyLoanParams,
} from "@aus-tax-lodge/params";

import { assessCore } from "./core";
import type {
  AssessmentOutcome,
  EngineIncomeInput,
  EngineInput,
  EnginePrivateHealthInput,
  FullAssessment,
  IncomeTestResults,
  PhiRebatePeriodEntitlement,
  PrivateHealthRebateReconciliation,
} from "./types";

/**
 * The Medicare levy surcharge is a per-day charge over a fixed 365-day year
 * (PRD FR-9). The 2025-26 income year is not a leap year, so this also equals
 * the number of days in it.
 */
const MLS_YEAR_DAYS = 365;

/** Round a monetary amount to whole cents, absorbing binary-float noise (FR-15). */
function round2(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Inclusive whole-day span between two `YYYY-MM-DD` dates (both parsed as UTC). */
function daysInclusive(startIso: string, endIso: string): number {
  const start = Date.parse(`${startIso}T00:00:00Z`);
  const end = Date.parse(`${endIso}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000) + 1;
}

// ---------------------------------------------------------------------------
// FR-23 — "income for [X] purposes"
// ---------------------------------------------------------------------------

/**
 * The FR-23 income-test figures. In the v1 scope all three share one grossed-up
 * base — taxable income + reportable fringe benefits + reportable employer super
 * + any net rental loss added back — because net financial-investment losses,
 * reportable personal super contributions and exempt foreign income are all nil
 * and treated as 0 (FR-23). Rounded **down** to whole dollars
 * (`rounding.studyLoanRepaymentIncome`, applied to all three for consistency).
 */
export function computeIncomeTests(
  taxableIncome: number,
  income: EngineIncomeInput,
): IncomeTestResults {
  const netRentalLossAddBack = income.netRentalResult < 0 ? -income.netRentalResult : 0;
  const base = Math.floor(
    taxableIncome +
      income.reportableFringeBenefits +
      income.reportableEmployerSuper +
      netRentalLossAddBack,
  );
  return { repaymentIncome: base, mlsIncome: base, rebateTierIncome: base };
}

// ---------------------------------------------------------------------------
// Income-tier lookup (Medicare levy surcharge + private-health rebate)
// ---------------------------------------------------------------------------

interface TierBounds {
  readonly tier: IncomeTier;
  readonly singleFrom: number;
  readonly singleTo: number | null;
  readonly familyFrom: number;
  readonly familyTo: number | null;
}

/**
 * Find the income tier `testIncome` falls in. For a family, every threshold
 * except the base-tier floor of 0 is raised by `familyThresholdBump` (the
 * per-child increment applied by the caller). The base tier starts at 0 and the
 * top tier is open-ended, so a non-negative income always lands.
 */
function findIncomeTier<T extends TierBounds>(
  tiers: readonly T[],
  testIncome: number,
  isFamily: boolean,
  familyThresholdBump: number,
): T {
  for (const t of tiers) {
    const rawFrom = isFamily ? t.familyFrom : t.singleFrom;
    const rawTo = isFamily ? t.familyTo : t.singleTo;
    const from = t.tier === "base" ? rawFrom : rawFrom + familyThresholdBump;
    const to = rawTo === null ? null : rawTo + familyThresholdBump;
    if (testIncome >= from && (to === null || testIncome <= to)) {
      return t;
    }
  }
  throw new Error(
    `no income tier matched test income ${testIncome} — check the tier ranges (FR-9/FR-11)`,
  );
}

// ---------------------------------------------------------------------------
// FR-9 — Medicare levy
// ---------------------------------------------------------------------------

/**
 * Medicare levy after the low-income reduction / shade-in (PRD FR-9).
 *
 * On any basis the levy is `min(shadeInRate × (testIncome − lowerThreshold),
 * rate × yourTaxableIncome)`, and nil when `testIncome ≤ lowerThreshold`. For a
 * single, `testIncome` is the taxpayer's own taxable income against the single
 * threshold. For a family it is the combined family taxable income against the
 * family threshold (raised per dependent child). A family taxpayer receives
 * whichever basis leaves the lower levy — the ATO lets a partnered low earner
 * still benefit from the single low-income reduction.
 */
export function computeMedicareLevy(
  taxableIncome: number,
  isFamily: boolean,
  familyIncome: number,
  dependentChildren: number,
  ml: MedicareLevyParams,
): number {
  const fullLevy = ml.rate * taxableIncome;

  const onBasis = (testIncome: number, lowerThreshold: number): number => {
    if (testIncome <= lowerThreshold) return 0;
    return Math.min(ml.shadeInRate * (testIncome - lowerThreshold), fullLevy);
  };

  const single = onBasis(taxableIncome, ml.single.lower);
  if (!isFamily) return round2(single);

  const familyThreshold = ml.family.lower + dependentChildren * ml.familyChildIncrement.lower;
  return round2(Math.min(single, onBasis(familyIncome, familyThreshold)));
}

// ---------------------------------------------------------------------------
// FR-9 — Medicare levy surcharge
// ---------------------------------------------------------------------------

/**
 * Medicare levy surcharge for the days without adequate private hospital cover
 * (PRD FR-9). The FR-23 MLS income (family-combined when partnered) sets the
 * tier; the surcharge itself is levied on `taxable income + reportable fringe
 * benefits` for `daysWithoutCover / 365` of the year (ATO: the surcharge base is
 * *not* the grossed-up MLS income).
 */
export function computeMedicareLevySurcharge(
  taxableIncome: number,
  reportableFringeBenefits: number,
  mlsIncome: number,
  isFamily: boolean,
  familyMlsIncome: number,
  dependentChildren: number,
  privateHospitalCoverDays: number,
  mls: MedicareLevySurchargeParams,
  medicareLevySingleLowerThreshold: number,
): number {
  const daysWithoutCover = clamp(MLS_YEAR_DAYS - privateHospitalCoverDays, 0, MLS_YEAR_DAYS);
  if (daysWithoutCover === 0) return 0;

  // ATO: in a family, no surcharge if the taxpayer's *own* MLS income is at or
  // below the Medicare levy single lower threshold, even when family income is
  // over the family threshold.
  if (isFamily && mlsIncome <= medicareLevySingleLowerThreshold) return 0;

  const bump = isFamily ? Math.max(0, dependentChildren - 1) * mls.familyChildIncrement : 0;
  const testIncome = isFamily ? familyMlsIncome : mlsIncome;
  const tier = findIncomeTier(mls.tiers, testIncome, isFamily, bump);
  if (tier.rate === 0) return 0;

  const surchargeBase = taxableIncome + reportableFringeBenefits;
  return round2(tier.rate * surchargeBase * (daysWithoutCover / MLS_YEAR_DAYS));
}

// ---------------------------------------------------------------------------
// FR-11 — Low Income Tax Offset
// ---------------------------------------------------------------------------

/**
 * Low Income Tax Offset available at `taxableIncome` (PRD FR-11). Non-refundable
 * and does not offset the Medicare levy — the caller applies it against income
 * tax only.
 */
export function computeLowIncomeTaxOffset(
  taxableIncome: number,
  lito: LowIncomeTaxOffsetParams,
): number {
  if (taxableIncome <= lito.fullOffsetUpTo) return lito.maxOffset;
  if (taxableIncome >= lito.cutOut) return 0;

  let offset = lito.maxOffset;
  for (const taper of lito.tapers) {
    if (taxableIncome > taper.incomeOver) {
      const upper = Math.min(taxableIncome, taper.incomeUpTo);
      offset -= (upper - taper.incomeOver) * taper.rate;
    }
  }
  return round2(Math.max(0, offset));
}

// ---------------------------------------------------------------------------
// FR-11 — Beneficiary tax offset
// ---------------------------------------------------------------------------

/**
 * Beneficiary tax offset on rebatable benefits (taxable Australian Government
 * allowances, item 5 / item 6) — PRD FR-11. Non-refundable and cannot offset the
 * Medicare levy.
 *
 * NOTE: the 2025-26 params for this offset are flagged `unverified` — the ATO no
 * longer publishes the formula on a year-stamped page (see `VERIFY-2025-26.md`,
 * row A). Used exactly as the dataset gives it.
 */
export function computeBeneficiaryTaxOffset(
  rebatableBenefits: number,
  bto: BeneficiaryTaxOffsetParams,
): number {
  if (rebatableBenefits <= bto.taxFreeAmount) return 0;

  let offset = bto.firstComponentRate * (rebatableBenefits - bto.taxFreeAmount);
  if (rebatableBenefits > bto.secondComponentThreshold) {
    offset += bto.secondComponentRate * (rebatableBenefits - bto.secondComponentThreshold);
  }
  return round2(offset);
}

// ---------------------------------------------------------------------------
// FR-11 — Private health insurance rebate reconciliation
// ---------------------------------------------------------------------------

function phiAgeBracket(age: number): PhiAgeBracket {
  if (age >= 70) return "70plus";
  if (age >= 65) return "65to69";
  return "under65";
}

/**
 * Reconcile the private-health rebate (PRD FR-11): the entitlement at the
 * taxpayer's FR-23 rebate-tier income and age bracket, across both 2025-26
 * rebate-adjustment periods, against the rebate already received.
 *
 * The year's eligible premium is apportioned across the two periods by
 * `coverDaysByPeriod` when the statement provides it, otherwise by the number of
 * calendar days each period contributes to the income year.
 */
export function reconcilePrivateHealthRebate(
  privateHealth: EnginePrivateHealthInput,
  rebateTierIncome: number,
  isFamily: boolean,
  familyRebateTierIncome: number,
  dependentChildren: number,
  phi: PrivateHealthRebateParams,
  incomeYearStart: string,
  incomeYearEnd: string,
): PrivateHealthRebateReconciliation {
  const ageBracket = phiAgeBracket(privateHealth.oldestCoveredPersonAge);
  const bump = isFamily ? Math.max(0, dependentChildren - 1) * phi.familyChildIncrement : 0;
  const testIncome = isFamily ? familyRebateTierIncome : rebateTierIncome;
  const tier = findIncomeTier(phi.incomeTiers, testIncome, isFamily, bump).tier;

  const byPeriod = privateHealth.coverDaysByPeriod;
  const coverDaysTotal = byPeriod ? byPeriod.firstPeriod + byPeriod.secondPeriod : 0;
  const yearDays = daysInclusive(incomeYearStart, incomeYearEnd);

  const periods: PhiRebatePeriodEntitlement[] = phi.periods.map((period, index) => {
    const weight =
      byPeriod && coverDaysTotal > 0
        ? (index === 0 ? byPeriod.firstPeriod : byPeriod.secondPeriod) / coverDaysTotal
        : daysInclusive(period.startDate, period.endDate) / yearDays;

    const premiumApportioned = round2(privateHealth.premiumsEligibleForRebate * weight);
    const rebatePercent = period.rebatePercent[ageBracket][tier];
    const entitlement = round2((rebatePercent / 100) * premiumApportioned);
    return { label: period.label, rebatePercent, premiumApportioned, entitlement };
  });

  const entitlement = round2(periods.reduce((sum, p) => sum + p.entitlement, 0));
  const received = round2(privateHealth.rebateReceived);

  return {
    entitlement,
    received,
    adjustment: round2(entitlement - received),
    tier,
    ageBracket,
    periods,
  };
}

// ---------------------------------------------------------------------------
// FR-10 — Compulsory study / training support loan repayment
// ---------------------------------------------------------------------------

/**
 * Compulsory study / training support loan repayment on FR-23 repayment income
 * (PRD FR-10) — the 2025-26 **marginal** system: charged only on repayment
 * income above the minimum threshold. `0` unless the taxpayer holds a loan.
 */
export function computeStudyLoanRepayment(
  holdsStudyLoan: boolean,
  repaymentIncome: number,
  sl: StudyLoanParams,
): number {
  if (!holdsStudyLoan) return 0;
  if (repaymentIncome <= sl.minRepaymentThreshold) return 0;

  const band = sl.bands.find(
    (b) =>
      repaymentIncome >= b.incomeFrom && (b.incomeTo === null || repaymentIncome <= b.incomeTo),
  );
  if (!band) {
    throw new Error(
      `no study-loan repayment band matched repayment income ${repaymentIncome} (FR-10)`,
    );
  }

  if (band.flatRateOnTotal !== null) {
    return round2(band.flatRateOnTotal * repaymentIncome);
  }
  return round2(band.baseRepayment + band.marginalRate * (repaymentIncome - band.marginalOver));
}

// ---------------------------------------------------------------------------
// The full assessment
// ---------------------------------------------------------------------------

/**
 * Run the full assessment for a resident-full-year individual (PRD FR-12).
 * Calls {@link assessCore} first (assessable income → deductions → whole-dollar
 * taxable income → resident income tax), then layers on every levy, offset,
 * credit and income test and computes the final refund or amount owing.
 *
 * @throws if `context.residency` is not `"resident-full-year"` (via `assessCore`).
 */
export function assess(input: EngineInput): FullAssessment {
  const core = assessCore(input);
  const params = getParams();
  const { income, context } = input;

  // A taxpayer with a spouse and/or at least one dependent child is a "family"
  // for the Medicare levy reduction and the MLS / rebate family thresholds.
  const isFamily = context.spouseTaxableIncome !== null || context.dependentChildren > 0;
  const spouseIncome = context.spouseTaxableIncome ?? 0;

  const incomeTests = computeIncomeTests(core.taxableIncome, income);

  // Family income tests approximate the spouse's income-for-[X]-purposes with
  // their estimated taxable income (the only spouse figure the tool collects).
  const familyIncomeForLevy = core.taxableIncome + spouseIncome;
  const familyMlsIncome = incomeTests.mlsIncome + spouseIncome;
  const familyRebateTierIncome = incomeTests.rebateTierIncome + spouseIncome;

  const medicareLevy = computeMedicareLevy(
    core.taxableIncome,
    isFamily,
    familyIncomeForLevy,
    context.dependentChildren,
    params.medicareLevy.value,
  );

  const medicareLevySurcharge = computeMedicareLevySurcharge(
    core.taxableIncome,
    income.reportableFringeBenefits,
    incomeTests.mlsIncome,
    isFamily,
    familyMlsIncome,
    context.dependentChildren,
    context.privateHospitalCoverDays,
    params.medicareLevySurcharge.value,
    params.medicareLevy.value.single.lower,
  );

  const lowIncomeTaxOffset = computeLowIncomeTaxOffset(
    core.taxableIncome,
    params.lowIncomeTaxOffset.value,
  );
  const beneficiaryTaxOffset = computeBeneficiaryTaxOffset(
    income.governmentAllowances,
    params.beneficiaryTaxOffset.value,
  );

  const nonRefundableOffsetsApplied = round2(
    Math.min(core.taxOnTaxableIncome, lowIncomeTaxOffset + beneficiaryTaxOffset),
  );
  const taxAfterNonRefundableOffsets = round2(
    Math.max(0, core.taxOnTaxableIncome - nonRefundableOffsetsApplied),
  );

  const privateHealthRebateReconciliation: PrivateHealthRebateReconciliation | null =
    income.privateHealth
      ? reconcilePrivateHealthRebate(
          income.privateHealth,
          incomeTests.rebateTierIncome,
          isFamily,
          familyRebateTierIncome,
          context.dependentChildren,
          params.privateHealthRebate.value,
          params.meta.incomeYearStart,
          params.meta.incomeYearEnd,
        )
      : null;

  const studyLoanRepayment = computeStudyLoanRepayment(
    context.holdsStudyLoan,
    incomeTests.repaymentIncome,
    params.studyLoan.value,
  );

  const frankingCreditOffset = round2(income.dividends.frankingCredits);
  const paygWithheldCredit = round2(income.paygWithheld);

  const totalTaxLiability = round2(
    taxAfterNonRefundableOffsets + medicareLevy + medicareLevySurcharge + studyLoanRepayment,
  );
  const totalCredits = round2(frankingCreditOffset + paygWithheldCredit);
  const phiRebateAdjustment = privateHealthRebateReconciliation?.adjustment ?? 0;

  const net = round2(totalTaxLiability - totalCredits - phiRebateAdjustment);
  const outcome: AssessmentOutcome =
    net > 0 ? { kind: "payable", amount: net } : { kind: "refund", amount: round2(-net) };

  return {
    ...core,
    incomeTests,
    medicareLevy,
    medicareLevySurcharge,
    lowIncomeTaxOffset,
    beneficiaryTaxOffset,
    nonRefundableOffsetsApplied,
    taxAfterNonRefundableOffsets,
    privateHealthRebateReconciliation,
    studyLoanRepayment,
    frankingCreditOffset,
    paygWithheldCredit,
    totalTaxLiability,
    totalCredits,
    outcome,
  };
}
