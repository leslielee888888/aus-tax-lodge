/**
 * T8 — `buildReviewSummary` / `reviewSummaryForModel` (PRD FR-5, FR-10, FR-11).
 *
 * The whole-return summary the `review-summary` card renders. Every figure must
 * come from `buildEstimateBreakdown` (engine output only), so the review can
 * never drift from the FR-10 estimate or the FR-11 export package.
 */
import { assess } from "@aus-tax-lodge/engine";
import {
  createEmptyReturnModel,
  recomputeNetRentalResult,
  RENTAL_EXPENSE_KEYS,
  toEngineInput,
  type ReturnModel,
} from "@aus-tax-lodge/model";
import { describe, expect, it } from "vitest";

import { buildEstimateBreakdown } from "../lib/estimate/breakdown";
import {
  buildReviewSummary,
  reopenQuestionFor,
  reviewSummaryForModel,
} from "../lib/review-summary";
import { answered, confirmedField, notApplicable } from "./review-fixtures";
import { exportableModel } from "./export-fixtures";

function withSpouse(model: ReturnModel): ReturnModel {
  return {
    ...model,
    context: {
      ...model.context,
      spouse: {
        ...model.context.spouse,
        status: confirmedField("had-spouse"),
        name: confirmedField("Sam Example"),
        dateOfBirth: confirmedField("1986-05-05"),
        estimatedTaxableIncome: confirmedField(140_000),
        privateHospitalCoverDays: confirmedField(0),
      },
    },
  };
}

function withRental(model: ReturnModel): ReturnModel {
  const expenses = { ...model.rental.expenses };
  for (const key of RENTAL_EXPENSE_KEYS) {
    expenses[key] = { amount: notApplicable<number>(), source: null };
  }
  expenses.agentFees = { amount: confirmedField(1_500), source: "agent-statement" };
  return {
    ...model,
    rental: recomputeNetRentalResult({
      ...model.rental,
      present: true,
      expenses,
      property: {
        addressLine1: confirmedField("2 Rental Rd"),
        suburb: confirmedField("Sydney"),
        state: confirmedField("NSW"),
        postcode: confirmedField("2000"),
        firstEarnedIncomeOn: confirmedField("2020-07-01"),
      },
      soleOwnership: confirmedField(true),
      rentedOrAvailableAllYear: confirmedField(true),
      noPrivateUse: confirmedField(true),
      grossRent: confirmedField(20_000),
      otherRentalIncome: notApplicable<number>(),
      repairsConfirmedNotCapital: false,
    }),
    questionnaire: {
      ...model.questionnaire,
      rentalScopeGate: answered({
        solelyOwned: true,
        rentedOrAvailableAllYear: true,
        noPrivateUse: true,
        notBoughtOrSoldThisYear: true,
      }),
    },
  };
}

describe("buildReviewSummary (PRD FR-5, FR-10)", () => {
  it("mirrors buildEstimateBreakdown line for line, with the same headline", () => {
    const model = exportableModel();
    const assessment = assess(toEngineInput(model));
    const breakdown = buildEstimateBreakdown(model, assessment, "");
    const summary = buildReviewSummary(model, assessment);

    expect(summary.lines.map((l) => l.displayAmount)).toEqual(
      breakdown.rows.map((r) => r.displayAmount),
    );
    expect(summary.lines.map((l) => l.label)).toEqual(breakdown.rows.map((r) => r.label));
    expect(summary.headline?.displayAmount).toBe(breakdown.headline.displayAmount);
    expect(summary.headline?.kind).toBe(breakdown.headline.kind);
    expect(summary.incomplete).toBe(false);
  });

  it("shows the taxpayer's name, never the TFN", () => {
    const model = exportableModel();
    const summary = buildReviewSummary(model, assess(toEngineInput(model)));
    expect(summary.taxpayerName).toBe("Priya Example");
    expect(JSON.stringify(summary)).not.toContain("123456782");
  });

  it("always carries the 'this is an estimate' caveat first", () => {
    const model = exportableModel();
    const summary = buildReviewSummary(model, assess(toEngineInput(model)));
    expect(summary.caveats[0]).toMatch(/estimate, not the ATO's assessment/i);
  });

  it("marks spouse-affected lines 'estimated' and flags the summary", () => {
    const model = withSpouse(exportableModel());
    const summary = buildReviewSummary(model, assess(toEngineInput(model)));
    expect(summary.hasSpouseEstimate).toBe(true);
    const levy = summary.lines.find((l) => l.label.startsWith("plus Medicare levy"));
    expect(levy?.estimated).toBe(true);
  });

  it("breaks the rental out into gross rent / deductions / net result lines", () => {
    const model = withRental(exportableModel());
    const summary = buildReviewSummary(model, assess(toEngineInput(model)));
    const labels = summary.lines.map((l) => l.label);
    expect(labels).toContain("Gross rent");
    expect(labels).toContain("less Rental deductions");
    expect(labels).toContain("Net rental result");
    for (const label of ["Gross rent", "less Rental deductions", "Net rental result"]) {
      expect(summary.lines.find((l) => l.label === label)?.lineKey).toBe("rental");
    }
  });

  it("returns an incomplete summary with outstanding topics when no assessment is given", () => {
    const model = createEmptyReturnModel("2025-26");
    const summary = buildReviewSummary(model, null);
    expect(summary.incomplete).toBe(true);
    expect(summary.headline).toBeNull();
    expect(summary.missing.length).toBeGreaterThan(0);
  });
});

describe("reviewSummaryForModel", () => {
  it("runs the engine for a ready model", () => {
    const summary = reviewSummaryForModel(exportableModel());
    expect(summary.incomplete).toBe(false);
    expect(summary.headline).not.toBeNull();
  });

  it("falls back to an incomplete summary for a bare model", () => {
    const summary = reviewSummaryForModel(createEmptyReturnModel("2025-26"));
    expect(summary.incomplete).toBe(true);
  });
});

describe("reopenQuestionFor", () => {
  it("names the topic for a known line key", () => {
    expect(reopenQuestionFor("salary-wages", "Salary & wages")).toMatch(/salary and wages/i);
  });

  it("falls back to the line label for an unknown key", () => {
    expect(reopenQuestionFor("mystery", "Some Line")).toContain("Some Line");
  });
});
