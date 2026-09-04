import { PARAMS_VERSION, TARGET_YEAR, getParams } from "@aus-tax-lodge/params";

import { assess } from "./full";
import type { EngineInput } from "./types";
import { ENGINE_VERSION } from "./version";

/**
 * A single worked example run through the full assessment (PRD FR-12): a
 * salaried taxpayer with bank interest, franked dividends, a negatively geared
 * rental, a HELP loan and full-year private hospital cover. T5 replaces this
 * with the full ~30–35-case golden set and wires it as a release gate.
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
    privateHealth: {
      premiumsEligibleForRebate: 2_400,
      rebateReceived: 570,
      oldestCoveredPersonAge: 42,
    },
  },
  deductions: { total: 3_200.75 },
  context: {
    residency: "resident-full-year",
    spouseTaxableIncome: null,
    privateHospitalCoverDays: 365,
    holdsStudyLoan: true,
    dependentChildren: 0,
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
  const result = assess(WORKED_EXAMPLE);
  const income = result.assessableIncome;
  const phi = result.privateHealthRebateReconciliation;

  const lines: string[] = [
    "aus-tax-lodge engine harness — full assessment (T4)",
    `engine version: ${ENGINE_VERSION}`,
    `target income year: ${TARGET_YEAR}`,
    `tax-parameter set: ${PARAMS_VERSION} (researched ${params.meta.researchedOn}, pending human verification)`,
    "",
    "worked example — salaried taxpayer, bank interest, franked dividends, negatively geared rental, HELP loan:",
    `  salary & wages                              ${money(income.salaryWages)}`,
    `  gross interest                              ${money(income.interest)}`,
    `  dividends (grossed up for franking credits) ${money(income.dividendsGrossedUp)}`,
    `  government allowances                       ${money(income.allowances)}`,
    `  net rental result                          ${money(income.netRental)}`,
    `  = total assessable income                  ${money(income.total)}`,
    `  − total deductions                         ${money(result.deductionsTotal)}`,
    `  = taxable income (whole dollars)           ${money(result.taxableIncome)}`,
    "",
    "  income for [X] purposes (FR-23):",
    `    repayment income                         ${money(result.incomeTests.repaymentIncome)}`,
    `    income for MLS purposes                  ${money(result.incomeTests.mlsIncome)}`,
    `    income for rebate-tier purposes          ${money(result.incomeTests.rebateTierIncome)}`,
    "",
    `  resident income tax on taxable income      ${money(result.taxOnTaxableIncome)}`,
    `  − low income tax offset                    ${money(result.lowIncomeTaxOffset)}`,
    `  − beneficiary tax offset                   ${money(result.beneficiaryTaxOffset)}`,
    `  = tax after non-refundable offsets         ${money(result.taxAfterNonRefundableOffsets)}`,
    `  + Medicare levy                            ${money(result.medicareLevy)}`,
    `  + Medicare levy surcharge                  ${money(result.medicareLevySurcharge)}`,
    `  + study-loan compulsory repayment          ${money(result.studyLoanRepayment)}`,
    `  = total tax liability                      ${money(result.totalTaxLiability)}`,
    `  − franking credits (refundable)            ${money(result.frankingCreditOffset)}`,
    `  − PAYG tax withheld                        ${money(result.paygWithheldCredit)}`,
  ];

  if (phi) {
    lines.push(
      `  private health rebate — entitlement       ${money(phi.entitlement)}`,
      `  private health rebate — received          ${money(phi.received)}`,
      `  private health rebate — ${phi.adjustment >= 0 ? "top-up (refundable)   " : "excess recovered      "}   ${money(phi.adjustment)}`,
    );
  }

  lines.push(
    "",
    `  => ${result.outcome.kind === "refund" ? "estimated refund" : "estimated amount owing"}: ${money(result.outcome.amount)}`,
    "",
    "This is an estimate, not the ATO's assessment. The ATO may know things the",
    "tool does not (prior-year losses, indexation timing, PAYG instalments).",
  );

  return lines.join("\n");
}
