import {
  createEmptyInterestAccount,
  createEmptyReturnModel,
  documentOrigin,
  propose,
  unsetField,
  type ReturnModel,
} from "@aus-tax-lodge/model";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadConversation, saveConversation, nextTurn } = vi.hoisted(() => ({
  loadConversation: vi.fn(),
  saveConversation: vi.fn(),
  nextTurn: vi.fn(),
}));

vi.mock("../lib/returns", () => ({
  loadConversation,
  saveConversation,
  ConversationReadOnlyError: class ConversationReadOnlyError extends Error {},
}));
vi.mock("../lib/ai/client", () => ({ getClaudeClient: () => ({ ask: vi.fn() }) }));
vi.mock("../lib/interview", () => ({ nextTurn }));

import {
  confirmIncome,
  correctIncome,
  resolveConfirmation,
} from "../app/returns/[returnId]/actions";
import {
  emptyConversation,
  type ConversationState,
  type PendingConfirmation,
} from "../lib/conversation";

const CONFIDENCE_DOC = (c: "high" | "low") => documentOrigin("d1", 1, "x", c);

function seededModel(): ReturnModel {
  const base = createEmptyReturnModel("2025-26");
  return {
    ...base,
    income: {
      ...base.income,
      interestAccounts: [
        {
          ...createEmptyInterestAccount("a1"),
          institution: propose(unsetField<string>(), "Southbank Mutual", CONFIDENCE_DOC("high")),
          grossInterest: propose(unsetField<number>(), 312, CONFIDENCE_DOC("low")),
          ownershipSharePercent: propose(unsetField<number>(), 100, CONFIDENCE_DOC("high")),
        },
      ],
    },
  };
}

function loaded(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    envelope: { revision: 3, targetYear: "2025-26" },
    model: seededModel(),
    conversation: { ...emptyConversation(), phase: "interview" } as ConversationState,
    readOnly: false,
    ...overrides,
  };
}

const savedConversation = (): ConversationState =>
  saveConversation.mock.calls[0]![1].conversation as ConversationState;
const savedModel = (): ReturnModel => saveConversation.mock.calls[0]![1].model as ReturnModel;

beforeEach(() => {
  loadConversation.mockReset();
  saveConversation.mockReset();
  nextTurn.mockReset();
  saveConversation.mockResolvedValue({ conflict: false, envelope: { revision: 4 } });
  nextTurn.mockResolvedValue({ kind: "ask", text: "Did you work from home this year?" });
});

describe("confirmIncome (PRD FR-5, checkpoint 1)", () => {
  it("bulk-confirms proposed income, appends the card-response + next turn, saves", async () => {
    loadConversation.mockResolvedValue(loaded());

    const result = await confirmIncome("r1", 3, "card1");

    expect(savedModel().income.interestAccounts[0]!.grossInterest.status).toBe("confirmed");
    const turns = savedConversation().turns;
    expect(turns[0]).toMatchObject({ role: "user", kind: "card-response", cardId: "card1" });
    expect(turns[1]).toMatchObject({ role: "assistant", kind: "message", text: /work from home/i });
    expect(result.revision).toBe(4);
  });

  it("refuses a read-only return without saving", async () => {
    loadConversation.mockResolvedValue(loaded({ readOnly: true }));
    const result = await confirmIncome("r1", 3, "card1");
    expect(saveConversation).not.toHaveBeenCalled();
    expect(result.error).toMatch(/locked/i);
  });
});

