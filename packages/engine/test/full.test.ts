import { describe, expect, it } from "vitest";

import {
  assess,
  computeBeneficiaryTaxOffset,
  computeIncomeTests,
  computeLowIncomeTaxOffset,
  computeMedicareLevy,
  computeStudyLoanRepayment,
} from "../src/full";
import type { EngineInput } from "../src/types";
import { getParams } from "@aus-tax-lodge/params";

const params = getParams();

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
    privateHealth: null,
  },
  deductions: { total: 0 },
  context: {
    residency: "resident-full-year",
    spouseTaxableIncome: null,
    privateHospitalCoverDays: 0,
    holdsStudyLoan: false,
    dependentChildren: 0,
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

// ---------------------------------------------------------------------------
// Medicare levy — shade-in (FR-9)
// ---------------------------------------------------------------------------

describe("Medicare levy — low-income shade-in (single)", () => {
  const ml = params.medicareLevy.value; // lower 28011, upper 35013, rate 0.02, shade-in 0.10

  it("is nil at or below the lower threshold", () => {
    expect(assess(input({ income: { salaryWages: 28_011 } })).medicareLevy).toBe(0);
    expect(assess(input({ income: { salaryWages: 20_000 } })).medicareLevy).toBe(0);
  });

  it("shades in at 10c per $1 over the lower threshold", () => {
    // $30,000: 0.10 * (30000 - 28011) = 198.9, well under the 2% full levy of 600.
    expect(assess(input({ income: { salaryWages: 30_000 } })).medicareLevy).toBeCloseTo(198.9, 2);
  });

  it("meets the full 2% levy at the top of the shade-in band", () => {
    const atUpper = assess(input({ income: { salaryWages: ml.single.upper } })).medicareLevy;
    expect(atUpper).toBeCloseTo(ml.shadeInRate * (ml.single.upper - ml.single.lower), 2);
  });

  it("is a flat 2% of taxable income above the shade-in band", () => {
    expect(assess(input({ income: { salaryWages: 60_000 } })).medicareLevy).toBeCloseTo(1_200, 2);
  });

  it("computeMedicareLevy matches directly", () => {
    expect(computeMedicareLevy(30_000, false, 30_000, 0, ml)).toBeCloseTo(198.9, 2);
  });
});

describe("Medicare levy — family threshold", () => {
  const ml = params.medicareLevy.value;

  it("a low family income removes the levy a single would pay", () => {
    const single = assess(input({ income: { salaryWages: 30_000 } })).medicareLevy;
    const family = assess(
      input({ income: { salaryWages: 30_000 }, context: { spouseTaxableIncome: 10_000 } }),
    ).medicareLevy;
    expect(single).toBeCloseTo(198.9, 2);
    expect(family).toBe(0); // family income 40,000 <= 47,238
  });

  it("dependent children raise the family threshold (sole parent, no spouse)", () => {
    // Taxpayer $30,000, no spouse. 0 children -> single basis, 198.9.
    // 2 children -> family threshold 47,238 + 2*4,338 = 55,914; family income 30,000 -> nil.
    const noKids = assess(input({ income: { salaryWages: 30_000 } })).medicareLevy;
    const twoKids = assess(
      input({ income: { salaryWages: 30_000 }, context: { dependentChildren: 2 } }),
    ).medicareLevy;
    expect(noKids).toBeCloseTo(198.9, 2);
    expect(twoKids).toBe(0);
  });

  it("a high family income still attracts the full 2% levy", () => {
    const family = assess(
      input({ income: { salaryWages: 60_000 }, context: { spouseTaxableIncome: 60_000 } }),
    ).medicareLevy;
    expect(family).toBeCloseTo(ml.rate * 60_000, 2);
  });
});

// ---------------------------------------------------------------------------
// Medicare levy surcharge — per-day for days without cover (FR-9)
// ---------------------------------------------------------------------------

describe("Medicare levy surcharge", () => {
  it("is zero with full-year hospital cover, at every income", () => {
    for (const salary of [90_000, 110_000, 150_000, 200_000]) {
      const r = assess(
        input({ income: { salaryWages: salary }, context: { privateHospitalCoverDays: 365 } }),
      );
      expect(r.medicareLevySurcharge).toBe(0);
    }
  });

  it("is zero below the base-tier threshold even with no cover", () => {
    const r = assess(
      input({ income: { salaryWages: 90_000 }, context: { privateHospitalCoverDays: 0 } }),
    );
    expect(r.medicareLevySurcharge).toBe(0);
  });

  it("applies the tier rate for a full year without cover (tier 1 / 2 / 3)", () => {
    const t1 = assess(
      input({ income: { salaryWages: 110_000 }, context: { privateHospitalCoverDays: 0 } }),
    );
    expect(t1.medicareLevySurcharge).toBeCloseTo(0.01 * 110_000, 2);

    const t2 = assess(
      input({ income: { salaryWages: 150_000 }, context: { privateHospitalCoverDays: 0 } }),
    );
    expect(t2.medicareLevySurcharge).toBeCloseTo(0.0125 * 150_000, 2);

    const t3 = assess(
      input({ income: { salaryWages: 200_000 }, context: { privateHospitalCoverDays: 0 } }),
    );
    expect(t3.medicareLevySurcharge).toBeCloseTo(0.015 * 200_000, 2);
  });

  it("pro-rates to the days without cover", () => {
    const r = assess(
      input({ income: { salaryWages: 150_000 }, context: { privateHospitalCoverDays: 265 } }),
    );
    expect(r.medicareLevySurcharge).toBeCloseTo((0.0125 * 150_000 * 100) / 365, 2);
  });

  it("sets the tier from grossed-up MLS income but levies on taxable income + RFB", () => {
    // Salary 100k + reportable employer super 10k -> MLS income 110k (tier 1),
    // but the surcharge base is taxable income (100k) only.
    const r = assess(
      input({
        income: { salaryWages: 100_000, reportableEmployerSuper: 10_000 },
        context: { privateHospitalCoverDays: 0 },
      }),
    );
    expect(r.incomeTests.mlsIncome).toBe(110_000);
    expect(r.medicareLevySurcharge).toBeCloseTo(0.01 * 100_000, 2);
  });
});

// ---------------------------------------------------------------------------
// Low Income Tax Offset (FR-11)
// ---------------------------------------------------------------------------

describe("Low Income Tax Offset", () => {
  const lito = params.lowIncomeTaxOffset.value;

  it("is the max offset up to the full-offset ceiling", () => {
    expect(assess(input({ income: { salaryWages: 30_000 } })).lowIncomeTaxOffset).toBe(700);
    expect(assess(input({ income: { salaryWages: lito.fullOffsetUpTo } })).lowIncomeTaxOffset).toBe(
      700,
    );
  });

  it("tapers at 5c then 1.5c per $1", () => {
    expect(assess(input({ income: { salaryWages: 40_000 } })).lowIncomeTaxOffset).toBeCloseTo(
      700 - 0.05 * 2_500,
      2,
    );
    expect(assess(input({ income: { salaryWages: 50_000 } })).lowIncomeTaxOffset).toBeCloseTo(
      700 - 0.05 * 7_500 - 0.015 * 5_000,
      2,
    );
  });

  it("never goes below zero and is nil at/after the cut-out", () => {
    expect(computeLowIncomeTaxOffset(lito.cutOut, lito)).toBe(0);
    expect(assess(input({ income: { salaryWages: 80_000 } })).lowIncomeTaxOffset).toBe(0);
  });

  it("does not offset the Medicare levy and cannot create a refund on its own", () => {
    // Taxable income 20,000: tax is 288, LITO 700 -> only 288 applied, no levy.
    const low = assess(input({ income: { salaryWages: 20_000 } }));
    expect(low.lowIncomeTaxOffset).toBe(700);
    expect(low.nonRefundableOffsetsApplied).toBe(288);
    expect(low.taxAfterNonRefundableOffsets).toBe(0);
    expect(low.medicareLevy).toBe(0);

    // Taxable income 29,000: a levy exists and LITO leaves it untouched.
    const withLevy = assess(input({ income: { salaryWages: 29_000 } }));
    expect(withLevy.medicareLevy).toBeCloseTo(0.1 * (29_000 - 28_011), 2);
    expect(withLevy.taxAfterNonRefundableOffsets).toBeCloseTo(0.16 * (29_000 - 18_200) - 700, 2);
  });
});

// ---------------------------------------------------------------------------
// Beneficiary tax offset (FR-11) — params flagged `unverified`
// ---------------------------------------------------------------------------

describe("beneficiary tax offset", () => {
  const bto = params.beneficiaryTaxOffset.value;

  it("is nil at or below the tax-free amount", () => {
    expect(computeBeneficiaryTaxOffset(bto.taxFreeAmount, bto)).toBe(0);
    expect(assess(input({ income: { governmentAllowances: 5_000 } })).beneficiaryTaxOffset).toBe(0);
  });

  it("applies the first component above the tax-free amount", () => {
    // $15,000 of JobSeeker: 0.15 * (15000 - 6000) = 1350; below the $45,000 second threshold.
    expect(
      assess(input({ income: { governmentAllowances: 15_000 } })).beneficiaryTaxOffset,
    ).toBeCloseTo(1_350, 2);
  });

  it("adds the second component above the second-component threshold", () => {
    // $50,000: 0.15*(50000-6000) + 0.15*(50000-45000) = 6600 + 750 = 7350.
    expect(
      assess(input({ income: { governmentAllowances: 50_000 } })).beneficiaryTaxOffset,
    ).toBeCloseTo(7_350, 2);
  });

  it("is non-refundable — computed but only applied against income tax", () => {
    const r = assess(input({ income: { governmentAllowances: 15_000 } }));
    expect(r.beneficiaryTaxOffset).toBeCloseTo(1_350, 2);
    expect(r.taxOnTaxableIncome).toBe(0); // $15,000 is below the tax-free threshold
    expect(r.nonRefundableOffsetsApplied).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Private health insurance rebate reconciliation (FR-11)
// ---------------------------------------------------------------------------

describe("private health rebate reconciliation", () => {
  const phiInput = {
    premiumsEligibleForRebate: 2_000,
    rebateReceived: 300,
    oldestCoveredPersonAge: 40,
  } as const;

  it("is null when the taxpayer had no cover", () => {
    expect(
      assess(input({ income: { salaryWages: 80_000 } })).privateHealthRebateReconciliation,
    ).toBe(null);
  });

  it("computes an entitlement across both adjustment periods", () => {
    const r = assess(input({ income: { salaryWages: 80_000, privateHealth: { ...phiInput } } }));
    const phi = r.privateHealthRebateReconciliation;
    expect(phi).not.toBeNull();
    expect(phi!.periods).toHaveLength(2);
    expect(phi!.tier).toBe("base");
    expect(phi!.ageBracket).toBe("under65");
    // ~24.2% of $2,000 of premium, split over the two periods.
    expect(phi!.entitlement).toBeCloseTo(485, 0);
    expect(phi!.entitlement).toBeCloseTo(
      phi!.periods[0]!.entitlement + phi!.periods[1]!.entitlement,
      2,
    );
  });

  it("a low rebate-received produces a refundable top-up", () => {
    const r = assess(
      input({
        income: { salaryWages: 80_000, privateHealth: { ...phiInput, rebateReceived: 300 } },
      }),
    );
    const phi = r.privateHealthRebateReconciliation!;
    expect(phi.adjustment).toBeGreaterThan(0);
    expect(phi.adjustment).toBeCloseTo(Math.round((phi.entitlement - 300) * 100) / 100, 2);
  });

  it("an over-claimed rebate produces an excess-rebate recovery", () => {
    const r = assess(
      input({
        income: { salaryWages: 80_000, privateHealth: { ...phiInput, rebateReceived: 800 } },
      }),
    );
    const phi = r.privateHealthRebateReconciliation!;
    expect(phi.adjustment).toBeLessThan(0);
  });

  it("the top-up increases the refund; the excess recovery decreases it", () => {
    const topUp = assess(
      input({ income: { salaryWages: 80_000, privateHealth: { ...phiInput, rebateReceived: 0 } } }),
    );
    const excess = assess(
      input({
        income: { salaryWages: 80_000, privateHealth: { ...phiInput, rebateReceived: 2_000 } },
      }),
    );
    // Same everything but the rebate received -> the low-received run nets more back.
    const net = (r: ReturnType<typeof assess>) =>
      r.outcome.kind === "refund" ? -r.outcome.amount : r.outcome.amount;
    expect(net(topUp)).toBeLessThan(net(excess));
  });

  it("apportions the premium by explicit cover days when given", () => {
    const r = assess(
      input({
        income: {
          salaryWages: 80_000,
          privateHealth: {
            ...phiInput,
            coverDaysByPeriod: { firstPeriod: 0, secondPeriod: 90 },
          },
        },
      }),
    );
    const phi = r.privateHealthRebateReconciliation!;
    // All cover in the second period -> the first period contributes nothing.
    expect(phi.periods[0]!.premiumApportioned).toBe(0);
    expect(phi.periods[1]!.premiumApportioned).toBeCloseTo(2_000, 2);
  });
});

// ---------------------------------------------------------------------------
// Study / training support loan repayment (FR-10) — 2025-26 marginal system
// ---------------------------------------------------------------------------

describe("study-loan compulsory repayment", () => {
  const sl = params.studyLoan.value; // min threshold 67,000

  it("is nil when the taxpayer holds no loan", () => {
    expect(
      assess(input({ income: { salaryWages: 120_000 }, context: { holdsStudyLoan: false } }))
        .studyLoanRepayment,
    ).toBe(0);
  });

  it("is nil at exactly the minimum threshold", () => {
    expect(computeStudyLoanRepayment(true, sl.minRepaymentThreshold, sl)).toBe(0);
    expect(
      assess(input({ income: { salaryWages: 67_000 }, context: { holdsStudyLoan: true } }))
        .studyLoanRepayment,
    ).toBe(0);
  });

  it("charges the marginal rate just over the threshold", () => {
    expect(computeStudyLoanRepayment(true, 67_001, sl)).toBeCloseTo(0.15, 2);
  });

  it("is marginal within the first repayment band", () => {
    // $100,000: 0.15 * (100000 - 67000) = 4,950.
    expect(
      assess(input({ income: { salaryWages: 100_000 }, context: { holdsStudyLoan: true } }))
        .studyLoanRepayment,
    ).toBeCloseTo(4_950, 2);
  });

  it("carries the base repayment into the second band", () => {
    // $150,000: 8,700 + 0.17 * (150000 - 125000) = 12,950.
    expect(computeStudyLoanRepayment(true, 150_000, sl)).toBeCloseTo(12_950, 2);
  });

  it("switches to a flat rate on the whole income in the top band", () => {
    // $200,000: 0.10 * 200,000 = 20,000.
    expect(computeStudyLoanRepayment(true, 200_000, sl)).toBeCloseTo(20_000, 2);
  });

  it("is worked out on repayment income — a net rental loss is added back", () => {
    // Salary $100,000, rental loss $40,000 -> taxable income $60,000 (below the
    // threshold) but repayment income $100,000 -> a $4,950 repayment.
    const geared = assess(
      input({
        income: { salaryWages: 100_000, netRentalResult: -40_000 },
        context: { holdsStudyLoan: true },
      }),
    );
    expect(geared.taxableIncome).toBe(60_000);
    expect(geared.incomeTests.repaymentIncome).toBe(100_000);
    expect(geared.studyLoanRepayment).toBeCloseTo(4_950, 2);

    const notGeared = assess(
      input({ income: { salaryWages: 60_000 }, context: { holdsStudyLoan: true } }),
    );
    expect(notGeared.incomeTests.repaymentIncome).toBe(60_000);
    expect(notGeared.studyLoanRepayment).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// FR-23 income tests
// ---------------------------------------------------------------------------

describe("FR-23 income tests", () => {
  it("grosses up taxable income with RFB, reportable super and the rental-loss add-back", () => {
    const tests = computeIncomeTests(80_000, {
      ...BASE.income,
      reportableFringeBenefits: 5_000,
      reportableEmployerSuper: 12_000,
      netRentalResult: -7_000,
    });
    expect(tests.repaymentIncome).toBe(80_000 + 5_000 + 12_000 + 7_000);
    expect(tests.mlsIncome).toBe(tests.repaymentIncome);
    expect(tests.rebateTierIncome).toBe(tests.repaymentIncome);
  });

  it("does not add back a net rental profit", () => {
    const tests = computeIncomeTests(80_000, { ...BASE.income, netRentalResult: 4_000 });
    expect(tests.repaymentIncome).toBe(80_000);
  });

  it("floors the grossed-up figure to whole dollars", () => {
    const tests = computeIncomeTests(80_000, { ...BASE.income, reportableFringeBenefits: 10.9 });
    expect(tests.repaymentIncome).toBe(80_010);
  });
});

// ---------------------------------------------------------------------------
// Franking credits + PAYG + the final result sign (FR-11, FR-12)
// ---------------------------------------------------------------------------

describe("credits and the final outcome", () => {
  it("franking credits are refundable and can produce a refund larger than the tax", () => {
    const r = assess(
      input({
        income: { dividends: { unfranked: 0, franked: 1_000, frankingCredits: 30_000 } },
      }),
    );
    expect(r.frankingCreditOffset).toBe(30_000);
    expect(r.outcome.kind).toBe("refund");
    // tax 2,048 - LITO 700 + levy 298.9 = 1,646.9 liability; less 30,000 credits.
    expect(r.outcome.amount).toBeCloseTo(30_000 - 1_646.9, 2);
  });

  it("PAYG withholding is a credit — under-withholding leaves an amount payable", () => {
    const r = assess(
      input({
        income: { salaryWages: 100_000, paygWithheld: 5_000 },
        context: { privateHospitalCoverDays: 365 },
      }),
    );
    // tax 20,788 + levy 2,000 = 22,788 liability; less 5,000 withheld.
    expect(r.outcome.kind).toBe("payable");
    expect(r.outcome.amount).toBeCloseTo(22_788 - 5_000, 2);
  });

  it("over-withholding produces a refund", () => {
    const r = assess(
      input({
        income: { salaryWages: 100_000, paygWithheld: 30_000 },
        context: { privateHospitalCoverDays: 365 },
      }),
    );
    expect(r.outcome.kind).toBe("refund");
    expect(r.outcome.amount).toBeCloseTo(30_000 - 22_788, 2);
  });

  it("totalTaxLiability and totalCredits reconcile to the outcome", () => {
    const r = assess(
      input({
        income: {
          salaryWages: 95_000,
          paygWithheld: 22_000,
          grossInterest: 320.5,
          dividends: { unfranked: 0, franked: 1_400, frankingCredits: 600 },
          netRentalResult: -8_500,
        },
        deductions: { total: 3_200.75 },
        context: { holdsStudyLoan: true, privateHospitalCoverDays: 365 },
      }),
    );
    const signed = r.outcome.kind === "payable" ? r.outcome.amount : -r.outcome.amount;
    expect(signed).toBeCloseTo(r.totalTaxLiability - r.totalCredits, 2);
  });

  it("calls assessCore first — a non-resident return is hard-stopped", () => {
    expect(() => assess(input({ context: { residency: "non-resident" } }))).toThrow(
      /resident-full-year/,
    );
  });
});
