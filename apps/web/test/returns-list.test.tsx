// @vitest-environment jsdom
import type { ReturnSummary } from "@aus-tax-lodge/store";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ReturnsList } from "../components/ReturnsList";
import type { ReturnListItem } from "../lib/returns";

afterEach(cleanup);

function item(overrides: {
  summary?: Partial<ReturnSummary>;
  phase?: ReturnListItem["phase"];
  summaryLine?: string;
  stoppedReason?: string | null;
}): ReturnListItem {
  return {
    summary: {
      returnId: "id",
      targetYear: "2025-26",
      status: "in-progress",
      currentStep: "chat",
      updatedAt: "2026-09-01T02:00:00.000Z",
      readOnly: false,
      ...overrides.summary,
    },
    phase: overrides.phase ?? "interview",
    summaryLine: overrides.summaryLine ?? "Interview in progress",
    stoppedReason: overrides.stoppedReason ?? null,
  };
}

describe("ReturnsList", () => {
  it("shows the empty state with a New return button and no rows", () => {
    render(<ReturnsList items={[]} />);
    expect(screen.getByText(/Create your first return for the 2025–26 income year/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /New return/i })).toBeTruthy();
    expect(screen.queryByText(/read-only/i)).toBeNull();
  });

  it("renders an in-progress row with 'up to: <topic>' and a Resume link to the chat", () => {
    render(
      <ReturnsList
        items={[
          item({
            summary: { returnId: "a", status: "in-progress" },
            phase: "interview",
            summaryLine: "up to: work-from-home deductions",
          }),
        ]}
      />,
    );
    expect(screen.getByText("In progress")).toBeTruthy();
    expect(screen.getByText("up to: work-from-home deductions")).toBeTruthy();
    const link = screen.getByRole("link", { name: /Resume/i });
    expect(link.getAttribute("href")).toBe("/returns/a");
    expect(screen.queryByText(/Create your first return/)).toBeNull();
  });

  it("renders a retired-params return as read-only and view-only", () => {
    render(
      <ReturnsList
        items={[
          item({
            summary: {
              returnId: "b",
              targetYear: "2024-25",
              status: "exported",
              readOnly: true,
            },
            phase: "exported",
            summaryLine: "Lodgement package ready",
          }),
        ]}
      />,
    );
    expect(screen.getByText("Lodged — 2024–25, read-only")).toBeTruthy();
    const link = screen.getByRole("link", { name: "View" });
    expect(link.getAttribute("href")).toBe("/returns/b");
    expect(screen.queryByRole("link", { name: /Resume/i })).toBeNull();
  });

  it("renders an exported current-year return as actionable", () => {
    render(
      <ReturnsList
        items={[
          item({
            summary: { returnId: "c", status: "exported" },
            phase: "exported",
            summaryLine: "Lodgement package ready",
          }),
        ]}
      />,
    );
    expect(screen.getByText("Exported")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open/i }).getAttribute("href")).toBe("/returns/c");
  });

  it("renders a hard-stopped return with the stop reason as the sublabel", () => {
    render(
      <ReturnsList
        items={[
          item({
            summary: { returnId: "d", status: "in-progress" },
            phase: "stopped",
            summaryLine: "Stopped — capital gains event (sold shares)",
            stoppedReason: "capital gains event (sold shares)",
          }),
        ]}
      />,
    );
    expect(screen.getByText("Stopped")).toBeTruthy();
    expect(screen.getByText("capital gains event (sold shares)")).toBeTruthy();
    const link = screen.getByRole("link", { name: "View" });
    expect(link.getAttribute("href")).toBe("/returns/d");
  });
});
