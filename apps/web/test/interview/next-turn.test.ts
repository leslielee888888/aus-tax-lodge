import {
  createEmptyReturnModel,
  propose,
  unsetField,
  type ReturnModel,
} from "@aus-tax-lodge/model";
import { describe, expect, it, vi } from "vitest";

import { deterministicallyComplete, nextTurn } from "../../lib/interview";
import type { InterviewClient } from "../../lib/interview";
import { appendTurn, emptyConversation, type ConversationState } from "../../lib/conversation";
import { confirmedField, readyModel } from "../review-fixtures";

function mockClient(reply: string): { client: InterviewClient; ask: ReturnType<typeof vi.fn> } {
  const ask = vi.fn(async () => reply);
  return { client: { ask }, ask };
}

const CONVO: ConversationState = appendTurn(
  { ...emptyConversation(), phase: "interview" },
  { role: "assistant", kind: "message", text: "I've got your salary. Did you work from home?" },
);

/** A freshly-seeded model: one salary payer proposed from the pre-fill, nothing else. */
function seededIncomeOnly(): ReturnModel {
  const base = createEmptyReturnModel();
  return {
    ...base,
    income: {
      ...base.income,
      salaryWages: [
        {
          id: "e1",
          payerName: propose(unsetField<string>(), "Acme Pty Ltd", {
            kind: "document",
            docId: "d1",
            page: 1,
            snippet: "Acme",
            confidence: "high",
          }),
          payerAbn: unsetField<string>(),
          grossSalaryWages: propose(unsetField<number>(), 95_000, {
            kind: "document",
            docId: "d1",
            page: 1,
            snippet: "95,000",
            confidence: "high",
          }),
          paygWithheld: propose(unsetField<number>(), 22_000, {
            kind: "document",
            docId: "d1",
            page: 1,
            snippet: "22,000",
            confidence: "high",
          }),
        },
      ],
    },
  };
}

/** readyModel() + a confirmed identity block — genuinely complete and validates clean. */
function completeModel(): ReturnModel {
  const base = readyModel();
  return {
    ...base,
    taxpayer: {
      fullName: confirmedField("Priya Example"),
      dateOfBirth: confirmedField("1985-03-02"),
      postalAddress: confirmedField({
        line1: "1 Test St",
        line2: "",
        suburb: "Sydney",
        state: "NSW",
        postcode: "2000",
        country: "Australia",
      }),
      taxFileNumber: confirmedField("123456782"),
      refundAccount: confirmedField({
        bsb: "062-000",
        accountNumber: "12345678",
        accountName: "Priya Example",
      }),
    },
  };
}

describe("nextTurn (PRD FR-3)", () => {
  it("passes a plain question straight through", async () => {
    const { client, ask } = mockClient(
      JSON.stringify({ kind: "ask", text: "Did you have any work-related car expenses?" }),
    );
    const step = await nextTurn({ model: seededIncomeOnly(), conversation: CONVO, client });

    expect(step).toEqual({ kind: "ask", text: "Did you have any work-related car expenses?" });
    // One Claude call per turn (PRD Q6).
    expect(ask).toHaveBeenCalledOnce();
    const [, opts] = ask.mock.calls[0]!;
    expect(opts.maxTokens).toBeLessThanOrEqual(500);
  });

  it("passes a card step through, carrying the card type and lead text", async () => {
    const { client } = mockClient(
      JSON.stringify({
        kind: "card",
        card: "income-checkpoint",
        text: "Here's the income I found.",
      }),
    );
    const step = await nextTurn({ model: seededIncomeOnly(), conversation: CONVO, client });
    expect(step).toEqual({
      kind: "card",
      card: "income-checkpoint",
      text: "Here's the income I found.",
    });
  });

  it("overrides Claude's premature 'done' with a question about the first outstanding thing", async () => {
    const model = seededIncomeOnly();
    expect(deterministicallyComplete(model)).toBe(false);

    const { client } = mockClient(JSON.stringify({ kind: "done" }));
    const step = await nextTurn({ model, conversation: CONVO, client });

    expect(step.kind).toBe("ask");
    if (step.kind === "ask") {
      expect(step.text).toMatch(/still|outstanding|need|sort out/i);
    }
  });

  it("lets 'done' through once the deterministic gate agrees", async () => {
    const model = completeModel();
    expect(deterministicallyComplete(model)).toBe(true);

    const { client } = mockClient(JSON.stringify({ kind: "done" }));
    const step = await nextTurn({ model, conversation: CONVO, client });
    expect(step).toEqual({ kind: "done" });
  });

  it("throws on a malformed Claude reply rather than guessing", async () => {
    const { client } = mockClient("not json at all");
    await expect(
      nextTurn({ model: seededIncomeOnly(), conversation: CONVO, client }),
    ).rejects.toThrow(/JSON/i);
  });
});
