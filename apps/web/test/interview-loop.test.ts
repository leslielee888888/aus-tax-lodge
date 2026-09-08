/**
 * T6 — `applyInterviewStep` card-payload cases for `upload-or-tell` and
 * `reconcile` (PRD FR-6, FR-7). The card components only ever get `CardProps`,
 * so the data has to be baked into the turn here.
 */
import { createEmptyReturnModel } from "@aus-tax-lodge/model";
import { describe, expect, it } from "vitest";

import {
  emptyConversation,
  type AssistantCardTurn,
  type ConversationState,
} from "../lib/conversation";
import { withExtractionScratch } from "../lib/extraction-scratch";
import { applyInterviewStep } from "../lib/interview-loop";

const CONVO: ConversationState = { ...emptyConversation(), phase: "interview" };

function lastCard(state: ConversationState): AssistantCardTurn {
  const turn = state.turns.at(-1);
  if (!turn || turn.role !== "assistant" || turn.kind !== "card") {
    throw new Error("expected the last turn to be an assistant card");
  }
  return turn;
}

describe("applyInterviewStep — upload-or-tell (PRD FR-6)", () => {
  it("carries only the lead text — no documents checklist", () => {
    const next = applyInterviewStep(CONVO, {
      kind: "card",
      card: "upload-or-tell",
      text: "How much did you spend on union fees?",
    });
    const card = lastCard(next);
    expect(card.card.type).toBe("upload-or-tell");
    expect(card.card.payload).toEqual({ lead: "How much did you spend on union fees?" });
  });
});

describe("applyInterviewStep — reconcile (PRD FR-7)", () => {
  const pending = {
    modelPath: "income.interestAccounts[0].grossInterest",
    candidates: [
      {
        docId: "d1",
        documentType: "ato-prefill-report" as const,
        page: 1,
        snippet: "1,240",
        confidence: "high" as const,
        value: 1240,
      },
      {
        docId: "d2",
        documentType: "bank-interest-notice" as const,
        page: 1,
        snippet: "1,310",
        confidence: "medium" as const,
        value: 1310,
      },
    ],
  };

  it("bakes the first unresolved reconciliation from the extraction scratch into the payload", () => {
    const model = withExtractionScratch(createEmptyReturnModel("2025-26"), {
      extracted: [],
      pendingReconciliation: [pending],
    });
    const next = applyInterviewStep(
      CONVO,
      {
        kind: "card",
        card: "reconcile",
        text: "The two statements disagree on your NAB interest.",
      },
      { model },
    );
    const card = lastCard(next);
    expect(card.card.type).toBe("reconcile");
    expect(card.card.payload).toMatchObject({
      lead: "The two statements disagree on your NAB interest.",
      reconciliation: pending,
    });
  });

  it("falls back to a null reconciliation when there is no model in context", () => {
    const next = applyInterviewStep(CONVO, { kind: "card", card: "reconcile" });
    expect(lastCard(next).card.payload).toEqual({ reconciliation: null });
  });
});
