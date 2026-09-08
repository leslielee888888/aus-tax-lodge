// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { deleteReturn } = vi.hoisted(() => ({ deleteReturn: vi.fn() }));

vi.mock("../app/returns/[returnId]/actions", () => ({ deleteReturn }));

import { OutOfScopeCard } from "../components/chat/cards/OutOfScopeCard";
import type { AssistantCardTurn } from "../lib/conversation";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const FINDINGS = [
  {
    code: "capital-gains" as const,
    item: "Capital gains (sale of shares, property, crypto or other assets)",
    detail: "A capital gains tax event needs a CGT calculation this assistant does not do.",
    source: "answer" as const,
  },
  {
    code: "business-income" as const,
    item: "Business or sole-trader income",
    detail: "Sole-trader income needs a business schedule this assistant does not prepare.",
    source: "answer" as const,
  },
];

function turn(payload: unknown): AssistantCardTurn {
  return {
    id: "card1",
    at: "t",
    role: "assistant",
    kind: "card",
    card: { type: "out-of-scope", payload },
  };
}

function renderCard(payload: unknown = { findings: FINDINGS }, props: Record<string, unknown> = {}) {
  render(
    <OutOfScopeCard
      returnId="ret1"
      revision={4}
      turn={turn(payload)}
      readOnly={false}
      onResult={vi.fn()}
      {...props}
    />,
  );
}

describe("OutOfScopeCard (PRD FR-9, FR-20)", () => {
  it("is an alert region naming every finding with its detail", () => {
    renderCard();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("I can’t take this return further")).toBeTruthy();
    expect(screen.getByText(FINDINGS[0]!.item)).toBeTruthy();
    expect(screen.getByText(FINDINGS[1]!.item)).toBeTruthy();
    expect(screen.getByText(/A capital gains tax event needs/)).toBeTruthy();
  });

  it("points to ATO myTax and a registered tax agent, and states nothing was sent", () => {
    renderCard();
    expect(screen.getByText(/ATO myTax/i)).toBeTruthy();
    const link = screen.getByRole("link", { name: /tpb\.gov\.au/i });
    expect(link.getAttribute("href")).toBe("https://www.tpb.gov.au");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByText(/Nothing you.?ve entered has been sent anywhere/i)).toBeTruthy();
  });

  it("offers no continue / override / proceed affordance", () => {
    renderCard();
    expect(
      screen.queryByRole("button", { name: /continue|override|proceed|anyway|dismiss/i }),
    ).toBeNull();
    expect(screen.queryByRole("link", { name: /continue|override|proceed/i })).toBeNull();
  });

  it("deletes the return after a window.confirm", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    deleteReturn.mockResolvedValue(undefined);
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: /delete this return/i }));

    expect(confirmSpy).toHaveBeenCalledWith(
      "Delete this return? This removes every document and figure under it — it can't be undone.",
    );
    await waitFor(() => expect(deleteReturn).toHaveBeenCalledWith("ret1"));
    confirmSpy.mockRestore();
  });

  it("does not delete when the user cancels the confirm", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: /delete this return/i }));

    expect(deleteReturn).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("renders a generic stop message when the findings payload is missing or empty", () => {
    renderCard({});
    expect(screen.getByText(/outside what this assistant can prepare/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /delete this return/i })).toBeTruthy();
  });

  it("disables the delete button when read-only", () => {
    renderCard({ findings: FINDINGS }, { readOnly: true });
    expect(
      (screen.getByRole("button", { name: /delete this return/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
