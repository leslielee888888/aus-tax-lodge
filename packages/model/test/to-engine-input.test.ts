import { assess } from "@aus-tax-lodge/engine";
import { describe, expect, it } from "vitest";

import {
  createEmptyReturnModel,
  createEmptyInterestAccount,
  computeCarKmDeduction,
  computeWfhFixedRateDeduction,
} from "../src/model";
import { documentOrigin, propose } from "../src/provenance";
import { MissingFiguresError, toEngineInput } from "../src/to-engine-input";
import { conf, FIXTURE_NET_RENTAL_RESULT, fullyPopulatedReturn } from "./fixtures";

describe("toEngineInput — mapping confirmed figures (PRD FR-4, FR-8)", () => {
  it("maps a fully-populated return and assess() gives a sane assessment", () => {
    const input = toEngineInput(fullyPopulatedReturn());

    // salary summed; interest apportioned 50%; dividends summed; net rental loss.
    expect(input.income.salaryWages).toBe(90_000);
    expect(input.income.paygWithheld).toBe(20_000);
    expect(input.income.grossInterest).toBe(200); // 400 @ 50%
    expect(input.income.dividends).toEqual({ unfranked: 0, franked: 700, frankingCredits: 300 });
    expect(input.income.netRentalResult).toBe(FIXTURE_NET_RENTAL_RESULT);
    // deduction labels summed (car 880 + clothing 250 + WFH 980 + gifts 500), rental excluded.
    expect(input.deductions.total).toBe(2_610);
    expect(input.income.privateHealth).toEqual({
      premiumsEligibleForRebate: 1_800,
      rebateReceived: 400,
      oldestCoveredPersonAge: 40,
    });
    expect(input.context).toEqual({
      residency: "resident-full-year",
      spouseTaxableIncome: null,
      privateHospitalCoverDays: 365,
      holdsStudyLoan: true,
      dependentChildren: 0,
    });

    const assessment = assess(input);
    // assessable = 90000 + 200 + (700 + 300) + 0 - 4080 = 87120; less 2610 deductions.
    expect(assessment.taxableIncome).toBe(84_510);
    expect(assessment.assessableIncome.netRental).toBe(FIXTURE_NET_RENTAL_RESULT);
    // net rental loss added back into the FR-23 income tests.
    expect(assessment.incomeTests.repaymentIncome).toBe(88_590);
    expect(Number.isFinite(assessment.outcome.amount)).toBe(true);
    expect(assessment.outcome.amount).toBeGreaterThan(0);
    expect(["refund", "payable"]).toContain(assessment.outcome.kind);
  });

  it("apportions joint interest per account by ownership share", () => {
    const model = fullyPopulatedReturn();
    const second = {
      ...createEmptyInterestAccount("a2"),
      grossInterest: conf(1_000),
      ownershipSharePercent: conf(100),
    };
    const withTwo = {
      ...model,
      income: { ...model.income, interestAccounts: [model.income.interestAccounts[0]!, second] },
    };
    // 400 @ 50% + 1000 @ 100%
    expect(toEngineInput(withTwo).income.grossInterest).toBe(1_200);
  });

  it("passes spouse taxable income only when the taxpayer had a spouse", () => {
    const model = fullyPopulatedReturn();
    const withSpouse = {
      ...model,
      context: {
        ...model.context,
        spouse: {
          ...model.context.spouse,
          status: conf("had-spouse" as const),
          estimatedTaxableIncome: conf(55_000),
        },
      },
    };
    expect(toEngineInput(withSpouse).context.spouseTaxableIncome).toBe(55_000);
  });

  it("maps net rental result to 0 when the return has no rental", () => {
    const model = fullyPopulatedReturn();
    const noRental = { ...model, rental: { ...model.rental, present: false } };
    expect(toEngineInput(noRental).income.netRentalResult).toBe(0);
  });

  it("throws MissingFiguresError listing every required field still unset", () => {
    const empty = createEmptyReturnModel();
    let error: unknown;
    try {
      toEngineInput(empty);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(MissingFiguresError);
    const fields = (error as MissingFiguresError).fields;
    expect(fields).toEqual(
      expect.arrayContaining([
        "income.governmentAllowances",
        "deductions.workRelatedCar.amount",
        "deductions.costOfManagingTaxAffairs.amount",
        "privateHealth.held",
        "context.residency",
        "context.spouse.status",
        "context.privateHospitalCoverDays",
        "context.holdsStudyLoan",
        "context.dependentChildren",
      ]),
    );
    expect((error as MissingFiguresError).message).toContain("context.residency");
  });

  it("names an unconfirmed per-employer figure by its index", () => {
    const model = fullyPopulatedReturn();
    const brokenEmployer = {
      ...model.income.salaryWages[0]!,
      // proposed but not confirmed
      paygWithheld: propose(
        model.income.salaryWages[0]!.paygWithheld,
        999,
        documentOrigin("d", 1, "999", "low"),
      ),
    };
    const broken = { ...model, income: { ...model.income, salaryWages: [brokenEmployer] } };
    expect(() => toEngineInput(broken)).toThrow(/income\.salaryWages\[0\]\.paygWithheld/);
  });
});

describe("deduction roll-up helpers (PRD FR-5)", () => {
  it("caps cents-per-km at the annual kilometre limit", () => {
    expect(computeCarKmDeduction(1_000, 0.88)).toBe(880);
    expect(computeCarKmDeduction(9_000, 0.88)).toBe(computeCarKmDeduction(5_000, 0.88));
  });

  it("computes the WFH fixed-rate claim from hours and rate", () => {
    expect(computeWfhFixedRateDeduction(1_400, 0.7)).toBe(980);
  });
});
