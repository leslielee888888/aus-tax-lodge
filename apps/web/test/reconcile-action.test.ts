/**
 * T6 — the `resolveReconcile` card action (PRD FR-7). A pick applies the chosen
 * candidate via `@aus-tax-lodge/extraction`'s `resolveReconciliation`, removes
 * the entry from the `__t16Extraction` scratch, and advances the interview.
 */
import { createEmptyReturnModel, type ReturnModel } from "@aus-tax-lodge/model";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadConversation, saveConversation, nextTurn } = vi.hoisted(() => ({
  loadConversation: vi.fn(),
  saveConversation: vi.fn(),
  nextTurn: vi.fn(),
}));

vi.mock("../lib/returns", () => ({
  loadConversation,
  saveConversation,
  getReturnRepository: () => ({ deleteReturn: vi.fn() }),
  ConversationReadOnlyError: class ConversationReadOnlyError extends Error {},
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("../lib/ai/client", () => ({ getClaudeClient: () => ({ ask: vi.fn() }) }));
vi.mock("../lib/interview", () => ({ nextTurn }));

import { resolveReconcile } from "../app/returns/[returnId]/actions";
import { emptyConversation, type ConversationState } from "../lib/conversation";
import { readExtractionScratch, withExtractionScratch } from "../lib/extraction-scratch";

const PENDING = {
  modelPath: "income.governmentAllowances",
  candidates: [
    {
      docId: "d1",
      documentType: "ato-prefill-report" as const,
      page: 1,
      snippet: "$500",
      confidence: "high" as const,
      value: 500,
    },
    {
      docId: "d2",
      documentType: "income-statement" as const,
      page: 1,
      snippet: "$620",
      confidence: "medium" as const,
      value: 620,
    },
  ],
};

function modelWithMismatch(): ReturnModel {
  return withExtractionScratch(createEmptyReturnModel("2025-26"), {
    extracted: [],
    pendingReconciliation: [PENDING],
  });
}

function loaded(overrides: Record<string, unknown> = {}) {
  return {
    envelope: { revision: 3, targetYear: "2025-26" },
    model: modelWithMismatch(),
    conversation: { ...emptyConversation(), phase: "interview" } as ConversationState,
    readOnly: false,
    ...overrides,
  };
}

const savedModel = (): ReturnModel => saveConversation.mock.calls[0]![1].model as ReturnModel;
const savedConversation = (): ConversationState =>
  saveConversation.mock.calls[0]![1].conversation as ConversationState;

beforeEach(() => {
  loadConversation.mockReset();
  saveConversation.mockReset();
  nextTurn.mockReset();
  loadConversation.mockResolvedValue(loaded());
  saveConversation.mockResolvedValue({ conflict: false, envelope: { revision: 4 } });
  nextTurn.mockResolvedValue({ kind: "ask", text: "What about donations?" });
});

describe("resolveReconcile (PRD FR-7)", () => {
  it("applies the chosen candidate, clears the scratch entry and advances the interview", async () => {
    const result = await resolveReconcile("ret1", 3, "card1", "income.governmentAllowances", 1);

    expect(result.revision).toBe(4);
    const model = savedModel();
    expect(model.income.governmentAllowances.value).toBe(620);
    expect(model.income.governmentAllowances.status).toBe("proposed"); // resolved via propose(), confirmed later
    expect(readExtractionScratch(model).pendingReconciliation).toEqual([]);

    const kinds = savedConversation().turns.map((t) => `${t.role}:${t.kind}`);
    expect(kinds).toEqual(["user:card-response", "assistant:message"]);
    expect(nextTurn).toHaveBeenCalledOnce();
  });

  it("rejects an out-of-range / stale pick without touching the model", async () => {
    const result = await resolveReconcile("ret1", 3, "card1", "income.governmentAllowances", 9);
    expect(result.error).toMatch(/waiting to be resolved/i);
    expect(saveConversation).not.toHaveBeenCalled();
  });

  it("rejects a pick for a path that is no longer pending", async () => {
    const result = await resolveReconcile("ret1", 3, "card1", "income.reportableFringeBenefits", 0);
    expect(result.error).toMatch(/waiting to be resolved/i);
    expect(saveConversation).not.toHaveBeenCalled();
  });
});
