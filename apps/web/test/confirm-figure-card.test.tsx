// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { resolveConfirmation } = vi.hoisted(() => ({ resolveConfirmation: vi.fn() }));

vi.mock("../app/returns/[returnId]/actions", () => ({ resolveConfirmation }));

import { ConfirmFigureCard } from "../components/chat/cards/ConfirmFigureCard";
import type { AssistantCardTurn, PendingConfirmation } from "../lib/conversation";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const CONFIRMATION: PendingConfirmation = {
  id: "pc:income.interestAccounts[0].grossInterest",
  modelPath: "income.interestAccounts[0].grossInterest",
  label: "Gross interest — Southbank Mutual",
  value: 312,
  source: "your pre-fill report",
  reason: "low-confidence",
  resolved: false,
};

function turn(payload: unknown): AssistantCardTurn {
  return {
    id: "card1",
    at: "t",
    role: "assistant",
    kind: "card",
    card: { type: "confirm-figure", payload },
  };
}

function renderCard(
  payload: unknown = { confirmation: CONFIRMATION },
  props: Record<string, unknown> = {},
) {
  const onResult = vi.fn();
  render(
    <ConfirmFigureCard
      returnId="ret1"
      revision={4}
      turn={turn(payload)}
      readOnly={false}
      onResult={onResult}
      {...props}
    />,
  );
  return { onResult };
}

describe("ConfirmFigureCard (PRD FR-5)", () => {
  it("renders the flagged figure, its value and its source", () => {
    renderCard();
    expect(screen.getByText(/Gross interest — Southbank Mutual: \$312\.00/)).toBeTruthy();
    expect(screen.getByText(/from your pre-fill report/i)).toBeTruthy();
  });

  it("'Yes' resolves the confirmation with accept: true", async () => {
    resolveConfirmation.mockResolvedValue({ conversation: { turns: [] }, revision: 5 });
    const { onResult } = renderCard();

    fireEvent.click(screen.getByRole("button", { name: /yes, that's right/i }));

    await waitFor(() =>
      expect(resolveConfirmation).toHaveBeenCalledWith("ret1", 4, "card1", CONFIRMATION.id, {
        accept: true,
      }),
    );
    expect(onResult).toHaveBeenCalledWith({ conversation: { turns: [] }, revision: 5 });
    expect(await screen.findByText(/recorded/i)).toBeTruthy();
  });

  it("'Edit' takes a new value and resolves with accept: false", async () => {
    resolveConfirmation.mockResolvedValue({ conversation: { turns: [] }, revision: 5 });
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    fireEvent.change(screen.getByLabelText(/corrected amount/i), { target: { value: "340" } });
    fireEvent.click(screen.getByRole("button", { name: /save correction/i }));

    await waitFor(() =>
      expect(resolveConfirmation).toHaveBeenCalledWith("ret1", 4, "card1", CONFIRMATION.id, {
        accept: false,
        value: 340,
      }),
    );
  });

  it("renders a calm fallback when there is no confirmation in the payload", () => {
    renderCard({});
    expect(screen.getByText(/nothing to check here/i)).toBeTruthy();
  });

  it("disables the actions when read-only", () => {
    renderCard({ confirmation: CONFIRMATION }, { readOnly: true });
    expect(
      (screen.getByRole("button", { name: /yes, that's right/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
