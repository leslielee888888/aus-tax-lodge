import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadConversation, saveConversation, applyUserTurn, nextTurn } = vi.hoisted(() => ({
  loadConversation: vi.fn(),
  saveConversation: vi.fn(),
  applyUserTurn: vi.fn(),
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

vi.mock("../lib/interview", () => ({ applyUserTurn, nextTurn }));

import { sendMessage } from "../app/returns/[returnId]/actions";
import { appendTurn, emptyConversation, type ConversationState } from "../lib/conversation";

const MODEL = { modelVersion: 1 } as const;
const NEXT_MODEL = { modelVersion: 1, updated: true } as const;

function loaded(overrides: Record<string, unknown> = {}) {
  return {
    envelope: { revision: 3, targetYear: "2025-26" },
    model: MODEL,
    conversation: { ...emptyConversation(), phase: "interview" } as ConversationState,
    readOnly: false,
    ...overrides,
  };
}

function savedConversation(): ConversationState {
  return saveConversation.mock.calls[0]![1].conversation as ConversationState;
}

beforeEach(() => {
  loadConversation.mockReset();
  saveConversation.mockReset();
  applyUserTurn.mockReset();
  nextTurn.mockReset();
  saveConversation.mockResolvedValue({ conflict: false, envelope: { revision: 4 } });
});

describe("sendMessage — the interview loop (PRD FR-3, FR-4)", () => {
  it("runs applyUserTurn, saves the updated model, and appends nextTurn's step", async () => {
    loadConversation.mockResolvedValue(loaded());
    applyUserTurn.mockResolvedValue({ model: NEXT_MODEL, appliedPaths: ["deductions.workFromHome.hours"] });
    nextTurn.mockResolvedValue({ kind: "ask", text: "Did you have any donations this year?" });

    const result = await sendMessage("ret1", 3, "  I worked from home  ");

    expect(applyUserTurn).toHaveBeenCalledWith(
      expect.objectContaining({ model: MODEL, text: "I worked from home" }),
    );
    expect(nextTurn).toHaveBeenCalledWith(
      expect.objectContaining({ model: NEXT_MODEL }),
    );
    expect(saveConversation).toHaveBeenCalledExactlyOnceWith(
      "ret1",
      expect.objectContaining({ expectedRevision: 3, model: NEXT_MODEL }),
    );

    const turns = savedConversation().turns;
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({ role: "user", kind: "message", text: "I worked from home" });
    expect(turns[1]).toMatchObject({
      role: "assistant",
      kind: "message",
      text: "Did you have any donations this year?",
    });
    expect(result.revision).toBe(4);
  });

  it("maps a card step to an assistant card turn carrying the lead text", async () => {
    loadConversation.mockResolvedValue(loaded());
    applyUserTurn.mockResolvedValue({ model: NEXT_MODEL, appliedPaths: [] });
    nextTurn.mockResolvedValue({ kind: "card", card: "confirm-figure", text: "One figure to check." });

    await sendMessage("ret1", 3, "here you go");

    const cardTurn = savedConversation().turns[1];
    expect(cardTurn).toMatchObject({
      role: "assistant",
      kind: "card",
      card: { type: "confirm-figure", payload: { lead: "One figure to check." } },
    });
  });

  it("moves to review on a done step", async () => {
    loadConversation.mockResolvedValue(loaded());
    applyUserTurn.mockResolvedValue({ model: NEXT_MODEL, appliedPaths: [] });
    nextTurn.mockResolvedValue({ kind: "done" });

    await sendMessage("ret1", 3, "that's everything");

    const saved = savedConversation();
    expect(saved.phase).toBe("review");
    expect(saved.turns[1]).toMatchObject({ kind: "card", card: { type: "review-summary" } });
  });

  it("hard-stops on an out-of-scope finding and does NOT persist the updated model", async () => {
    loadConversation.mockResolvedValue(loaded());
    applyUserTurn.mockResolvedValue({
      model: NEXT_MODEL,
      appliedPaths: [],
      outOfScope: [
        { code: "capital-gains", item: "Capital gains event", detail: "…", source: "answer" },
      ],
    });

    const result = await sendMessage("ret1", 3, "I sold some shares");

    expect(nextTurn).not.toHaveBeenCalled();
    expect(saveConversation).toHaveBeenCalledExactlyOnceWith(
      "ret1",
      expect.objectContaining({ model: MODEL }), // the loaded model, not NEXT_MODEL
    );
    const saved = savedConversation();
    expect(saved.phase).toBe("stopped");
    expect(saved.stoppedReason).toBe("Capital gains event");
    expect(saved.turns[1]).toMatchObject({
      role: "assistant",
      kind: "card",
      card: { type: "out-of-scope" },
    });
    expect((saved.turns[1] as { card: { payload: { findings: unknown[] } } }).card.payload.findings)
      .toHaveLength(1);
    expect(result.revision).toBe(4);
  });

  it("shows a clarifying question and does not advance the model", async () => {
    loadConversation.mockResolvedValue(loaded());
    applyUserTurn.mockResolvedValue({
      model: MODEL,
      appliedPaths: [],
      clarify: "How much was tools, and how much union fees?",
    });

    await sendMessage("ret1", 3, "about two grand for tools and union fees");

    expect(nextTurn).not.toHaveBeenCalled();
    expect(saveConversation).toHaveBeenCalledExactlyOnceWith(
      "ret1",
      expect.objectContaining({ model: MODEL }),
    );
    const turns = savedConversation().turns;
    expect(turns[1]).toMatchObject({
      role: "assistant",
      kind: "message",
      text: "How much was tools, and how much union fees?",
    });
  });

  it("does not crash when applyUserTurn throws — nudges the user to retry, model untouched", async () => {
    loadConversation.mockResolvedValue(loaded());
    applyUserTurn.mockRejectedValue(new Error("Claude 429"));

    const result = await sendMessage("ret1", 3, "here is my answer");

    expect(nextTurn).not.toHaveBeenCalled();
    expect(saveConversation).toHaveBeenCalledExactlyOnceWith(
      "ret1",
      expect.objectContaining({ model: MODEL }),
    );
    expect(savedConversation().turns[1]).toMatchObject({ role: "assistant", kind: "message" });
    expect(result.error).toBeUndefined();
  });
});

describe("sendMessage — outside the interview (PRD FR-1)", () => {
  it("nudges the user to the drop zone when they type in the upload phase", async () => {
    loadConversation.mockResolvedValue(
      loaded({ conversation: emptyConversation() }), // phase: "upload"
    );

    await sendMessage("ret1", 3, "my salary was 95000");

    expect(applyUserTurn).not.toHaveBeenCalled();
    const turns = savedConversation().turns;
    expect(turns[1]).toMatchObject({ role: "assistant", kind: "message" });
    expect((turns[1] as { text: string }).text).toMatch(/pre-fill report/i);
  });

  it("tells the user the chat is closed once the conversation has stopped", async () => {
    loadConversation.mockResolvedValue(
      loaded({
        conversation: { ...emptyConversation(), phase: "stopped", stoppedReason: "x" },
      }),
    );

    await sendMessage("ret1", 3, "can we keep going?");

    expect(applyUserTurn).not.toHaveBeenCalled();
    expect((savedConversation().turns[1] as { text: string }).text).toMatch(/stopped/i);
  });
});

describe("sendMessage — guards (PRD FR-12)", () => {
  it("surfaces a conflict and returns the server's fresh conversation", async () => {
    const fresh = appendTurn(emptyConversation(), {
      role: "assistant",
      kind: "message",
      text: "fresh",
    });
    loadConversation
      .mockResolvedValueOnce(loaded({ envelope: { revision: 5, targetYear: "2025-26" } }))
      .mockResolvedValueOnce(loaded({ conversation: fresh, envelope: { revision: 6, targetYear: "2025-26" } }));
    applyUserTurn.mockResolvedValue({ model: NEXT_MODEL, appliedPaths: [] });
    nextTurn.mockResolvedValue({ kind: "say", text: "ok" });
    saveConversation.mockResolvedValue({ conflict: true, current: { revision: 6 } });

    const result = await sendMessage("ret1", 5, "hello");

    expect(result.conflict).toBe(true);
    expect(result.revision).toBe(6);
    expect(result.conversation).toBe(fresh);
  });

  it("refuses a read-only return without saving", async () => {
    loadConversation.mockResolvedValue(loaded({ readOnly: true }));
    const result = await sendMessage("ret1", 3, "hello");
    expect(saveConversation).not.toHaveBeenCalled();
    expect(result.error).toMatch(/locked/i);
  });

  it("rejects an empty message without saving", async () => {
    loadConversation.mockResolvedValue(loaded());
    const result = await sendMessage("ret1", 3, "   ");
    expect(saveConversation).not.toHaveBeenCalled();
    expect(result.error).toMatch(/type a message/i);
  });

  it("reports a load failure instead of throwing", async () => {
    loadConversation.mockRejectedValue(new Error("decrypt failed"));
    const result = await sendMessage("ret1", 3, "hello");
    expect(result.error).toMatch(/couldn't load/i);
    expect(saveConversation).not.toHaveBeenCalled();
  });
});
