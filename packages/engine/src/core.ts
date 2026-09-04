/**
 * Core deterministic calculation (PRD FR-8, FR-13, FR-15): total assessable
 * income → total deductions → taxable income (whole-dollar, floored at 0) →
 * resident income tax on taxable income.
 *
 * Pure functions only, no `any`, no LLM. Every rate and threshold is read from
 * `@aus-tax-lodge/params` (PRD FR-15) — nothing is hard-coded here.
 *
 * TODO(T4): extend this into the full estimate — Medicare levy + surcharge,
 * LITO, beneficiary offset, PHI rebate reconciliation, study-loan repayment,
 * franking-credit + PAYG credits, the FR-23 income tests with the
 * net-rental-loss add-back, and the final refund / amount owing.
 */
import { getParams } from "@aus-tax-lodge/params";
import type { TaxBracket } from "@aus-tax-lodge/params";

import type {
  AssessableIncomeBreakdown,
  CoreAssessment,
  DividendIncome,
  EngineIncomeInput,
  EngineInput,
} from "./types";

/** Franking gross-up: `unfranked + franked + frankingCredits` (PRD FR-8). */
export function grossUpDividends(dividends: DividendIncome): number {
  return dividends.unfranked + dividends.franked + dividends.frankingCredits;
}

/**
 * Total assessable income and its breakdown (PRD FR-8, FR-12). The net rental
 * result is added as-is and may be negative. Reportable fringe benefits and
 * reportable employer super are deliberately excluded — they are income-test
 * inputs (FR-23, T4), not assessable income.
 */
export function computeAssessableIncome(income: EngineIncomeInput): AssessableIncomeBreakdown {
  const salaryWages = income.salaryWages;
  const interest = income.grossInterest;
  const dividendsGrossedUp = grossUpDividends(income.dividends);
  const allowances = income.governmentAllowances;
  const netRental = income.netRentalResult;

  return {
    salaryWages,
    interest,
    dividendsGrossedUp,
    allowances,
    netRental,
    total: salaryWages + interest + dividendsGrossedUp + allowances + netRental,
  };
}

/**
 * Taxable income = assessable income − deductions, rounded **down** to a whole
 * dollar (FR-15) and floored at 0.
 */
export function computeTaxableIncome(assessableTotal: number, deductionsTotal: number): number {
  return Math.max(0, Math.floor(assessableTotal - deductionsTotal));
}

/**
 * Resident income tax on a whole-dollar taxable income, applying the FR-15
 * resident scale. Each band is `baseTax + rate * (taxableIncome - incomeOver)`,
 * matching the ATO's "$X plus Yc for each $1 over $Z" phrasing.
 */
export function residentIncomeTax(taxableIncome: number, brackets: readonly TaxBracket[]): number {
  if (brackets.length === 0) {
    throw new Error("resident tax scale is empty — check the tax-parameter dataset (FR-15)");
  }

  const ascending = [...brackets].sort((a, b) => a.incomeOver - b.incomeOver);
  let applicable: TaxBracket | undefined;
  for (const bracket of ascending) {
    if (taxableIncome >= bracket.incomeOver) {
      applicable = bracket;
    }
  }

  if (!applicable) {
    throw new Error(
      `no resident tax bracket covers taxable income ${taxableIncome} — the scale must start at 0 (FR-15)`,
    );
  }

  return applicable.baseTax + applicable.rate * (taxableIncome - applicable.incomeOver);
}

/**
 * Run the core calc for a resident-full-year individual.
 *
 * @throws if `context.residency` is not `"resident-full-year"` (PRD FR-20), or
 * if the active dataset's taxable-income rounding rule is one this engine does
 * not implement.
 */
export function assessCore(input: EngineInput): CoreAssessment {
  const { income, deductions, context } = input;

  if (context.residency !== "resident-full-year") {
    throw new Error(
      `The calculation engine supports resident-full-year returns only (PRD FR-20). ` +
        `Got residency "${context.residency}" — non-resident and part-year returns are out of scope ` +
        `and must be hard-stopped upstream.`,
    );
  }

  const params = getParams();

  const roundingRule = params.rounding.value.taxableIncome;
  if (roundingRule !== "floor-to-whole-dollar") {
    throw new Error(
      `Engine implements "floor-to-whole-dollar" taxable income only; ` +
        `active dataset (${params.meta.paramsVersion}) specifies "${roundingRule}".`,
    );
  }

  const assessableIncome = computeAssessableIncome(income);
  const deductionsTotal = deductions.total;
  const taxableIncome = computeTaxableIncome(assessableIncome.total, deductionsTotal);
  const taxOnTaxableIncome = residentIncomeTax(taxableIncome, params.residentRates.value);

  return { assessableIncome, deductionsTotal, taxableIncome, taxOnTaxableIncome };
}
