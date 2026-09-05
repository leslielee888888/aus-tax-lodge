import type { ClaudeClient } from "@aus-tax-lodge/ai";
import { describe, expect, it, vi } from "vitest";

import {
  assembleRentalSchedule,
  confirmRepairsAreDeductible,
  needsRepairsConfirmation,
  parseAgentStatement,
  parseLoanSummary,
  parseQsSchedule,
  reclassifyRepairsAsCapital,
  type RentalSourceDocument,
} from "../src/rental-assembly";
import { computeNetRentalResult, createEmptyReturnModel, type RentalSchedule } from "../src/model";
import { propose, documentOrigin, unsetField } from "../src/provenance";

/** A ClaudeClient stub whose askVision replies come off a queue, one per call — the real API is never called. */
function queuedClient(replies: readonly string[]): ClaudeClient {
  const askVision = vi.fn();
  replies.forEach((reply) => askVision.mockResolvedValueOnce(reply));
  return { ask: vi.fn(), askVision };
}

function throwingClient(): ClaudeClient {
  return { ask: vi.fn(), askVision: vi.fn().mockRejectedValue(new Error("network")) };
}

const AGENT_STATEMENT_DOC: RentalSourceDocument = {
  docId: "doc-agent",
  bytes: Buffer.from("%PDF agent statement"),
  mimeType: "application/pdf",
};

const LOAN_SUMMARY_DOC: RentalSourceDocument = {
  docId: "doc-loan",
  bytes: Buffer.from("%PDF loan summary"),
  mimeType: "application/pdf",
};

const QS_SCHEDULE_DOC: RentalSourceDocument = {
  docId: "doc-qs",
  bytes: Buffer.from("%PDF qs schedule"),
  mimeType: "application/pdf",
};

const AGENT_STATEMENT_REPLY = JSON.stringify({
  grossRent: { amount: 26_000, page: 1, snippet: "Rent collected: $26,000.00" },
  otherRentalIncome: null,
  expenses: [
    {
      key: "agentFees",
      amount: 2_080,
      page: 1,
      snippet: "Management fee 8%: $2,080.00",
      description: "Management fee",
    },
    {
      key: "repairsAndMaintenance",
      amount: 1_200,
      page: 2,
      snippet: "Plumber — burst pipe repair: $1,200.00",
      description: "Repairs",
    },
    {
      key: "waterCharges",
      amount: 450,
      page: 2,
      snippet: "Water rates: $450.00",
      description: "Water",
    },
    {
      // Not a real RentalExpenseKey — must fall back to sundryExpenses.
      key: "bankFee",
      amount: 60,
      page: 2,
      snippet: "Bank transfer fee: $60.00",
      description: "Bank fee",
    },
  ],
});

const LOAN_SUMMARY_REPLY = JSON.stringify({
  interestOnLoans: { amount: 28_000, page: 1, snippet: "Total interest charged: $28,000.00" },
  borrowingExpenses: { amount: 120, page: 1, snippet: "Loan fee amortised this year: $120.00" },
});

const QS_SCHEDULE_REPLY = JSON.stringify({
  capitalWorks: { amount: 3_000, page: 3, snippet: "2025-26 Division 43: $3,000" },
  declineInValue: { amount: 1_500, page: 3, snippet: "2025-26 Division 40: $1,500" },
});

describe("parseAgentStatement (PRD FR-24, FR-3)", () => {
  it("maps every line item to a RentalExpenseKey, falling back to sundryExpenses", async () => {
    const client = queuedClient([AGENT_STATEMENT_REPLY]);
    const result = await parseAgentStatement(AGENT_STATEMENT_DOC, client);

    expect(result.grossRent).toEqual({ amount: 26_000, page: 1, snippet: "Rent collected: $26,000.00" });
    expect(result.otherRentalIncome).toBeNull();
    expect(result.lineItems).toEqual([
      expect.objectContaining({ key: "agentFees", amount: 2_080 }),
      expect.objectContaining({ key: "repairsAndMaintenance", amount: 1_200 }),
      expect.objectContaining({ key: "waterCharges", amount: 450 }),
      expect.objectContaining({ key: "sundryExpenses", amount: 60, description: "Bank fee" }),
    ]);
  });

  it("sends the document as a vision part and never throws on a bad reply", async () => {
    const client = queuedClient(["not json at all"]);
    const result = await parseAgentStatement(AGENT_STATEMENT_DOC, client);
    expect(result).toEqual({ grossRent: null, otherRentalIncome: null, lineItems: [] });
    const [parts] = vi.mocked(client.askVision).mock.calls[0]!;
    expect(parts[0]).toMatchObject({ kind: "pdf", mimeType: "application/pdf" });
  });

  it("never throws when the Claude call itself fails", async () => {
    await expect(parseAgentStatement(AGENT_STATEMENT_DOC, throwingClient())).resolves.toEqual({
      grossRent: null,
      otherRentalIncome: null,
      lineItems: [],
    });
  });
});

