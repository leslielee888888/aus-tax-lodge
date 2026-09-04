import { describe, expect, it } from "vitest";

import { getParams } from "@aus-tax-lodge/params";

import {
  assessCore,
  computeAssessableIncome,
  computeTaxableIncome,
  residentIncomeTax,
} from "../src/core";
import type { EngineInput } from "../src/types";

const BASE: EngineInput = {
  income: {
    salaryWages: 0,
    paygWithheld: 0,
    grossInterest: 0,
    dividends: { unfranked: 0, franked: 0, frankingCredits: 0 },
    governmentAllowances: 0,
    netRentalResult: 0,
    reportableFringeBenefits: 0,
    reportableEmployerSuper: 0,
  },
  deductions: { total: 0 },
  context: {
    residency: "resident-full-year",
    spouseTaxableIncome: null,
    privateHospitalCoverDays: 0,
    holdsStudyLoan: false,
  },
};

function input(patch: {
  income?: Partial<EngineInput["income"]>;
  deductions?: Partial<EngineInput["deductions"]>;
  context?: Partial<EngineInput["context"]>;
}): EngineInput {
  return {
    income: { ...BASE.income, ...patch.income },
    deductions: { ...BASE.deductions, ...patch.deductions },
    context: { ...BASE.context, ...patch.context },
  };
}

describe("residentIncomeTax — 2025-26 bracket boundaries", () => {
  const brackets = getParams().residentRates.value;

  // taxable income exactly at each threshold and ±1 (PRD FR-15).
  const cases: ReadonlyArray<readonly [income: number, tax: number]> = [
    [18_199, 0],
    [18_200, 0],
    [18_201, 0.16],
    [44_999, 4_287.84],
    [45_000, 4_288],
    [45_001, 4_288.3],
    [134_999, 31_287.7],
    [135_000, 31_288],
    [135_001, 31_288.37],
    [189_999, 51_637.63],
    [190_000, 51_638],
    [190_001, 51_638.45],
  ];

  it.each(cases)("taxable income %d → tax %d", (income, tax) => {
    expect(residentIncomeTax(income, brackets)).toBeCloseTo(tax, 2);
  });

  it("is continuous across each threshold (base tax of a band == tax at its lower edge)", () => {
    for (const bracket of brackets) {
      if (bracket.incomeOver === 0) continue;
      expect(residentIncomeTax(bracket.incomeOver, brackets)).toBeCloseTo(bracket.baseTax, 2);
    }
  });

  it("throws on an empty scale", () => {
    expect(() => residentIncomeTax(50_000, [])).toThrow(/empty/i);
  });
});

describe("assessCore — taxable income", () => {
  it("rounds taxable income down to whole dollars, dropping cents (assessable side)", () => {
    const result = assessCore(input({ income: { salaryWages: 50_000.99 } }));
    expect(result.taxableIncome).toBe(50_000);
    // 4288 + 30% of (50000 - 45000)
    expect(result.taxOnTaxableIncome).toBeCloseTo(5_788, 2);
  });

  it("rounds taxable income down to whole dollars, dropping cents (deductions side)", () => {
    const result = assessCore(
      input({ income: { salaryWages: 50_000 }, deductions: { total: 0.5 } }),
    );
    expect(result.taxableIncome).toBe(49_999);
  });

  it("floors taxable income at 0 and tax at 0 when deductions exceed income", () => {
    const result = assessCore(
      input({ income: { salaryWages: 20_000 }, deductions: { total: 25_000 } }),
    );
    expect(result.assessableIncome.total).toBe(20_000);
    expect(result.taxableIncome).toBe(0);
    expect(result.taxOnTaxableIncome).toBe(0);
  });

  it("a negative net rental result lowers taxable income", () => {
    const geared = assessCore(input({ income: { salaryWages: 90_000, netRentalResult: -10_000 } }));
    const noRental = assessCore(input({ income: { salaryWages: 90_000 } }));

    expect(geared.assessableIncome.netRental).toBe(-10_000);
    expect(geared.assessableIncome.total).toBe(80_000);
    expect(geared.taxableIncome).toBe(80_000);
    expect(geared.taxableIncome).toBeLessThan(noRental.taxableIncome);
    expect(geared.taxOnTaxableIncome).toBeLessThan(noRental.taxOnTaxableIncome);
  });
});

describe("assessCore — assessable income", () => {
  it("includes franking credits in assessable income (gross-up)", () => {
    const withCredits = assessCore(
      input({ income: { dividends: { unfranked: 100, franked: 700, frankingCredits: 300 } } }),
    );
    const withoutCredits = assessCore(
      input({ income: { dividends: { unfranked: 100, franked: 700, frankingCredits: 0 } } }),
    );

    expect(withCredits.assessableIncome.dividendsGrossedUp).toBe(1_100);
    expect(withCredits.assessableIncome.total).toBe(1_100);
    expect(
      withCredits.assessableIncome.dividendsGrossedUp -
        withoutCredits.assessableIncome.dividendsGrossedUp,
    ).toBe(300);
  });

  it("sums salary, interest, grossed-up dividends, allowances and net rental", () => {
    const breakdown = computeAssessableIncome({
      ...BASE.income,
      salaryWages: 80_000,
      grossInterest: 500,
      dividends: { unfranked: 200, franked: 800, frankingCredits: 343 },
      governmentAllowances: 1_000,
      netRentalResult: -5_000,
    });

    expect(breakdown.dividendsGrossedUp).toBe(1_343);
    expect(breakdown.total).toBe(80_000 + 500 + 1_343 + 1_000 - 5_000);
    expect(breakdown.total).toBe(
      breakdown.salaryWages +
        breakdown.interest +
        breakdown.dividendsGrossedUp +
        breakdown.allowances +
        breakdown.netRental,
    );
  });

  it("excludes reportable fringe benefits and reportable employer super (T4 income-test inputs)", () => {
    const result = assessCore(
      input({
        income: {
          salaryWages: 60_000,
          reportableFringeBenefits: 15_000,
          reportableEmployerSuper: 10_000,
        },
      }),
    );
    expect(result.assessableIncome.total).toBe(60_000);
  });
});

describe("assessCore — self-consistency and guards", () => {
  it("taxableIncome == max(0, floor(assessable total − deductions))", () => {
    const result = assessCore(
      input({
        income: { salaryWages: 73_412.61, grossInterest: 88.4, netRentalResult: -1_200.25 },
        deductions: { total: 2_015.9 },
      }),
    );
    const expected = Math.max(
      0,
      Math.floor(result.assessableIncome.total - result.deductionsTotal),
    );
    expect(result.taxableIncome).toBe(expected);
  });

  it("throws a clear error for a non-resident return", () => {
    expect(() => assessCore(input({ context: { residency: "non-resident" } }))).toThrow(
      /resident-full-year/,
    );
  });

  it("throws for a part-year resident return", () => {
    expect(() => assessCore(input({ context: { residency: "part-year-resident" } }))).toThrow(
      /out of scope/,
    );
  });
});

describe("computeTaxableIncome", () => {
  it("floors to whole dollars", () => {
    expect(computeTaxableIncome(100.99, 0)).toBe(100);
  });

  it("never goes below zero", () => {
    expect(computeTaxableIncome(1_000, 5_000)).toBe(0);
  });
});
