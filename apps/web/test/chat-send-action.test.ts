import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadConversation, saveConversation, applyUserTurn, nextTurn, maybeRunningEstimate } =
  vi.hoisted(() => ({
    loadConversation: vi.fn(),
    saveConversation: vi.fn(),
    applyUserTurn: vi.fn(),
    nextTurn: vi.fn(),
    maybeRunningEstimate: vi.fn(),
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

vi.mock("../lib/estimate/running-estimate", () => ({ maybeRunningEstimate }));

vi.mock("../lib/review-summary", () => ({
  reviewSummaryForModel: () => ({ incomplete: false, lines: [], headline: { kind: "refund" } }),
  reopenQuestionFor: (lineKey: string) => `Let's fix ${lineKey}.`,
}));

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
  maybeRunningEstimate.mockReset();
  saveConversation.mockResolvedValue({ conflict: false, envelope: { revision: 4 } });
});

describe("sendMessage — the interview loop (PRD FR-3, FR-4)", () => {
  it("runs applyUserTurn, saves the updated model, and appends nextTurn's step", async () => {
    loadConversation.mockResolvedValue(loaded());
    applyUserTurn.mockResolvedValue({
      model: NEXT_MODEL,
      appliedPaths: ["deductions.workFromHome.hours"],
    });
    nextTurn.mockResolvedValue({ kind: "ask", text: "Did you have any donations this year?" });

    const result = await sendMessage("ret1", 3, "  I worked from home  ");

    expect(applyUserTurn).toHaveBeenCalledWith(
      expect.objectContaining({ model: MODEL, text: "I worked from home" }),
    );
    expect(nextTurn).toHaveBeenCalledWith(expect.objectContaining({ model: NEXT_MODEL }));
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
    nextTurn.mockResolvedValue({
      kind: "card",
      card: "confirm-figure",
      text: "One figure to check.",
    });

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
    expect(
      (saved.turns[1] as { card: { payload: { findings: unknown[] } } }).card.payload.findings,
    ).toHaveLength(1);
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

describe("sendMessage — failure handling (FR-14)", () => {
  const rateLimit = () => Object.assign(new Error("429 Too Many Requests"), { status: 429 });

  it("on a 429 from applyUserTurn: records the exchange, keeps the model + phase, flags a resumable pause", async () => {
    loadConversation.mockResolvedValue(loaded());
    applyUserTurn.mockRejectedValue(rateLimit());

    const result = await sendMessage("ret1", 3, "here is my answer");

    expect(nextTurn).not.toHaveBeenCalled();
    // Confirmed state untouched — the loaded model is persisted unchanged.
    expect(saveConversation).toHaveBeenCalledExactlyOnceWith(
      "ret1",
      expect.objectContaining({ model: MODEL }),
    );
    const saved = savedConversation();
    expect(saved.phase).toBe("interview");
    expect(saved.turns.map((t) => `${t.role}:${t.kind}`)).toEqual([
      "user:message",
      "assistant:message",
    ]);
    expect((saved.turns[1] as { text: string }).text).toMatch(/usage limit/i);
    // A resumable pause, distinct from a hard error.
    expect(result.rateLimited).toBe(true);
    expect(result.error).toMatch(/paused/i);
  });

  it("on a generic error from applyUserTurn: plain message, no pause flag", async () => {
    loadConversation.mockResolvedValue(loaded());
    applyUserTurn.mockRejectedValue(new Error("socket hang up"));

    const result = await sendMessage("ret1", 3, "here is my answer");

    const saved = savedConversation();
    expect(saveConversation).toHaveBeenCalledExactlyOnceWith(
      "ret1",
      expect.objectContaining({ model: MODEL }),
    );
    expect((saved.turns[1] as { text: string }).text).toMatch(/progress is saved/i);
    expect(result.rateLimited).toBeUndefined();
  });

  it("on a 429 from nextTurn: keeps applyUserTurn's applied model, flags the pause", async () => {
    loadConversation.mockResolvedValue(loaded());
    applyUserTurn.mockResolvedValue({ model: NEXT_MODEL, appliedPaths: ["deductions.donations"] });
    nextTurn.mockRejectedValue(rateLimit());

    const result = await sendMessage("ret1", 3, "I gave $200 to charity");

    // applyUserTurn's writes stand; only 'pick the next question' failed.
    expect(saveConversation).toHaveBeenCalledExactlyOnceWith(
      "ret1",
      expect.objectContaining({ model: NEXT_MODEL }),
    );
    const saved = savedConversation();
    expect(saved.phase).toBe("interview");
    expect((saved.turns.at(-1) as { text: string }).text).toMatch(/usage limit/i);
    expect(result.rateLimited).toBe(true);
  });
});

describe("sendMessage — running estimate + review corrections (PRD FR-10, FR-11)", () => {
  it("answers a running-estimate question from the engine and skips the field loop", async () => {
    loadConversation.mockResolvedValue(loaded());
    maybeRunningEstimate.mockReturnValue(
      "Right now the numbers point to a refund of about $2,000.",
    );

    await sendMessage("ret1", 3, "how's my refund looking so far?");

    expect(applyUserTurn).not.toHaveBeenCalled();
    expect(nextTurn).not.toHaveBeenCalled();
    const turns = savedConversation().turns;
    expect(turns[1]).toMatchObject({
      role: "assistant",
      kind: "message",
      text: "Right now the numbers point to a refund of about $2,000.",
    });
  });

  it("in review, a clear correction re-issues a fresh review-summary card", async () => {
    loadConversation.mockResolvedValue(
      loaded({ conversation: { ...emptyConversation(), phase: "review" } }),
    );
    maybeRunningEstimate.mockReturnValue(null);
    applyUserTurn.mockResolvedValue({
      model: NEXT_MODEL,
      appliedPaths: ["income.salaryWages[0].grossSalaryWages"],
    });

    await sendMessage("ret1", 3, "my salary should be 82,000");

    const saved = savedConversation();
    expect(saved.phase).toBe("review");
    expect(saved.turns.at(-1)).toMatchObject({ kind: "card", card: { type: "review-summary" } });
    expect(saveConversation).toHaveBeenCalledWith(
      "ret1",
      expect.objectContaining({ model: NEXT_MODEL }),
    );
  });

  it("in review, random chatter gets the canned 'use the summary' reply", async () => {
    loadConversation.mockResolvedValue(
      loaded({ conversation: { ...emptyConversation(), phase: "review" } }),
    );
    maybeRunningEstimate.mockReturnValue(null);
    applyUserTurn.mockResolvedValue({ model: MODEL, appliedPaths: [] });

    await sendMessage("ret1", 3, "thanks, looks good");

    const saved = savedConversation();
    expect(saved.phase).toBe("review");
    expect((saved.turns.at(-1) as { text: string }).text).toMatch(/summary above/i);
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
      .mockResolvedValueOnce(
        loaded({ conversation: fresh, envelope: { revision: 6, targetYear: "2025-26" } }),
      );
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
