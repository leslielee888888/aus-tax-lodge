// @vitest-environment jsdom
import type { ReturnSummary } from "@aus-tax-lodge/store";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ReturnsList } from "../components/ReturnsList";

afterEach(cleanup);

function summary(overrides: Partial<ReturnSummary>): ReturnSummary {
  return {
    returnId: "id",
    targetYear: "2025-26",
    status: "in-progress",
    currentStep: "details",
    updatedAt: "2026-09-01T02:00:00.000Z",
    readOnly: false,
    ...overrides,
  };
}

describe("ReturnsList", () => {
  it("shows the empty state with a New return button and no rows", () => {
    render(<ReturnsList returns={[]} />);
    expect(
      screen.getByText(/Create your first return for the 2025–26 income year/),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /New return/i })).toBeTruthy();
    expect(screen.queryByText(/read-only/i)).toBeNull();
  });

  it("renders an in-progress row as a resumable return", () => {
    render(
      <ReturnsList
        returns={[summary({ returnId: "a", status: "in-progress", currentStep: "review" })]}
      />,
    );
    expect(screen.getByText("In progress · Review figures")).toBeTruthy();
    const link = screen.getByRole("link", { name: /Resume/i });
    expect(link.getAttribute("href")).toBe("/returns/a/review");
    expect(screen.queryByText(/Create your first return/)).toBeNull();
  });

  it("renders a retired-params return as read-only and view-only", () => {
    render(
      <ReturnsList
        returns={[
          summary({
            returnId: "b",
            targetYear: "2024-25",
            status: "exported",
            currentStep: "export",
            readOnly: true,
          }),
        ]}
      />,
    );
    expect(screen.getByText("Lodged — 2024–25, read-only")).toBeTruthy();
    const link = screen.getByRole("link", { name: "View" });
    expect(link.getAttribute("href")).toBe("/returns/b/export");
    expect(screen.queryByRole("link", { name: /Resume/i })).toBeNull();
  });

  it("renders an exported current-year return as actionable", () => {
    render(
      <ReturnsList
        returns={[summary({ returnId: "c", status: "exported", currentStep: "estimate" })]}
      />,
    );
    expect(screen.getByText("Exported")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open/i }).getAttribute("href")).toBe(
      "/returns/c/estimate",
    );
  });
});
