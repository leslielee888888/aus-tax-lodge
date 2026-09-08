/**
 * T6 — the rental figures the interview gathers by asking, because they are not
 * on the agent statement (PRD FR-24, Q23-Q25): owner-paid expenses,
 * hand-entered Div 43 / Div 40 totals, and the repairs-vs-capital answer.
 */
import {
  createEmptyReturnModel,
  needsRepairsConfirmation,
  propose,
  unsetField,
  type ReturnModel,
} from "@aus-tax-lodge/model";
import { describe, expect, it } from "vitest";

import { applyInterviewField, isInterviewFieldPath } from "../../lib/interview";

function rentalModel(overrides: Partial<ReturnModel["rental"]> = {}): ReturnModel {
  const base = createEmptyReturnModel("2025-26");
  return { ...base, rental: { ...base.rental, present: true, ...overrides } };
}

describe("interview field allow-list — rental (PRD FR-24)", () => {
  it("lists the owner-paid, manual-depreciation and repairs paths", () => {
    for (const path of [
      "rental.expenses.insurance.amount",
      "rental.expenses.landTax.amount",
      "rental.expenses.bodyCorporate.amount",
      "rental.expenses.capitalWorks.amount",
      "rental.expenses.declineInValue.amount",
      "rental.repairsConfirmedNotCapital",
    ]) {
      expect(isInterviewFieldPath(path)).toBe(true);
    }
  });

  it("records an owner-paid expense as the user's own fact and re-nets the schedule", () => {
    const model = rentalModel({
      grossRent: propose(unsetField<number>(), 20000, {
        kind: "document",
        docId: "d",
        page: 1,
        snippet: "x",
        confidence: "medium",
      }),
    });
    const next = applyInterviewField(model, {
      path: "rental.expenses.insurance.amount",
      value: 640,
      kind: "number",
    });
    expect(next.rental.expenses.insurance.amount.value).toBe(640);
    expect(next.rental.expenses.insurance.amount.status).toBe("confirmed");
    expect(next.rental.expenses.insurance.source).toBe("owner-paid");
    expect(next.rental.netRentalResult.value).toBe(20000 - 640);
  });

  it("takes hand-entered Div 43 / Div 40 totals", () => {
    const next = applyInterviewField(
      applyInterviewField(rentalModel(), {
        path: "rental.expenses.capitalWorks.amount",
        value: 5000,
        kind: "number",
      }),
      { path: "rental.expenses.declineInValue.amount", value: 2200, kind: "number" },
    );
    expect(next.rental.expenses.capitalWorks.amount.value).toBe(5000);
    expect(next.rental.expenses.declineInValue.amount.value).toBe(2200);
  });

  it("'yes it's a genuine repair' confirms the line and clears the gate", () => {
    const model = rentalModel({
      expenses: {
        ...createEmptyReturnModel("2025-26").rental.expenses,
        repairsAndMaintenance: {
          amount: propose(unsetField<number>(), 4200, {
            kind: "document",
            docId: "d",
            page: 1,
            snippet: "Repairs $4,200",
            confidence: "medium",
          }),
          source: "agent-statement",
        },
      },
    });
    expect(needsRepairsConfirmation(model.rental)).toBe(true);

    const next = applyInterviewField(model, {
      path: "rental.repairsConfirmedNotCapital",
      value: true,
      kind: "boolean",
    });
    expect(next.rental.repairsConfirmedNotCapital).toBe(true);
    expect(next.rental.expenses.repairsAndMaintenance.amount.status).toBe("confirmed");
    expect(needsRepairsConfirmation(next.rental)).toBe(false);
  });

  it("'no it was an improvement' reclassifies the repairs amount as capital works", () => {
    const model = rentalModel({
      expenses: {
        ...createEmptyReturnModel("2025-26").rental.expenses,
        repairsAndMaintenance: {
          amount: propose(unsetField<number>(), 4200, {
            kind: "document",
            docId: "d",
            page: 1,
            snippet: "x",
            confidence: "medium",
          }),
          source: "agent-statement",
        },
      },
    });
    const next = applyInterviewField(model, {
      path: "rental.repairsConfirmedNotCapital",
      value: false,
      kind: "boolean",
    });
    expect(next.rental.expenses.repairsAndMaintenance.amount.value).toBe(0);
    expect(next.rental.expenses.capitalWorks.amount.value).toBe(4200);
  });
});
