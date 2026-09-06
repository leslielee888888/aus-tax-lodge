import {
  isReadyForEstimate,
  needsRepairsConfirmation,
  RENTAL_EXPENSE_KEYS,
} from "@aus-tax-lodge/model";
import { describe, expect, it } from "vitest";

import { buildReviewData } from "../lib/review/build-sections";
import { answered, confirmedField, notApplicable, proposed, readyModel } from "./review-fixtures";

describe("buildReviewData (PRD FR-7, FR-21, FR-24)", () => {
  it("groups rows into income → deductions → offsets, omitting rental when the return has none", () => {
    const model = readyModel();
    const data = buildReviewData(model, [], {});
    expect(data.sections.map((s) => s.id)).toEqual(["income", "deductions", "offsets"]);
  });

  it("adds a rental section, in order, when the return has a rental", () => {
    const model = readyModel();
    const withRental = {
      ...model,
      rental: { ...model.rental, present: true, grossRent: confirmedField(10_000) },
    };
    const data = buildReviewData(withRental, [], {});
    expect(data.sections.map((s) => s.id)).toEqual(["income", "deductions", "rental", "offsets"]);
    const rental = data.sections.find((s) => s.id === "rental")!;
    expect(rental.rows.some((r) => r.kind === "computed" && r.label === "Net rent")).toBe(true);
  });

  it("shows the rental property identity + scope booleans as non-blocking note rows (PRD FR-24 / T25)", () => {
    const model = readyModel();
    const expenses = Object.fromEntries(
      RENTAL_EXPENSE_KEYS.map((key) => [
        key,
        { amount: confirmedField(0), source: "agent-statement" as const },
      ]),
    ) as typeof model.rental.expenses;
    const withRental = {
      ...model,
      rental: {
        ...model.rental,
        present: true,
        property: {
          addressLine1: confirmedField("10 Landlord Ln"),
          suburb: confirmedField("Brunswick"),
          state: confirmedField("VIC"),
          postcode: confirmedField("3056"),
          firstEarnedIncomeOn: confirmedField("2019-07-01"),
        },
        grossRent: confirmedField(24_000),
        otherRentalIncome: notApplicable<number>(),
        expenses,
      },
    };
    const rentalRows = buildReviewData(withRental, [], {}).sections.find(
      (s) => s.id === "rental",
    )!.rows;
    const notes = rentalRows.filter((r) => r.kind === "note");
    expect(notes.map((r) => (r.kind === "note" ? r.label : ""))).toEqual([
      "Property address",
      "Rental income first earned",
      "Solely owned",
      "Rented or available all year",
      "No private use",
    ]);
    // property notes are settled (from details); scope-boolean notes are not yet.
    expect(notes.filter((r) => r.kind === "note" && r.settled)).toHaveLength(2);

    // Note rows never count toward the section's confirmable total.
    const rental = buildReviewData(withRental, [], {}).sections.find((s) => s.id === "rental")!;
    expect(rental.totalCount).toBe(
      rental.rows.filter((r) => r.kind === "field" || r.kind === "interest-account").length,
    );
  });

  it("`canContinue` still goes true for a fully-confirmed rental once the scope gate is answered (PRD FR-24 / T25)", () => {
    const base = readyModel();
    const expenses = Object.fromEntries(
      RENTAL_EXPENSE_KEYS.map((key) => [
        key,
        { amount: confirmedField(0), source: "agent-statement" as const },
      ]),
    ) as typeof base.rental.expenses;
    const model = {
      ...base,
      rental: {
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
      },
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
    const data = buildReviewData(model, [], {});
    expect(data.canContinue).toBe(true);
    expect(data.blockingReasons).toEqual([]);
    expect(isReadyForEstimate(model)).toBe(true);
  });

  it("marks an unverified figure's row `unverified` and keeps it unsettled", () => {
    const model = readyModel();
    const withUnverified = {
      ...model,
      income: {
        ...model.income,
        governmentAllowances: proposed(1_500, { confidence: "unverified" }),
      },
    };
    const data = buildReviewData(withUnverified, [], {});
    const row = data.sections
      .flatMap((s) => s.rows)
      .find((r) => r.kind === "field" && r.path === "income.governmentAllowances");
    expect(row).toMatchObject({ kind: "field", unverified: true, status: "proposed" });
  });

  it("renders a pending reconciliation as a mismatch row, pre-selected via suggestDefaultChoice, and not a plain field row", () => {
    const model = readyModel();
    const pending = [
      {
        modelPath: "income.governmentAllowances",
        candidates: [
          {
            docId: "doc-a",
            documentType: "ato-prefill-report" as const,
            page: 1,
            snippet: "a",
            confidence: "high" as const,
            value: 1_000,
          },
          {
            docId: "doc-b",
            documentType: "income-statement" as const,
            page: 2,
            snippet: "b",
            confidence: "medium" as const,
            value: 1_200,
          },
        ],
      },
    ];
    const data = buildReviewData(model, pending, {
      "doc-a": "prefill.pdf",
      "doc-b": "statement.pdf",
    });
    const incomeRows = data.sections.find((s) => s.id === "income")!.rows;
    const mismatch = incomeRows.find((r) => r.kind === "mismatch");
    expect(mismatch).toBeDefined();
    expect(mismatch).toMatchObject({
      kind: "mismatch",
      modelPath: "income.governmentAllowances",
      suggestedIndex: 0,
    });
    expect(
      incomeRows.some((r) => r.kind === "field" && r.path === "income.governmentAllowances"),
    ).toBe(false);
  });

  it("a rental repairs line over the threshold renders as a repairs-gate row and blocks `canContinue`", () => {
    const model = readyModel();
    const withRepairs = {
      ...model,
      rental: {
        ...model.rental,
        present: true,
        grossRent: confirmedField(10_000),
        otherRentalIncome: notApplicable<number>(),
        expenses: {
          ...model.rental.expenses,
          repairsAndMaintenance: {
            amount: confirmedField(1_500),
            source: "agent-statement" as const,
          },
        },
      },
    };
    expect(needsRepairsConfirmation(withRepairs.rental)).toBe(true);
    const data = buildReviewData(withRepairs, [], {});
    const rentalRows = data.sections.find((s) => s.id === "rental")!.rows;
    expect(rentalRows.some((r) => r.kind === "repairs-gate")).toBe(true);
    expect(data.canContinue).toBe(false);
    expect(data.blockingReasons.some((r) => r.includes("repairs"))).toBe(true);
  });

  it("`canContinue` is false while `isReadyForEstimate` is false and true once the model is fully settled", () => {
    const incomplete = {
      ...readyModel(),
      income: { ...readyModel().income, governmentAllowances: proposed(500) },
    };
    expect(isReadyForEstimate(incomplete)).toBe(false);
    expect(buildReviewData(incomplete, [], {}).canContinue).toBe(false);

    const complete = readyModel();
    expect(isReadyForEstimate(complete)).toBe(true);
    const data = buildReviewData(complete, [], {});
    expect(data.canContinue).toBe(true);
    expect(data.blockingReasons).toEqual([]);
  });

  it("every in-scope rental expense key gets a row when the rental is present and under threshold", () => {
    const model = readyModel();
    const withRental = { ...model, rental: { ...model.rental, present: true } };
    const data = buildReviewData(withRental, [], {});
    const rentalRows = data.sections.find((s) => s.id === "rental")!.rows;
    const fieldPaths = rentalRows
      .filter((r) => r.kind === "field")
      .map((r) => (r as { path: string }).path);
    for (const key of RENTAL_EXPENSE_KEYS) {
      expect(fieldPaths).toContain(`rental.expenses.${key}.amount`);
    }
  });
});
