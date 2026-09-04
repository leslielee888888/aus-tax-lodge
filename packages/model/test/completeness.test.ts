import { getTaxonomy } from "@aus-tax-lodge/params";
import { describe, expect, it } from "vitest";

import { isReadyForEstimate, requiredLabels } from "../src/completeness";
import {
  assertRentalExpenseKeysMatchTaxonomy,
  computeNetRentalResult,
  createEmptyReturnModel,
  recomputeNetRentalResult,
  RENTAL_EXPENSE_KEYS,
  type RentalScopeGateAnswer,
} from "../src/model";
import { answer, unsetField } from "../src/provenance";
import { conf, FIXTURE_NET_RENTAL_RESULT, fullyPopulatedReturn } from "./fixtures";

const IN_SCOPE_GATE: RentalScopeGateAnswer = {
  solelyOwned: true,
  rentedOrAvailableAllYear: true,
  noPrivateUse: true,
  notBoughtOrSoldThisYear: true,
};

describe("RENTAL_EXPENSE_KEYS ↔ taxonomy (PRD FR-24)", () => {
  it("matches the in-scope rental deduction sub-labels", () => {
    expect(() => assertRentalExpenseKeysMatchTaxonomy()).not.toThrow();
  });

  it("excludes the computed net-rent line and the denied travel line", () => {
    expect(RENTAL_EXPENSE_KEYS).not.toContain("netRent");
    expect(RENTAL_EXPENSE_KEYS).not.toContain("travelExpenses");
  });
});

describe("computeNetRentalResult (PRD FR-24)", () => {
  it("is gross rent + other income − total rental deductions, and may be a loss", () => {
    const schedule = fullyPopulatedReturn().rental;
    expect(computeNetRentalResult(schedule)).toBe(FIXTURE_NET_RENTAL_RESULT); // 26000 − (28000 + 2080)
  });

  it("recomputeNetRentalResult writes a computed-origin field", () => {
    const schedule = recomputeNetRentalResult(fullyPopulatedReturn().rental);
    expect(schedule.netRentalResult.value).toBe(FIXTURE_NET_RENTAL_RESULT);
    expect(schedule.netRentalResult.origin).toEqual({
      kind: "computed",
      from: "gross rent + other rental income − total rental deductions",
    });
  });
});

describe("requiredLabels / isReadyForEstimate (PRD FR-7, FR-24)", () => {
  it("an empty return is not ready and has unsatisfied rows", () => {
    const model = createEmptyReturnModel();
    expect(isReadyForEstimate(model)).toBe(false);
    const rows = requiredLabels(model);
    expect(rows.some((r) => !r.satisfied)).toBe(true);
    expect(rows.map((r) => r.code)).toContain("personalise.residency");
  });

  it("a fully-populated, all-confirmed return is ready", () => {
    const model = fullyPopulatedReturn();
    const unmet = requiredLabels(model).filter((r) => !r.satisfied);
    expect(unmet, JSON.stringify(unmet)).toHaveLength(0);
    expect(isReadyForEstimate(model)).toBe(true);
  });

  it("omits labels that do not apply — no spouse-details row without a spouse", () => {
    expect(requiredLabels(fullyPopulatedReturn()).map((r) => r.code)).not.toContain(
      "spouse.details",
    );
  });

  it("includes the rental schedule and scope gate only when a rental is present", () => {
    const withRental = requiredLabels(fullyPopulatedReturn()).map((r) => r.code);
    expect(withRental).toContain("21");
    expect(withRental).toContain("q.rentalScopeGate");

    const base = fullyPopulatedReturn();
    const codes = requiredLabels({ ...base, rental: { ...base.rental, present: false } }).map(
      (r) => r.code,
    );
    expect(codes).not.toContain("21");
    expect(codes).not.toContain("q.rentalScopeGate");
  });

  it("is not ready until an over-threshold rental repairs line is confirmed a repair", () => {
    const model = fullyPopulatedReturn();
    const expenses = {
      ...model.rental.expenses,
      repairsAndMaintenance: { amount: conf(3_500), source: "agent-statement" as const },
    };
    const withBigRepair = { ...model, rental: { ...model.rental, expenses } };

    expect(isReadyForEstimate(withBigRepair)).toBe(false);
    expect(
      isReadyForEstimate({
        ...withBigRepair,
        rental: { ...withBigRepair.rental, repairsConfirmedNotCapital: true },
      }),
    ).toBe(true);
  });

  it("is not ready until the gap-questionnaire scope gate is answered", () => {
    const model = fullyPopulatedReturn();
    const noGate = {
      ...model,
      questionnaire: {
        ...model.questionnaire,
        rentalScopeGate: unsetField<RentalScopeGateAnswer>(),
      },
    };
    expect(isReadyForEstimate(noGate)).toBe(false);
    expect(
      isReadyForEstimate({
        ...noGate,
        questionnaire: {
          ...noGate.questionnaire,
          rentalScopeGate: answer(unsetField<RentalScopeGateAnswer>(), IN_SCOPE_GATE),
        },
      }),
    ).toBe(true);
  });
});

describe("createEmptyReturnModel", () => {
  it("stamps the model version and target year and leaves every figure unset", () => {
    const model = createEmptyReturnModel();
    expect(model.modelVersion).toBe(1);
    expect(model.targetYear).toBe("2025-26");
    expect(model.income.salaryWages).toEqual([]);
    expect(model.rental.present).toBe(false);
    expect(model.context.residency.status).toBe("unset");
    for (const key of RENTAL_EXPENSE_KEYS) {
      expect(model.rental.expenses[key].amount.status).toBe("unset");
    }
  });

  it("has a row for every in-scope taxonomy label it binds", () => {
    const inScope = new Set(
      getTaxonomy()
        .labels.filter((l) => l.inScope)
        .map((l) => l.code),
    );
    const bound = requiredLabels(fullyPopulatedReturn())
      .map((r) => r.code)
      .filter((c) => inScope.has(c));
    expect(bound).toEqual(expect.arrayContaining(["1", "5", "10L", "11U", "D5", "21", "IT1"]));
  });
});
