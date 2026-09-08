import { createEmptyReturnModel } from "@aus-tax-lodge/model";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadReturn, saveReturn } = vi.hoisted(() => ({
  loadReturn: vi.fn(),
  saveReturn: vi.fn(),
}));

vi.mock("@aus-tax-lodge/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aus-tax-lodge/store")>();
  return { ...actual, createReturnRepository: () => ({ loadReturn, saveReturn }) };
});

vi.mock("../lib/server-config", () => ({
  getServerConfig: () => ({ dataDir: "/tmp/x", encryptionKey: Buffer.alloc(32) }),
}));

import { withConversation } from "../lib/conversation";
import { loadConversationForChat } from "../lib/returns";

function envelope(data: unknown, revision = 1) {
  return { envelope: { data, targetYear: "2025-26", revision }, readOnly: false };
}

beforeEach(() => {
  vi.clearAllMocks();
  saveReturn.mockResolvedValue({ conflict: false, envelope: { revision: 2 } });
});

describe("loadConversationForChat — seeding a fresh return (PRD FR-1, T4)", () => {
  it("seeds the upload prompt + drop-zone card exactly once for an empty conversation", async () => {
    loadReturn.mockResolvedValue(envelope(null)); // brand-new return, no model yet

    const result = await loadConversationForChat("ret1");

    expect(saveReturn).toHaveBeenCalledTimes(1);
    const seededData = saveReturn.mock.calls[0]![1].data as {
      __conversation: { phase: string; turns: { role: string; kind: string; card?: { type: string } }[] };
    };
    expect(seededData.__conversation.phase).toBe("upload");
    expect(seededData.__conversation.turns.map((t) => `${t.role}:${t.kind}`)).toEqual([
      "assistant:message",
      "assistant:card",
    ]);
    expect(seededData.__conversation.turns[1]!.card!.type).toBe("upload-prefill");

    // The caller gets the seeded conversation + the post-save revision.
    expect(result.conversation.turns).toHaveLength(2);
    expect(result.envelope.revision).toBe(2);
  });

  it("does not re-seed a conversation that already has turns", async () => {
    const model = withConversation(createEmptyReturnModel("2025-26"), {
      version: 1,
      phase: "interview",
      place: null,
      pendingConfirmations: [],
      stoppedReason: null,
      turns: [{ id: "1", at: "t", role: "assistant", kind: "message", text: "hi" }],
    });
    loadReturn.mockResolvedValue(envelope(model, 7));

    const result = await loadConversationForChat("ret1");

    expect(saveReturn).not.toHaveBeenCalled();
    expect(result.conversation.turns).toHaveLength(1);
    expect(result.envelope.revision).toBe(7);
  });

  it("leaves a read-only return untouched", async () => {
    loadReturn.mockResolvedValue({
      envelope: { data: null, targetYear: "2024-25", revision: 1 },
      readOnly: true,
    });

    const result = await loadConversationForChat("ret1");

    expect(saveReturn).not.toHaveBeenCalled();
    expect(result.readOnly).toBe(true);
    expect(result.conversation.turns).toHaveLength(0);
  });
});
