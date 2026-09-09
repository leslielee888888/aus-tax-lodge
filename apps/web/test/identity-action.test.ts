/**
 * #88 / T15 — the `provideIdentity` card action (PRD FR-1, FR-17). Writes the
 * TFN + refund bank account onto the model, then advances the interview like
 * any other card. The one thing every test here really guards: the raw
 * values must NEVER land in the persisted conversation turns.
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

import { provideIdentity } from "../app/returns/[returnId]/actions";
import { emptyConversation, type ConversationState } from "../lib/conversation";

const VALID = {
  tfn: "123456782",
  bsb: "062-000",
  accountNumber: "87654321",
  accountName: "Priya Example",
};

function loaded(overrides: Record<string, unknown> = {}) {
  return {
    envelope: { revision: 3, targetYear: "2025-26" },
    model: createEmptyReturnModel("2025-26"),
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
  nextTurn.mockResolvedValue({ kind: "done" });
});

describe("provideIdentity (PRD FR-1, FR-17, #88 / T15)", () => {
  it("writes the TFN and refund account onto the model with user-answer provenance", async () => {
    const result = await provideIdentity("ret1", 3, "card1", VALID);

    expect(result.error).toBeUndefined();
    expect(result.revision).toBe(4);
    const model = savedModel();
    expect(model.taxpayer.taxFileNumber).toMatchObject({
      value: "123456782",
      status: "confirmed",
      origin: { kind: "user-answer" },
    });
    expect(model.taxpayer.refundAccount).toMatchObject({
      value: { bsb: "062-000", accountNumber: "87654321", accountName: "Priya Example" },
      status: "confirmed",
    });
  });

  it("normalises an unhyphenated BSB and strips non-digits from the account number", async () => {
    await provideIdentity("ret1", 3, "card1", {
      ...VALID,
      bsb: "062000",
      accountNumber: "8765 4321",
    });
    const model = savedModel();
    expect(model.taxpayer.refundAccount.value).toMatchObject({
      bsb: "062-000",
      accountNumber: "87654321",
    });
  });

  it("the card-response turn carries ONLY `{ provided: true }` — never the values (PRD FR-17)", async () => {
    await provideIdentity("ret1", 3, "card1", VALID);
    const responseTurn = savedConversation().turns.find((t) => t.kind === "card-response");
    expect(responseTurn).toMatchObject({ cardId: "card1", response: { provided: true } });

    const serialized = JSON.stringify(savedConversation());
    expect(serialized).not.toContain(VALID.tfn);
    expect(serialized).not.toContain(VALID.accountNumber);
    expect(serialized).not.toContain(VALID.bsb);
  });

  it("advances the interview after writing the fields", async () => {
    await provideIdentity("ret1", 3, "card1", VALID);
    expect(nextTurn).toHaveBeenCalledOnce();
  });

  it("rejects an invalid TFN without saving anything, or leaking the value into the error", async () => {
    const result = await provideIdentity("ret1", 3, "card1", { ...VALID, tfn: "999999999" });
    expect(result.error).toBeTruthy();
    expect(result.error).not.toContain("999999999");
    expect(saveConversation).not.toHaveBeenCalled();
  });

  it("rejects a malformed BSB without saving anything", async () => {
    const result = await provideIdentity("ret1", 3, "card1", { ...VALID, bsb: "12" });
    expect(result.error).toBeTruthy();
    expect(saveConversation).not.toHaveBeenCalled();
  });

  it("rejects a missing account name without saving anything", async () => {
    const result = await provideIdentity("ret1", 3, "card1", { ...VALID, accountName: "   " });
    expect(result.error).toBeTruthy();
    expect(saveConversation).not.toHaveBeenCalled();
  });

  it("refuses to write on a read-only return", async () => {
    loadConversation.mockResolvedValue(loaded({ readOnly: true }));
    const result = await provideIdentity("ret1", 3, "card1", VALID);
    expect(result.error).toMatch(/locked/i);
    expect(saveConversation).not.toHaveBeenCalled();
  });

  it("refuses to write outside the interview phase", async () => {
    loadConversation.mockResolvedValue(
      loaded({ conversation: { ...emptyConversation(), phase: "review" } }),
    );
    const result = await provideIdentity("ret1", 3, "card1", VALID);
    expect(result.error).toBeTruthy();
    expect(saveConversation).not.toHaveBeenCalled();
  });
});
