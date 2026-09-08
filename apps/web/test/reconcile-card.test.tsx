// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { resolveReconcile } = vi.hoisted(() => ({ resolveReconcile: vi.fn() }));
vi.mock("../app/returns/[returnId]/actions", () => ({ resolveReconcile }));

import { ReconcileCard } from "../components/chat/cards/ReconcileCard";
import type { AssistantCardTurn } from "../lib/conversation";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const RECONCILIATION = {
  modelPath: "income.interestAccounts[0].grossInterest",
  candidates: [
    {
      docId: "d1",
      documentType: "ato-prefill-report",
      page: 1,
      snippet: "Interest $1,240",
      confidence: "high",
      value: 1240,
    },
    {
      docId: "d2",
      documentType: "bank-interest-notice",
      page: 2,
      snippet: "Interest $1,310",
      confidence: "medium",
      value: 1310,
    },
  ],
};

function turn(
  payload: unknown = {
    lead: "Your pre-fill and the notice disagree.",
    reconciliation: RECONCILIATION,
  },
): AssistantCardTurn {
  return {
    id: "card1",
    at: "t",
    role: "assistant",
    kind: "card",
    card: { type: "reconcile", payload },
  };
}

function renderCard(payload?: unknown, props: Record<string, unknown> = {}) {
  const onResult = vi.fn();
  render(
    <ReconcileCard
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

describe("ReconcileCard (PRD FR-7)", () => {
  it("names both values and their sources, with nothing pre-selected", () => {
    renderCard();
    expect(screen.getByText(/pre-fill and the notice disagree/i)).toBeTruthy();
    expect(screen.getByText("$1,240.00")).toBeTruthy();
    expect(screen.getByText("$1,310.00")).toBeTruthy();
    expect(screen.getByText(/Your pre-fill report/i)).toBeTruthy();
    expect(screen.getByText(/bank interest notice you added/i)).toBeTruthy();
    for (const radio of screen.getAllByRole("radio")) {
      expect((radio as HTMLInputElement).checked).toBe(false);
    }
    expect(screen.queryByText(/recommend/i)).toBeNull();
  });

  it("requires a pick before the submit button is enabled", () => {
    renderCard();
    expect(
      (screen.getByRole("button", { name: /use this value/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("submits the chosen candidate index and hands the result up", async () => {
    resolveReconcile.mockResolvedValue({ conversation: { turns: [] }, revision: 5 });
    const { onResult } = renderCard();

    fireEvent.click(screen.getAllByRole("radio")[1]!);
    fireEvent.click(screen.getByRole("button", { name: /use this value/i }));

    await waitFor(() =>
      expect(resolveReconcile).toHaveBeenCalledWith(
        "ret1",
        4,
        "card1",
        "income.interestAccounts[0].grossInterest",
        1,
      ),
    );
    await waitFor(() =>
      expect(onResult).toHaveBeenCalledWith({ conversation: { turns: [] }, revision: 5 }),
    );
    expect(await screen.findByText(/recorded/i)).toBeTruthy();
  });

  it("renders a calm fallback when the payload has no reconciliation", () => {
    renderCard({ reconciliation: null });
    expect(screen.getByText(/nothing left to reconcile/i)).toBeTruthy();
  });
});
