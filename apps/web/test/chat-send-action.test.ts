import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadConversation, saveConversation } = vi.hoisted(() => ({
  loadConversation: vi.fn(),
  saveConversation: vi.fn(),
}));

vi.mock("../lib/returns", () => ({
  loadConversation,
  saveConversation,
  ConversationReadOnlyError: class ConversationReadOnlyError extends Error {},
}));

import { sendMessage } from "../app/returns/[returnId]/actions";
import { emptyConversation } from "../lib/conversation";

function loaded(overrides: Record<string, unknown> = {}) {
  return {
    envelope: { revision: 3, targetYear: "2025-26" },
    model: { modelVersion: 1 },
    conversation: emptyConversation(),
    readOnly: false,
    ...overrides,
  };
}

describe("sendMessage server action (PRD FR-1, FR-12)", () => {
  beforeEach(() => {
    loadConversation.mockReset();
    saveConversation.mockReset();
  });

  it("appends the user turn and a placeholder assistant turn, then saves", async () => {
    loadConversation.mockResolvedValue(loaded());
    saveConversation.mockResolvedValue({
      conflict: false,
      envelope: { revision: 4 },
    });

    const result = await sendMessage("ret1", 3, "  I worked from home  ");

    expect(saveConversation).toHaveBeenCalledExactlyOnceWith(
      "ret1",
      expect.objectContaining({ expectedRevision: 3, model: { modelVersion: 1 } }),
    );
    const savedTurns = saveConversation.mock.calls[0]![1].conversation.turns;
    expect(savedTurns).toHaveLength(2);
    expect(savedTurns[0]).toMatchObject({
      role: "user",
      kind: "message",
      text: "I worked from home",
    });
    expect(savedTurns[1]).toMatchObject({ role: "assistant", kind: "message" });
    expect(savedTurns[1].text).toMatch(/wired in T4/i);

    expect(result.conversation.turns).toHaveLength(2);
    expect(result.revision).toBe(4);
    expect(result.conflict).toBeUndefined();
    expect(result.error).toBeUndefined();
  });

  it("surfaces a conflict and returns the server's fresh conversation", async () => {
    const fresh = emptyConversation();
    loadConversation
      .mockResolvedValueOnce(loaded({ envelope: { revision: 5, targetYear: "2025-26" } }))
      .mockResolvedValueOnce(
        loaded({ conversation: fresh, envelope: { revision: 6, targetYear: "2025-26" } }),
      );
    saveConversation.mockResolvedValue({ conflict: true, current: { revision: 6 } });

    const result = await sendMessage("ret1", 5, "hello");

    expect(result.conflict).toBe(true);
    expect(result.revision).toBe(6);
    expect(result.error).toMatch(/another tab/i);
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