describe("parseLoanSummary (PRD FR-24, Q25)", () => {
  it("extracts interest and the year's borrowing-expense portion", async () => {
    const client = queuedClient([LOAN_SUMMARY_REPLY]);
    const result = await parseLoanSummary(LOAN_SUMMARY_DOC, client);
    expect(result.interestOnLoans).toEqual({
      amount: 28_000,
      page: 1,
      snippet: "Total interest charged: $28,000.00",
    });
    expect(result.borrowingExpenses).toEqual({
      amount: 120,
      page: 1,
      snippet: "Loan fee amortised this year: $120.00",
    });
  });

  it("leaves borrowingExpenses null when the statement doesn't show one", async () => {
    const client = queuedClient([
      JSON.stringify({
        interestOnLoans: { amount: 10_000, page: 1, snippet: "Interest: $10,000" },
        borrowingExpenses: null,
      }),
    ]);
    const result = await parseLoanSummary(LOAN_SUMMARY_DOC, client);
    expect(result.borrowingExpenses).toBeNull();
  });
});

describe("parseQsSchedule (PRD FR-24, Q23)", () => {
  it("extracts the target year's Div 43 and Div 40 totals", async () => {
    const client = queuedClient([QS_SCHEDULE_REPLY]);
    const result = await parseQsSchedule(QS_SCHEDULE_DOC, client, "2025-26");
    expect(result.capitalWorks).toEqual({ amount: 3_000, page: 3, snippet: "2025-26 Division 43: $3,000" });
    expect(result.declineInValue).toEqual({
      amount: 1_500,
      page: 3,
      snippet: "2025-26 Division 40: $1,500",
    });
    const [, prompt] = vi.mocked(client.askVision).mock.calls[0]!;
    expect(prompt).toContain("2025-26");
    expect(prompt).toContain("30 June 2026");
  });
});

describe("assembleRentalSchedule (PRD FR-24)", () => {
  it("assembles all three documents plus owner-paid items into a negatively-geared schedule", async () => {
    const client = queuedClient([AGENT_STATEMENT_REPLY, LOAN_SUMMARY_REPLY, QS_SCHEDULE_REPLY]);
    const model = createEmptyReturnModel();

    const schedule = await assembleRentalSchedule(
      model,
      { agentStatement: AGENT_STATEMENT_DOC, loanSummary: LOAN_SUMMARY_DOC, qsSchedule: QS_SCHEDULE_DOC },
      client,
      { insurance: 900, landTax: 1_100 },
    );

    expect(schedule.present).toBe(true);
    expect(schedule.grossRent.value).toBe(26_000);
    expect(schedule.grossRent.status).toBe("proposed");
    expect(schedule.grossRent.origin).toEqual(
      documentOrigin("doc-agent", 1, "Rent collected: $26,000.00", "medium"),
    );

    expect(schedule.expenses.agentFees).toMatchObject({ amount: { value: 2_080 }, source: "agent-statement" });
    expect(schedule.expenses.repairsAndMaintenance).toMatchObject({
      amount: { value: 1_200 },
      source: "agent-statement",
    });
    expect(schedule.expenses.waterCharges).toMatchObject({ amount: { value: 450 } });
    expect(schedule.expenses.sundryExpenses).toMatchObject({ amount: { value: 60 } });

    expect(schedule.expenses.interestOnLoans).toMatchObject({
      amount: { value: 28_000 },
      source: "loan-summary",
    });
    expect(schedule.expenses.borrowingExpenses).toMatchObject({
      amount: { value: 120 },
      source: "loan-summary",
    });

    expect(schedule.expenses.capitalWorks).toMatchObject({ amount: { value: 3_000 }, source: "qs-schedule" });
    expect(schedule.expenses.declineInValue).toMatchObject({
      amount: { value: 1_500 },
      source: "qs-schedule",
    });

    // Owner-paid: answered (the user's own fact), not proposed from a document.
    expect(schedule.expenses.insurance).toMatchObject({
      amount: { value: 900, status: "confirmed", origin: { kind: "user-answer" } },
      source: "owner-paid",
    });
    expect(schedule.expenses.landTax).toMatchObject({
      amount: { value: 1_100, status: "confirmed", origin: { kind: "user-answer" } },
      source: "owner-paid",
    });
    // bodyCorporate not paid by the owner here — left untouched (unset).
    expect(schedule.expenses.bodyCorporate.amount.status).toBe("unset");

    // net rental result = gross rent − total deductions, negative when geared.
    const totalDeductions =
      2_080 + 1_200 + 450 + 60 + 28_000 + 120 + 3_000 + 1_500 + 900 + 1_100;
    expect(schedule.netRentalResult.value).toBe(26_000 - totalDeductions);
    expect(schedule.netRentalResult.value).toBeLessThan(0);
    expect(schedule.netRentalResult).toEqual({
      ...schedule.netRentalResult,
      value: computeNetRentalResult(schedule),
    });
  });

  it("leaves capital works / decline in value unset without a QS schedule (Q23)", async () => {
    const client = queuedClient([AGENT_STATEMENT_REPLY, LOAN_SUMMARY_REPLY]);
    const model = createEmptyReturnModel();

    const schedule = await assembleRentalSchedule(
      model,
      { agentStatement: AGENT_STATEMENT_DOC, loanSummary: LOAN_SUMMARY_DOC },
      client,
    );

    expect(schedule.expenses.capitalWorks.amount.status).toBe("unset");
    expect(schedule.expenses.declineInValue.amount.status).toBe("unset");
    expect(client.askVision).toHaveBeenCalledTimes(2);
  });

  it("assembles from owner-paid entries alone with no documents", async () => {
    const client = queuedClient([]);
    const model = createEmptyReturnModel();

    const schedule = await assembleRentalSchedule(model, {}, client, { bodyCorporate: 600 });

    expect(schedule.present).toBe(true);
    expect(schedule.expenses.bodyCorporate).toMatchObject({ amount: { value: 600 }, source: "owner-paid" });
    expect(schedule.netRentalResult.value).toBe(-600);
    expect(client.askVision).not.toHaveBeenCalled();
  });
});