describe("correctIncome (PRD FR-5)", () => {
  it("edit()s a corrected line, keeps the original, flags it user-corrected", async () => {
    loadConversation.mockResolvedValue(loaded());

    await correctIncome("r1", 3, "card1", [
      { modelPath: "income.interestAccounts[0].grossInterest", value: 820 },
    ]);

    const field = savedModel().income.interestAccounts[0]!.grossInterest;
    expect(field.value).toBe(820);
    expect(field.proposedValue).toBe(312);
    expect(field.edits.at(-1)).toMatchObject({ from: 312, to: 820 });

    const convo = savedConversation();
    expect(convo.turns[0]).toMatchObject({ role: "user", kind: "card-response" });
    const flagged = convo.pendingConfirmations.find(
      (c) => c.modelPath === "income.interestAccounts[0].grossInterest",
    );
    expect(flagged).toMatchObject({ reason: "user-corrected", value: 820, resolved: false });
  });

  it("with no specific corrections, posts a message so the assistant can ask", async () => {
    loadConversation.mockResolvedValue(loaded());
    await correctIncome("r1", 3, "card1", []);
    expect(savedConversation().turns[0]).toMatchObject({
      role: "user",
      kind: "message",
      text: /something's off/i,
    });
  });
});

describe("resolveConfirmation (PRD FR-5, between the checkpoints)", () => {
  const confirmation: PendingConfirmation = {
    id: "pc:income.interestAccounts[0].grossInterest",
    modelPath: "income.interestAccounts[0].grossInterest",
    label: "Gross interest — Southbank Mutual",
    value: 312,
    source: "your pre-fill report",
    reason: "low-confidence",
    resolved: false,
  };

  function loadedWithConfirmation() {
    return loaded({
      conversation: {
        ...emptyConversation(),
        phase: "interview",
        pendingConfirmations: [confirmation],
      } as ConversationState,
    });
  }

  it("accept → confirm() the figure and mark the confirmation resolved", async () => {
    loadConversation.mockResolvedValue(loadedWithConfirmation());

    await resolveConfirmation("r1", 3, "card1", confirmation.id, { accept: true });

    expect(savedModel().income.interestAccounts[0]!.grossInterest.status).toBe("confirmed");
    const flagged = savedConversation().pendingConfirmations.find((c) => c.id === confirmation.id);
    expect(flagged?.resolved).toBe(true);
  });

  it("edit → edit() to the new value, original preserved, confirmation resolved", async () => {
    loadConversation.mockResolvedValue(loadedWithConfirmation());

    await resolveConfirmation("r1", 3, "card1", confirmation.id, { accept: false, value: 340 });

    const field = savedModel().income.interestAccounts[0]!.grossInterest;
    expect(field.value).toBe(340);
    expect(field.proposedValue).toBe(312);
    const flagged = savedConversation().pendingConfirmations.find((c) => c.id === confirmation.id);
    expect(flagged).toMatchObject({ resolved: true, value: 340 });
  });

  it("edit with no number is rejected without saving", async () => {
    loadConversation.mockResolvedValue(loadedWithConfirmation());
    const result = await resolveConfirmation("r1", 3, "card1", confirmation.id, { accept: false });
    expect(saveConversation).not.toHaveBeenCalled();
    expect(result.error).toMatch(/number/i);
  });

  describe("failure handling in a card action (FR-14)", () => {
    const rateLimit = () => Object.assign(new Error("429"), { status: 429 });

    it("a 429 while advancing the interview: the card's write stands, phase held, pause flagged", async () => {
      loadConversation.mockResolvedValue(loadedWithConfirmation());
      nextTurn.mockRejectedValue(rateLimit());

      const result = await resolveConfirmation("r1", 3, "card1", confirmation.id, { accept: true });

      // The confirmation was still applied + recorded — only 'next question' failed.
      expect(savedModel().income.interestAccounts[0]!.grossInterest.status).toBe("confirmed");
      const saved = savedConversation();
      expect(saved.phase).toBe("interview");
      expect((saved.turns.at(-1) as { text: string }).text).toMatch(/usage limit/i);
      expect(result.rateLimited).toBe(true);
    });

    it("a generic error while advancing: plain message, no pause flag", async () => {
      loadConversation.mockResolvedValue(loadedWithConfirmation());
      nextTurn.mockRejectedValue(new Error("upstream 503"));

      const result = await resolveConfirmation("r1", 3, "card1", confirmation.id, { accept: true });

      expect((savedConversation().turns.at(-1) as { text: string }).text).toMatch(
        /progress is saved/i,
      );
      expect(result.rateLimited).toBeUndefined();
    });
  });
});
