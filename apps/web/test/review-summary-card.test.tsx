// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { approveReturn, reopenLine } = vi.hoisted(() => ({
  approveReturn: vi.fn(),
  reopenLine: vi.fn(),
}));

vi.mock("../app/returns/[returnId]/actions", () => ({ approveReturn, reopenLine }));

import { ReviewSummaryCard } from "../components/chat/cards/ReviewSummaryCard";
import type { AssistantCardTurn } from "../lib/conversation";
import type { ReviewSummary } from "../lib/review-summary";

const SUMMARY: ReviewSummary = {
  taxpayerName: "Priya Example",
  lines: [
    {
      lineKey: "salary-wages",
      label: "Salary & wages",
      amount: 80_000,
      displayAmount: "$80,000.00",
      kind: "sub",
      source: "from your pre-fill report",
      reopenable: true,
    },
    {
      lineKey: "medicare-levy",
      label: "plus Medicare levy (2%)",
      amount: 1_600,
      displayAmount: "$1,600.00",
      kind: "line",
      source: "worked out by the tax engine from the figures above",
      estimated: true,
      reopenable: false,
    },
    {
      lineKey: "net-result",
      label: "Estimated refund",
      amount: 3_200,
      displayAmount: "$3,200.00",
      kind: "net",
      source: "worked out by the tax engine from the figures above",
      reopenable: false,
    },
  ],
  headline: {
    kind: "refund",
    label: "Estimated refund",
    amount: 3_200,
    displayAmount: "$3,200.00",
  },
  caveats: ["This is an estimate, not the ATO's assessment. The ATO works out the final figures."],
  incomplete: false,
  missing: [],
  hasSpouseEstimate: true,
};

function turn(payload: unknown): AssistantCardTurn {
  return {
    id: "card1",
    at: "t",
    role: "assistant",
    kind: "card",
    card: { type: "review-summary", payload },
  };
}

function renderCard(payload: unknown = { summary: SUMMARY }, props: Record<string, unknown> = {}) {
  const onResult = vi.fn();
  render(
    <ReviewSummaryCard
      returnId="ret1"
      revision={7}
      turn={turn(payload)}
      readOnly={false}
      onResult={onResult}
      {...props}
    />,
  );
  return { onResult };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  Object.assign(URL, {
    createObjectURL: vi.fn(() => "blob:mock"),
    revokeObjectURL: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("ReviewSummaryCard (PRD FR-5, FR-10, FR-11)", () => {
  it("renders every line, the estimated badge, the headline and the estimate caveat", () => {
    renderCard();
    expect(screen.getByText("Salary & wages")).toBeTruthy();
    expect(screen.getByText(/\$80,000\.00/)).toBeTruthy();
    expect(screen.getByText("estimated")).toBeTruthy();
    expect(screen.getByText(/Estimated refund: \$3,200\.00/)).toBeTruthy();
    expect(screen.getByText(/this is an estimate, not the ATO's assessment/i)).toBeTruthy();
  });

  it("shows a fallback when the payload has no usable summary", () => {
    renderCard({});
    expect(screen.getByText(/couldn't build the summary/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /approve return/i })).toBeNull();
  });

  it("reopens a line via reopenLine and hands the fresh conversation up", async () => {
    reopenLine.mockResolvedValue({ conversation: { turns: [], phase: "interview" }, revision: 8 });
    const { onResult } = renderCard();

    fireEvent.click(screen.getByRole("button", { name: /reopen Salary & wages/i }));

    await waitFor(() =>
      expect(reopenLine).toHaveBeenCalledWith("ret1", 7, "card1", "salary-wages"),
    );
    await waitFor(() =>
      expect(onResult).toHaveBeenCalledWith({
        conversation: { turns: [], phase: "interview" },
        revision: 8,
      }),
    );
  });

  it("rejects a password shorter than 12 characters before calling the server", async () => {
    renderCard();
    fireEvent.change(screen.getByLabelText(/records-archive password/i), {
      target: { value: "short" },
    });
    fireEvent.click(screen.getByRole("button", { name: /approve return/i }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/at least 12 characters/i);
    expect(approveReturn).not.toHaveBeenCalled();
  });

  it("approve happy path: gates, then POSTs the password to the archive route and downloads", async () => {
    approveReturn.mockResolvedValue({
      ok: true,
      archiveReady: true,
      conversation: { turns: [], phase: "exported" },
      revision: 9,
    });
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      blob: async () => new Blob(["zip"]),
      headers: { get: () => 'attachment; filename="tax-records-2025-26.zip"' },
    });
    const { onResult } = renderCard();

    fireEvent.change(screen.getByLabelText(/records-archive password/i), {
      target: { value: "correcthorsebatterystaple" },
    });
    fireEvent.click(screen.getByRole("button", { name: /approve return/i }));

    await waitFor(() =>
      expect(approveReturn).toHaveBeenCalledWith(
        "ret1",
        7,
        "card1",
        "correcthorsebatterystaple",
        undefined,
      ),
    );
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/returns/ret1/export/archive",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ password: "correcthorsebatterystaple" }),
        }),
      ),
    );
    await waitFor(() =>
      expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ revision: 9 })),
    );
    expect(await screen.findByText(/records archive has downloaded/i)).toBeTruthy();
  });

  it("surfaces the warning-acknowledgement gate and resubmits with the warning ids", async () => {
    approveReturn
      .mockResolvedValueOnce({
        ok: false,
        needsWarningAck: true,
        warnings: [{ id: "w1", message: "Franking credits look high for the dividend amount." }],
      })
      .mockResolvedValueOnce({
        ok: true,
        archiveReady: true,
        conversation: { turns: [], phase: "exported" },
        revision: 10,
      });
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      blob: async () => new Blob(["zip"]),
      headers: { get: () => null },
    });
    renderCard();

    fireEvent.change(screen.getByLabelText(/records-archive password/i), {
      target: { value: "correcthorsebatterystaple" },
    });
    fireEvent.click(screen.getByRole("button", { name: /approve return/i }));

    expect(await screen.findByText(/Franking credits look high/i)).toBeTruthy();

    fireEvent.click(screen.getByLabelText(/I understand these warnings/i));
    fireEvent.click(screen.getByRole("button", { name: /approve and download/i }));

    await waitFor(() =>
      expect(approveReturn).toHaveBeenLastCalledWith(
        "ret1",
        7,
        "card1",
        "correcthorsebatterystaple",
        ["w1"],
      ),
    );
  });

  it("shows blocking validation errors inline and stays put", async () => {
    approveReturn.mockResolvedValue({ ok: false, blockedErrors: ["TFN is not valid"] });
    renderCard();
    fireEvent.change(screen.getByLabelText(/records-archive password/i), {
      target: { value: "correcthorsebatterystaple" },
    });
    fireEvent.click(screen.getByRole("button", { name: /approve return/i }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/TFN is not valid/i);
  });

  it("read-only hides the password field and every button", () => {
    renderCard({ summary: SUMMARY }, { readOnly: true });
    expect(screen.getByText("Salary & wages")).toBeTruthy();
    expect(screen.queryByLabelText(/records-archive password/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /approve return/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /reopen/i })).toBeNull();
  });
});
