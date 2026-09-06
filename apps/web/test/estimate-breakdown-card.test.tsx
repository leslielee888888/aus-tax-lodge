// @vitest-environment jsdom
import { assess } from "@aus-tax-lodge/engine";
import { toEngineInput, type ReturnModel } from "@aus-tax-lodge/model";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EstimateBreakdownCard } from "../app/returns/[returnId]/estimate/EstimateBreakdownCard";
import { buildEstimateBreakdown } from "../lib/estimate/breakdown";
import { confirmedField, readyModel } from "./review-fixtures";

afterEach(cleanup);

function cardFor(model: ReturnModel) {
  return buildEstimateBreakdown(model, assess(toEngineInput(model)), "ret-1");
}

describe("<EstimateBreakdownCard>", () => {
  it("renders the headline label + amount and the 'How we got there' breakdown", () => {
    const breakdown = cardFor(readyModel());
    render(<EstimateBreakdownCard breakdown={breakdown} />);

    // Appears twice — the headline label and the final net row.
    expect(screen.getAllByText("Estimated amount owing").length).toBe(2);
    expect(screen.getAllByText(breakdown.headline.displayAmount).length).toBeGreaterThan(0);
    expect(screen.getByText("How we got there")).toBeDefined();
    expect(screen.getByText("Salary & wages")).toBeDefined();
    expect(screen.getByText("Taxable income")).toBeDefined();
    expect(screen.getByText("Total tax and levies")).toBeDefined();
  });

  it("gives every non-total line a 'view' link back to review", () => {
    render(<EstimateBreakdownCard breakdown={cardFor(readyModel())} />);
    const links = screen
      .getAllByRole("link")
      .filter((a) => a.getAttribute("href") === "/returns/ret-1/review");
    expect(links.length).toBeGreaterThan(0);
    expect(within(links[0]!).getByText(/view the inputs behind/i)).toBeDefined();
  });

  it("shows the spouse-estimate caveat when the return has a spouse", () => {
    const model: ReturnModel = {
      ...readyModel(),
      context: {
        ...readyModel().context,
        spouse: {
          ...readyModel().context.spouse,
          status: confirmedField("had-spouse"),
          name: confirmedField("Sam"),
          dateOfBirth: confirmedField("1985-01-01"),
          estimatedTaxableIncome: confirmedField(40_000),
          privateHospitalCoverDays: confirmedField(365),
        },
      },
    };
    render(<EstimateBreakdownCard breakdown={cardFor(model)} />);
    expect(screen.getByText("Spouse income is an estimate")).toBeDefined();
  });
});
