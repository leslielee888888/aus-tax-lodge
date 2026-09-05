// @vitest-environment jsdom
import { detectOutOfScope, isBlocked } from "@aus-tax-lodge/scope";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { readyModel } from "./review-fixtures";

const { deleteReturn } = vi.hoisted(() => ({ deleteReturn: vi.fn() }));

vi.mock("../app/returns/[returnId]/review/actions", () => ({
  deleteReturnAction: deleteReturn,
}));

import { OutOfScopeReviewStop } from "../app/returns/[returnId]/review/OutOfScopeReviewStop";

afterEach(cleanup);

describe("OutOfScopeReviewStop (PRD FR-20)", () => {
  it("detectOutOfScope flags a non-resident return, and the stop screen names it with no continue control", () => {
    const model = {
      ...readyModel(),
      context: {
        ...readyModel().context,
        residency: { ...readyModel().context.residency, value: "non-resident" as const },
      },
    };
    const findings = detectOutOfScope({ model });
    expect(isBlocked(findings)).toBe(true);

    render(<OutOfScopeReviewStop returnId="ret1" findings={findings} />);

    expect(screen.getByText("This return needs a tax agent")).toBeTruthy();
    expect(screen.getByText("Non-resident for tax purposes")).toBeTruthy();
    expect(screen.getByRole("link", { name: /back to documents/i }).getAttribute("href")).toBe(
      "/returns/ret1/documents",
    );
    expect(screen.getByRole("button", { name: /delete this return/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /continue/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /continue/i })).toBeNull();
  });

  it("names every finding when there is more than one", () => {
    const findings = [
      {
        code: "capital-gains" as const,
        item: "Capital gains (sale of shares, property, crypto or other assets)",
        detail: "detail a",
        source: "document" as const,
      },
      {
        code: "business-income" as const,
        item: "Business or sole-trader income",
        detail: "detail b",
        source: "answer" as const,
      },
    ];
    render(<OutOfScopeReviewStop returnId="ret1" findings={findings} />);
    expect(screen.getByText(findings[0]!.item)).toBeTruthy();
    expect(screen.getByText(findings[1]!.item)).toBeTruthy();
  });
});
