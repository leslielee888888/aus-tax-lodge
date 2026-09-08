/**
 * #83 (folded into T8) — the rental scope gate in the conversational interview.
 *
 * The four scope-gate booleans (#83 / PRD FR-6, FR-24) arrive through the same
 * `applyInterviewField` allow-list as every other interview answer. In scope,
 * settling all four lets the deterministic completeness gate pass; any
 * out-of-scope answer is a `detectOutOfScope` hard stop.
 */
import {
  RENTAL_EXPENSE_KEYS,
  recomputeNetRentalResult,
  type RentalScopeGateAnswer,
  type ReturnModel,
} from "@aus-tax-lodge/model";
import { detectOutOfScope } from "@aus-tax-lodge/scope";
import { describe, expect, it } from "vitest";

import { deterministicallyComplete } from "../lib/interview";
import { applyInterviewField } from "../lib/interview/fields";
import { confirmedField, notApplicable } from "./review-fixtures";
import { exportableModel } from "./export-fixtures";

/** A fully-confirmed positively-geared rental, but with the scope gate still unanswered. */
function rentalReadyExceptGate(): ReturnModel {
  const base = exportableModel();
  const expenses = { ...base.rental.expenses };
  for (const key of RENTAL_EXPENSE_KEYS) {
    expenses[key] = { amount: notApplicable<number>(), source: null };
  }
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

  return { ...base, rental };
}

const GATE_KEYS: readonly (keyof RentalScopeGateAnswer)[] = [
  "solelyOwned",
  "rentedOrAvailableAllYear",
  "noPrivateUse",
  "notBoughtOrSoldThisYear",
];

function answerGate(model: ReturnModel, answers: Partial<RentalScopeGateAnswer>): ReturnModel {
  let next = model;
  for (const key of GATE_KEYS) {
    if (answers[key] === undefined) continue;
    next = applyInterviewField(next, {
      path: `questionnaire.rentalScopeGate.${key}`,
      kind: "boolean",
      value: answers[key]!,
    });
  }
  return next;
}

describe("#83 — rental scope gate, in scope", () => {
  it("is not deterministically complete until the gate is settled", () => {
    expect(deterministicallyComplete(rentalReadyExceptGate())).toBe(false);
  });

  it("settling all four in-scope answers reaches deterministic completeness", () => {
    const model = answerGate(rentalReadyExceptGate(), {
      solelyOwned: true,
      rentedOrAvailableAllYear: true,
      noPrivateUse: true,
      notBoughtOrSoldThisYear: true,
    });

    expect(model.questionnaire.rentalScopeGate.value).toEqual({
      solelyOwned: true,
      rentedOrAvailableAllYear: true,
      noPrivateUse: true,
      notBoughtOrSoldThisYear: true,
    });
    expect(detectOutOfScope({ model })).toHaveLength(0);
    expect(deterministicallyComplete(model)).toBe(true);
  });
});

describe("#83 — rental scope gate, out of scope", () => {
  it("a co-owned answer is a hard stop", () => {
    const model = answerGate(rentalReadyExceptGate(), { solelyOwned: false });
    expect(detectOutOfScope({ model }).map((f) => f.code)).toContain("rental-co-owned");
  });

  it("a part-year answer is a hard stop", () => {
    const model = answerGate(rentalReadyExceptGate(), { rentedOrAvailableAllYear: false });
    expect(detectOutOfScope({ model }).map((f) => f.code)).toContain("rental-part-year");
  });

  it("a private-use answer is a hard stop", () => {
    const model = answerGate(rentalReadyExceptGate(), { noPrivateUse: false });
    expect(detectOutOfScope({ model }).map((f) => f.code)).toContain("rental-private-use");
  });

  it("a bought-or-sold-this-year answer is a hard stop", () => {
    const model = answerGate(rentalReadyExceptGate(), { notBoughtOrSoldThisYear: false });
    expect(detectOutOfScope({ model }).map((f) => f.code)).toContain(
      "rental-bought-or-sold-this-year",
    );
  });
});
