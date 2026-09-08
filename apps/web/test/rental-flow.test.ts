/**
 * T25 — rental property web-flow wiring (PRD FR-24).
 *
 * A fully-completed, negatively-geared rental return reaches the estimate, is
 * not export-blocked, and produces a non-null export `rentalSchedule` carrying
 * the expected net loss.
 *
 * (The v1 `extractFigures` rental-routing coverage that used to sit here moved
 * to `rental-intake.test.ts` when the six-step wizard was removed — the chat
 * folds rental documents in through `lib/rental-intake.ts` now.)
 */
import { assess, getTaxonomy, PARAMS_VERSION } from "@aus-tax-lodge/engine";
import {
  isReadyForEstimate,
  recomputeNetRentalResult,
  RENTAL_EXPENSE_KEYS,
  toEngineInput,
  type ReturnModel,
} from "@aus-tax-lodge/model";
import { buildReturnJson } from "@aus-tax-lodge/export";
import { isExportBlocked, validateReturn } from "@aus-tax-lodge/validation";
import { describe, expect, it } from "vitest";

import { confirmedField, notApplicable, answered } from "./review-fixtures";
import { exportableModel } from "./export-fixtures";

/**
 * `exportableModel()` (readyModel + taxpayer identity) plus a fully-confirmed
 * rental: gross rent $24,000, interest $30,000, agent fees $2,000 → a net
 * rental loss of −$8,000. Every other rental expense line is nil.
 */
function negativelyGearedRental(): ReturnModel {
  const base = exportableModel();
  const expenses = { ...base.rental.expenses };
  for (const key of RENTAL_EXPENSE_KEYS) {
    expenses[key] = { amount: notApplicable<number>(), source: null };
  }
  expenses.interestOnLoans = { amount: confirmedField(30_000), source: "loan-summary" };
  expenses.agentFees = { amount: confirmedField(2_000), source: "agent-statement" };

  const rental = recomputeNetRentalResult({
    ...base.rental,
    present: true,
    property: {
      addressLine1: confirmedField("10 Landlord Ln"),
      suburb: confirmedField("Brunswick"),
      state: confirmedField("VIC"),
      postcode: confirmedField("3056"),
      firstEarnedIncomeOn: confirmedField("2019-07-01"),
    },
    soleOwnership: confirmedField(true),
    rentedOrAvailableAllYear: confirmedField(true),
    noPrivateUse: confirmedField(true),
    grossRent: confirmedField(24_000),
    otherRentalIncome: notApplicable<number>(),
    expenses,
    repairsConfirmedNotCapital: false,
  });

  return {
    ...base,
    rental,
    questionnaire: {
      ...base.questionnaire,
      rentalScopeGate: answered({
        solelyOwned: true,
        rentedOrAvailableAllYear: true,
        noPrivateUse: true,
        notBoughtOrSoldThisYear: true,
      }),
    },
  };
}

describe("a completed negatively-geared rental return (PRD FR-24)", () => {
  it("reaches the estimate, is not export-blocked, and exports a net rental loss of −$8,000", () => {
    const model = negativelyGearedRental();

    // net rental result = 24,000 − (30,000 + 2,000) = −8,000
    expect(model.rental.netRentalResult.value).toBe(-8_000);

    expect(isReadyForEstimate(model)).toBe(true);

    const assessment = assess(toEngineInput(model));
    const issues = validateReturn(model, assessment);
    expect(isExportBlocked(issues)).toBe(false);

    const json = buildReturnJson({
      model,
      assessment,
      taxonomy: getTaxonomy(model.targetYear),
      paramsVersion: PARAMS_VERSION,
      targetYear: model.targetYear,
      documents: [],
      acknowledgedWarningIds: [],
      statedAssumptions: [],
    });
    expect(json.rentalSchedule).not.toBeNull();
    expect(json.rentalSchedule!.netRentalResult).toBe(-8_000);
  });
});