function scheduleWithRepairs(amount: number): RentalSchedule {
  const base = createEmptyReturnModel().rental;
  return {
    ...base,
    present: true,
    grossRent: propose(unsetField<number>(), 10_000, documentOrigin("d", 1, "rent", "medium")),
    expenses: {
      ...base.expenses,
      repairsAndMaintenance: {
        amount: propose(unsetField<number>(), amount, documentOrigin("d", 1, "repairs", "medium")),
        source: "agent-statement",
      },
    },
  };
}

describe("needsRepairsConfirmation (PRD Q25, FR-13, FR-24)", () => {
  it("is true for a repairs line over the $1,000 threshold", () => {
    expect(needsRepairsConfirmation(scheduleWithRepairs(1_200))).toBe(true);
  });

  it("is false for a repairs line at or under the threshold", () => {
    expect(needsRepairsConfirmation(scheduleWithRepairs(800))).toBe(false);
    expect(needsRepairsConfirmation(scheduleWithRepairs(1_000))).toBe(false);
  });

  it("is false once the user has confirmed it a genuine repair", () => {
    const confirmed = confirmRepairsAreDeductible(scheduleWithRepairs(1_200));
    expect(needsRepairsConfirmation(confirmed)).toBe(false);
    expect(confirmed.repairsConfirmedNotCapital).toBe(true);
  });
});

describe("reclassifyRepairsAsCapital (PRD Q25, FR-13, FR-24)", () => {
  it("moves the amount from repairs into capital works and re-nets, without changing the total deduction", () => {
    const schedule = scheduleWithRepairs(1_200);
    const before = computeNetRentalResult(schedule);

    const reclassified = reclassifyRepairsAsCapital(schedule);

    expect(reclassified.expenses.repairsAndMaintenance.amount.value).toBe(0);
    expect(reclassified.expenses.repairsAndMaintenance.amount.origin).toMatchObject({ kind: "computed" });
    expect(reclassified.expenses.capitalWorks.amount.value).toBe(1_200);
    expect(reclassified.expenses.capitalWorks.amount.origin).toMatchObject({ kind: "computed" });
    expect(reclassified.repairsConfirmedNotCapital).toBe(false);
    expect(needsRepairsConfirmation(reclassified)).toBe(false);

    // Moving between deduction buckets doesn't change the net rental result.
    expect(reclassified.netRentalResult.value).toBe(before);
  });

  it("adds to an existing capital works figure rather than overwriting it", () => {
    const base = scheduleWithRepairs(1_200);
    const withExistingCapitalWorks: RentalSchedule = {
      ...base,
      expenses: {
        ...base.expenses,
        capitalWorks: {
          amount: propose(unsetField<number>(), 3_000, documentOrigin("qs", 1, "div 43", "medium")),
          source: "qs-schedule",
        },
      },
    };

    const reclassified = reclassifyRepairsAsCapital(withExistingCapitalWorks);
    expect(reclassified.expenses.capitalWorks.amount.value).toBe(4_200);
  });
});
