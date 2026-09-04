import { PARAMS_VERSION, TARGET_YEAR, getParams } from "@aus-tax-lodge/params";

import { assessCore } from "./core";
import type { EngineInput } from "./types";
import { ENGINE_VERSION } from "./version";

/**
 * A single worked example run through the core calc (PRD FR-8): a salaried
 * taxpayer with bank interest, franked dividends and a negatively geared rental.
 * T5 replaces this with the full ~30–35-case golden set and wires it as a
 * release gate.
 */
const WORKED_EXAMPLE: EngineInput = {
  income: {
    salaryWages: 95_000,
    paygWithheld: 22_000,
    grossInterest: 320.5,
    dividends: { unfranked: 0, franked: 1_400, frankingCredits: 600 },
    governmentAllowances: 0,
    netRentalResult: -8_500,
    reportableFringeBenefits: 0,
    reportableEmployerSuper: 0,
  },
  deductions: { total: 3_200.75 },
  context: {
    residency: "resident-full-year",
    spouseTaxableIncome: null,
    privateHospitalCoverDays: 365,
    holdsStudyLoan: true,
  },
};

function money(amount: number): string {
  return amount.toLocaleString("en-AU", { style: "currency", currency: "AUD" });
}

/**
 * The report the CLI harness (`bin/harness.ts`) prints. A pure function so tests
 * can assert on it without spawning a process.
 */
export function buildHarnessReport(): string {
  const params = getParams();
  const result = assessCore(WORKED_EXAMPLE);
  const income = result.assessableIncome;

  return [
    "aus-tax-lodge engine harness — core calc (T3)",
    `engine version: ${ENGINE_VERSION}`,
    `target income year: ${TARGET_YEAR}`,
    `tax-parameter set: ${PARAMS_VERSION} (researched ${params.meta.researchedOn}, pending human verification)`,
    "",
    "worked example — salaried taxpayer, bank interest, franked dividends, negatively geared rental:",
    `  salary & wages                             ${money(income.salaryWages)}`,
    `  gross interest                             ${money(income.interest)}`,
    `  dividends (grossed up for franking credits) ${money(income.dividendsGrossedUp)}`,
    `  government allowances                      ${money(income.allowances)}`,
    `  net rental result                         ${money(income.netRental)}`,
    `  = total assessable income                  ${money(income.total)}`,
    `  − total deductions                         ${money(result.deductionsTotal)}`,
    `  = taxable income (rounded down to whole dollars) ${money(result.taxableIncome)}`,
    `  resident income tax on taxable income      ${money(result.taxOnTaxableIncome)}`,
    "",
    "next: Medicare levy + surcharge, LITO, beneficiary offset, PHI rebate,",
    "study-loan repayment, credits, the FR-23 income tests and the final",
    "refund / amount owing are added by T4 (FullAssessment).",
  ].join("\n");
}
