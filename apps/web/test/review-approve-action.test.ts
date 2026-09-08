/**
 * T8 — the `review-summary` card's server actions (PRD FR-5, FR-11, FR-14):
 * `approveReturn` (the export gate + conversation advance) and `reopenLine`
 * (drop back into the interview to fix one line).
 */
import { createEmptyReturnModel } from "@aus-tax-lodge/model";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  loadConversation,
  saveConversation,
  loadExportContext,
  buildExportInput,
  computeExportGate,
  acknowledgeWarnings,
  readAcknowledgedWarningIds,
  markReturnExported,
} = vi.hoisted(() => ({
  loadConversation: vi.fn(),
  saveConversation: vi.fn(),
  loadExportContext: vi.fn(),
  buildExportInput: vi.fn(() => ({})),
  computeExportGate: vi.fn(),
  acknowledgeWarnings: vi.fn(async (_id: string, ids: string[]) => ids),
  readAcknowledgedWarningIds: vi.fn(async () => [] as string[]),
  markReturnExported: vi.fn(async () => {}),
}));

vi.mock("../lib/returns", () => ({
  loadConversation,
  saveConversation,
  getReturnRepository: () => ({ deleteReturn: vi.fn() }),
  ConversationReadOnlyError: class ConversationReadOnlyError extends Error {},
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("../lib/ai/client", () => ({ getClaudeClient: () => ({ ask: vi.fn() }) }));
vi.mock("../lib/interview", () => ({ applyUserTurn: vi.fn(), nextTurn: vi.fn() }));
vi.mock("../lib/export/context", () => ({ loadExportContext, buildExportInput }));
vi.mock("../lib/export/gate", () => ({ computeExportGate }));
vi.mock("../lib/export/acknowledgements", () => ({
  acknowledgeWarnings,
  readAcknowledgedWarningIds,
}));
vi.mock("../lib/export/persist", () => ({ markReturnExported }));
vi.mock("@aus-tax-lodge/export", () => ({
  buildLodgeInstructionsData: () => ({
    steps: [
      { heading: "1. Sign in to ATO myTax through myGov", body: "" },
      { heading: "2. Start your return and work through it label by label", body: "" },
      { heading: "3. Reconcile against pre-fill, then submit", body: "" },
    ],
  }),
}));

import { approveReturn, reopenLine } from "../app/returns/[returnId]/actions";
import { appendTurn, emptyConversation, type ConversationState } from "../lib/conversation";

const MODEL = { modelVersion: 1 } as const;

function reviewConversation(): ConversationState {
  let convo: ConversationState = { ...emptyConversation(), phase: "review" };
  convo = appendTurn(convo, {
    id: "card1",
    role: "assistant",
    kind: "card",
    card: {
      type: "review-summary",
      payload: {
        summary: {
          taxpayerName: "Priya Example",
          lines: [
            { lineKey: "salary-wages", label: "Salary & wages", displayAmount: "$80,000.00" },
          ],
        },
      },
    },
  });
  return convo;
}

function loaded(overrides: Record<string, unknown> = {}) {
  return {
    envelope: { revision: 7, targetYear: "2025-26" },
    model: MODEL,
    conversation: reviewConversation(),
    readOnly: false,
    ...overrides,
  };
}

function savedConversation(): ConversationState {
  return saveConversation.mock.calls[0]![1].conversation as ConversationState;
}

beforeEach(() => {
  vi.clearAllMocks();
  saveConversation.mockResolvedValue({ conflict: false, envelope: { revision: 8 } });
  readAcknowledgedWarningIds.mockResolvedValue([]);
  loadExportContext.mockResolvedValue({ ready: true, assessment: { outcome: {} }, model: MODEL });
});

describe("approveReturn — the export gate (PRD FR-14)", () => {
  it("returns blockedErrors and stays in review when validation errors block export", async () => {
    loadConversation.mockResolvedValue(loaded());
    computeExportGate.mockReturnValue({
      blocked: true,
      errors: [{ id: "e1", message: "TFN is not valid" }],
      warnings: [],
      allWarningsAcknowledged: true,
      downloadsEnabled: false,
    });

    const result = await approveReturn("ret1", 7, "card1", "correcthorsebattery", undefined);

    expect(result.ok).toBe(false);
    expect(result.blockedErrors).toEqual(["TFN is not valid"]);
    expect(saveConversation).not.toHaveBeenCalled();
  });

  it("asks for a warning acknowledgement when one is unacked", async () => {
    loadConversation.mockResolvedValue(loaded());
    computeExportGate.mockReturnValue({
      blocked: false,
      errors: [],
      warnings: [{ id: "w1", message: "Franking credits look high", acknowledged: false }],
      allWarningsAcknowledged: false,
      downloadsEnabled: false,
    });

    const result = await approveReturn("ret1", 7, "card1", "correcthorsebattery", undefined);

    expect(result.needsWarningAck).toBe(true);
    expect(result.warnings).toEqual([{ id: "w1", message: "Franking credits look high" }]);
    expect(acknowledgeWarnings).not.toHaveBeenCalled();
  });

  it("rejects a password shorter than the minimum length", async () => {
    loadConversation.mockResolvedValue(loaded());
    const result = await approveReturn("ret1", 7, "card1", "short", undefined);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/at least 12 characters/i);
    expect(loadExportContext).not.toHaveBeenCalled();
  });

  it("reports what's still missing when the return isn't ready", async () => {
    loadConversation.mockResolvedValue(loaded());
    loadExportContext.mockResolvedValue({
      ready: false,
      assessment: null,
      model: createEmptyReturnModel("2025-26"),
    });
    const result = await approveReturn("ret1", 7, "card1", "correcthorsebattery", undefined);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/still missing/i);
  });

  it("happy path: acknowledges warnings, moves to exported, returns archiveReady", async () => {
    loadConversation.mockResolvedValue(loaded());
    computeExportGate
      .mockReturnValueOnce({
        blocked: false,
        errors: [],
        warnings: [{ id: "w1", message: "Franking credits look high", acknowledged: false }],
        allWarningsAcknowledged: false,
        downloadsEnabled: false,
      })
      .mockReturnValueOnce({
        blocked: false,
        errors: [],
        warnings: [{ id: "w1", message: "Franking credits look high", acknowledged: true }],
        allWarningsAcknowledged: true,
        downloadsEnabled: true,
      });

    const result = await approveReturn("ret1", 7, "card1", "correcthorsebattery", ["w1"]);

    expect(acknowledgeWarnings).toHaveBeenCalledWith("ret1", ["w1"]);
    expect(result.ok).toBe(true);
    expect(result.archiveReady).toBe(true);
    expect(markReturnExported).toHaveBeenCalledWith("ret1");

    const saved = savedConversation();
    expect(saved.phase).toBe("exported");
    const assistantMsg = saved.turns.at(-1);
    expect(assistantMsg).toMatchObject({ role: "assistant", kind: "message" });
    expect((assistantMsg as { text: string }).text).toMatch(/Sign in to ATO myTax/);
    expect((assistantMsg as { text: string }).text).toMatch(/isn't stored/i);
  });

  it("does nothing on a return that is not at the review stage", async () => {
    loadConversation.mockResolvedValue(
      loaded({ conversation: { ...emptyConversation(), phase: "interview" } }),
    );
    const result = await approveReturn("ret1", 7, "card1", "correcthorsebattery", undefined);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/review stage/i);
    expect(saveConversation).not.toHaveBeenCalled();
  });
});

describe("reopenLine — fix one review line (PRD FR-5)", () => {
  it("drops back to the interview and appends a question about the line", async () => {
    loadConversation.mockResolvedValue(loaded());

    const result = await reopenLine("ret1", 7, "card1", "salary-wages");

    expect(saveConversation).toHaveBeenCalledExactlyOnceWith(
      "ret1",
      expect.objectContaining({ expectedRevision: 7, model: MODEL }),
    );
    const saved = savedConversation();
    expect(saved.phase).toBe("interview");

    const turns = saved.turns;
    expect(turns.at(-2)).toMatchObject({
      role: "user",
      kind: "card-response",
      cardId: "card1",
      response: { rejected: "salary-wages", lineKey: "salary-wages" },
    });
    expect(turns.at(-1)).toMatchObject({ role: "assistant", kind: "message" });
    expect((turns.at(-1) as { text: string }).text).toMatch(/salary and wages/i);
    expect(result.revision).toBe(8);
  });

  it("refuses to reopen when the conversation isn't in review", async () => {
    loadConversation.mockResolvedValue(
      loaded({ conversation: { ...emptyConversation(), phase: "interview" } }),
    );
    const result = await reopenLine("ret1", 7, "card1", "salary-wages");
    expect(result.error).toMatch(/nothing to reopen/i);
    expect(saveConversation).not.toHaveBeenCalled();
  });
});
