// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { confirmIncome, correctIncome } = vi.hoisted(() => ({
  confirmIncome: vi.fn(),
  correctIncome: vi.fn(),
}));

vi.mock("../app/returns/[returnId]/actions", () => ({ confirmIncome, correctIncome }));

import { IncomeCheckpointCard } from "../components/chat/cards/IncomeCheckpointCard";
import type { AssistantCardTurn } from "../lib/conversation";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const LINES = [
  {
    modelPath: "income.salaryWages[0].grossSalaryWages",
    label: "Salary & wages",
    value: 95000,
    sublabel: "Acme Pty Ltd",
  },
  {
    modelPath: "income.salaryWages[0].paygWithheld",
    label: "PAYG tax withheld",
    value: 22000,
    sublabel: "Acme Pty Ltd",
  },
  {
    modelPath: "income.interestAccounts[0].grossInterest",
    label: "Gross interest",
    value: 312,
    sublabel: "Southbank Mutual",
  },
];

function turn(payload: unknown): AssistantCardTurn {
  return {
    id: "card1",
    at: "t",
    role: "assistant",
    kind: "card",
    card: { type: "income-checkpoint", payload },
  };
}

function renderCard(payload: unknown = { lines: LINES }, props: Record<string, unknown> = {}) {
  const onResult = vi.fn();
  render(
    <IncomeCheckpointCard
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

describe("IncomeCheckpointCard (PRD FR-5)", () => {
  it("renders each income line from the payload", () => {
    renderCard();
    expect(screen.getByText("Does your income look right?")).toBeTruthy();
    expect(screen.getByText(/Southbank Mutual/)).toBeTruthy();
    expect(screen.getByText("$95,000.00")).toBeTruthy();
    expect(screen.getByText("$312.00")).toBeTruthy();
  });

  it("'Looks right' calls confirmIncome and hands the result up", async () => {
    confirmIncome.mockResolvedValue({ conversation: { turns: [] }, revision: 5 });
    const { onResult } = renderCard();

    fireEvent.click(screen.getByRole("button", { name: /looks right/i }));

    await waitFor(() => expect(confirmIncome).toHaveBeenCalledWith("ret1", 4, "card1"));
    await waitFor(() =>
      expect(onResult).toHaveBeenCalledWith({ conversation: { turns: [] }, revision: 5 }),
    );
    expect(await screen.findByText(/income confirmed/i)).toBeTruthy();
  });

  it("'Something's off' lets the user correct a line and calls correctIncome", async () => {
    correctIncome.mockResolvedValue({ conversation: { turns: [] }, revision: 5 });
    const { onResult } = renderCard();

    fireEvent.click(screen.getByRole("button", { name: /something's off/i }));

    const interestInput = screen.getByLabelText(/Gross interest/i) as HTMLInputElement;
    fireEvent.change(interestInput, { target: { value: "820" } });

    fireEvent.click(screen.getByRole("button", { name: /send corrections/i }));

    await waitFor(() =>
      expect(correctIncome).toHaveBeenCalledWith("ret1", 4, "card1", [
        { modelPath: "income.interestAccounts[0].grossInterest", value: 820 },
      ]),
    );
    expect(onResult).toHaveBeenCalled();
  });

  it("shows a fallback line and no buttons when there are no income figures", () => {
    renderCard({ lines: [] });
    expect(screen.getByText(/couldn't pull any income figures/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /looks right/i })).toBeNull();
  });

  it("disables the actions when read-only", () => {
    renderCard({ lines: LINES }, { readOnly: true });
    expect(
      (screen.getByRole("button", { name: /looks right/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
