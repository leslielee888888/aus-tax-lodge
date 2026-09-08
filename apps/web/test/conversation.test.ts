import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createEmptyReturnModel } from "@aus-tax-lodge/model";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  appendTurn,
  CONVERSATION_STATE_KEY,
  CONVERSATION_STATE_VERSION,
  conversationSummaryLine,
  emptyConversation,
  readConversation,
  withConversation,
  type ConversationState,
} from "../lib/conversation";

// ---------------------------------------------------------------------------
// Pure helpers — no store, no env
// ---------------------------------------------------------------------------

describe("readConversation", () => {
  it("returns a fresh empty state for a bare createEmptyReturnModel", () => {
    expect(readConversation(createEmptyReturnModel("2025-26"))).toEqual({
      version: CONVERSATION_STATE_VERSION,
      turns: [],
      phase: "upload",
      place: null,
      pendingConfirmations: [],
      stoppedReason: null,
    });
  });

  it("does not throw on null / undefined data", () => {
    expect(() => readConversation(null)).not.toThrow();
    expect(() => readConversation(undefined)).not.toThrow();
    expect(readConversation(null)).toEqual(emptyConversation());
  });

  it("does not throw on a garbage __conversation block, returns a fresh state", () => {
    const scalarBlock = {
      ...createEmptyReturnModel("2025-26"),
      [CONVERSATION_STATE_KEY]: 42,
    } as never;
    expect(readConversation(scalarBlock)).toEqual(emptyConversation());

    const partialBlock = {
      ...createEmptyReturnModel("2025-26"),
      [CONVERSATION_STATE_KEY]: {
        version: CONVERSATION_STATE_VERSION,
        turns: "not-an-array",
        phase: "banana",
        pendingConfirmations: [
          { nope: true },
          { id: "pc:income.governmentAllowances", modelPath: "income.governmentAllowances" },
        ],
      },
    } as never;
    const state = readConversation(partialBlock);
    expect(state.turns).toEqual([]);
    expect(state.phase).toBe("upload");
    expect(state.place).toBeNull();
    // A block with no path at all is dropped; a partial one is filled with defaults.
    expect(state.pendingConfirmations).toEqual([
      {
        id: "pc:income.governmentAllowances",
        modelPath: "income.governmentAllowances",
        label: "income.governmentAllowances",
        value: null,
        source: "the return so far",
        reason: "plausibility",
        resolved: false,
      },
    ]);
  });

  it("drops individual malformed turns without throwing", () => {
    const block = {
      ...createEmptyReturnModel("2025-26"),
      [CONVERSATION_STATE_KEY]: {
        version: CONVERSATION_STATE_VERSION,
        turns: [
          {
            id: "a",
            at: "2026-01-01T00:00:00.000Z",
            role: "assistant",
            kind: "message",
            text: "hi",
          },
          { id: "b", role: "assistant", kind: "message" }, // no `at`, no text
          {
            id: "c",
            at: "2026-01-01T00:00:01.000Z",
            role: "user",
            kind: "file",
            filename: "p.pdf",
            docId: "d1",
          },
          "totally not a turn",
        ],
        phase: "interview",
        place: "deductions",
        pendingConfirmations: [],
        stoppedReason: null,
      },
    } as never;
    const state = readConversation(block);
    expect(state.turns.map((t) => t.id)).toEqual(["a", "c"]);
    expect(state.phase).toBe("interview");
    expect(state.place).toBe("deductions");
  });

  it("resets to a fresh state on an older / unknown version, without throwing", () => {
    const block = {
      ...createEmptyReturnModel("2025-26"),
      [CONVERSATION_STATE_KEY]: {
        version: 999,
        turns: [
          {
            id: "a",
            at: "2026-01-01T00:00:00.000Z",
            role: "assistant",
            kind: "message",
            text: "hi",
          },
        ],
        phase: "interview",
        place: "deductions",
        pendingConfirmations: [],
        stoppedReason: null,
      },
    } as never;
    const state = readConversation(block);
    expect(state).toEqual(emptyConversation());
  });
});

describe("appendTurn", () => {
  it("is pure, generates ids + timestamps, and preserves order", () => {
    const base = emptyConversation();
    const one = appendTurn(base, { role: "assistant", kind: "message", text: "first" });
    const two = appendTurn(one, { role: "user", kind: "message", text: "second" });

    // original untouched
    expect(base.turns).toEqual([]);
    expect(one.turns).toHaveLength(1);

    expect(two.turns).toHaveLength(2);
    expect(two.turns.map((t) => (t.kind === "message" ? t.text : null))).toEqual([
      "first",
      "second",
    ]);

    const [a, b] = two.turns;
    expect(a?.id).toBeTruthy();
    expect(b?.id).toBeTruthy();
    expect(a?.id).not.toEqual(b?.id);
    expect(new Date(a!.at).toISOString()).toBe(a!.at);
  });

  it("keeps a supplied id and at", () => {
    const state = appendTurn(emptyConversation(), {
      role: "assistant",
      kind: "card",
      card: { type: "upload-prefill" },
      id: "fixed-id",
      at: "2026-02-03T04:05:06.000Z",
    });
    expect(state.turns[0]).toMatchObject({ id: "fixed-id", at: "2026-02-03T04:05:06.000Z" });
  });
});

describe("conversationSummaryLine", () => {
  it("reads 'up to: <place>' mid-interview with a place", () => {
    const state: ConversationState = {
      ...emptyConversation(),
      phase: "interview",
      place: "work-from-home deductions",
    };
    expect(conversationSummaryLine(state)).toBe("up to: work-from-home deductions");
  });

  it("falls back sensibly for every other phase", () => {
    const base = emptyConversation();
    expect(conversationSummaryLine(base)).toMatch(/pre-fill/i);
    expect(conversationSummaryLine({ ...base, phase: "interview", place: null })).not.toContain(
      "up to:",
    );
    expect(conversationSummaryLine({ ...base, phase: "review" })).toBeTruthy();
    expect(conversationSummaryLine({ ...base, phase: "exported" })).toBeTruthy();
    expect(
      conversationSummaryLine({ ...base, phase: "stopped", stoppedReason: "capital gains event" }),
    ).toMatch(/capital gains event/);
  });
});

// ---------------------------------------------------------------------------
// Persistence — a real temp DATA_DIR + real createReturnRepository
// ---------------------------------------------------------------------------

describe("conversation persistence (PRD FR-12)", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "atl-conversation-"));
    process.env.RETURN_ENCRYPTION_KEY = randomBytes(32).toString("hex");
    process.env.APP_PASSPHRASE = "test-passphrase";
    process.env.DATA_DIR = dir;
    delete process.env.ANTHROPIC_API_KEY;
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "test-token";
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    // Each test re-imports lib/returns so getReturnRepository() rebuilds its
    // singleton — a genuine "app restart" against the same on-disk data.
    vi.resetModules();
  });

  it("round-trips turns, phase, place and pendingConfirmations through the store", async () => {
    const { getReturnRepository, saveConversation } = await import("../lib/returns");

    const created = await getReturnRepository().createReturn({
      data: createEmptyReturnModel("2025-26"),
    });

    let convo = emptyConversation();
    convo = appendTurn(convo, {
      role: "assistant",
      kind: "card",
      card: { type: "upload-prefill" },
    });
    convo = appendTurn(convo, {
      role: "user",
      kind: "file",
      filename: "prefill-2025-26.pdf",
      docId: "doc-1",
    });
    convo = appendTurn(convo, {
      role: "assistant",
      kind: "message",
      text: "I found your salary and PAYG withheld.",
    });
    convo = {
      ...convo,
      phase: "interview",
      place: "work-from-home deductions",
      pendingConfirmations: [
        {
          id: "pc:income.interestAccounts[0].grossInterest",
          modelPath: "income.interestAccounts[0].grossInterest",
          label: "Gross interest — Southbank Mutual",
          value: 820,
          source: "you told me",
          reason: "user-corrected",
          resolved: false,
        },
      ],
    };

    const model = createEmptyReturnModel("2025-26");
    const saved = await saveConversation(created.returnId, { model, conversation: convo });
    expect(saved.conflict).toBe(false);

    // Fresh module graph => fresh repository singleton => fresh decrypt from disk.
    vi.resetModules();
    const { loadConversation } = await import("../lib/returns");
    const reloaded = await loadConversation(created.returnId);

    expect(reloaded.readOnly).toBe(false);
    expect(reloaded.conversation.turns.map((t) => t.kind)).toEqual(["card", "file", "message"]);
    expect(reloaded.conversation.phase).toBe("interview");
    expect(reloaded.conversation.place).toBe("work-from-home deductions");
    expect(reloaded.conversation.pendingConfirmations).toEqual([
      {
        id: "pc:income.interestAccounts[0].grossInterest",
        modelPath: "income.interestAccounts[0].grossInterest",
        label: "Gross interest — Southbank Mutual",
        value: 820,
        source: "you told me",
        reason: "user-corrected",
        resolved: false,
      },
    ]);

    // The ReturnModel fields are untouched.
    const fresh = createEmptyReturnModel("2025-26");
    expect(reloaded.model.modelVersion).toBe(fresh.modelVersion);
    expect(reloaded.model.targetYear).toBe("2025-26");
    expect(reloaded.model.income.salaryWages).toEqual([]);
    expect(reloaded.model.rental.present).toBe(false);
  });

  it("refuses saveConversation on a read-only (retired-params) return", async () => {
    const returns = await import("../lib/returns");
    const repo = returns.getReturnRepository();
    const created = await repo.createReturn({ data: createEmptyReturnModel("2025-26") });
    const { envelope } = await repo.loadReturn(created.returnId);

    vi.spyOn(repo, "loadReturn").mockResolvedValue({ envelope, readOnly: true });

    await expect(
      returns.saveConversation(created.returnId, {
        model: createEmptyReturnModel("2025-26"),
        conversation: emptyConversation(),
      }),
    ).rejects.toBeInstanceOf(returns.ConversationReadOnlyError);
  });

  it("withConversation on a loaded model round-trips and leaves other fields intact", async () => {
    const { getReturnRepository, saveConversation, loadConversation } =
      await import("../lib/returns");
    const created = await getReturnRepository().createReturn({
      data: createEmptyReturnModel("2025-26"),
    });

    const first = await loadConversation(created.returnId);
    const withTurn = appendTurn(first.conversation, {
      role: "assistant",
      kind: "message",
      text: "Welcome — upload your ATO pre-fill report to start.",
    });
    await saveConversation(created.returnId, { model: first.model, conversation: withTurn });

    vi.resetModules();
    const { loadConversation: reload } = await import("../lib/returns");
    const second = await reload(created.returnId);
    expect(second.conversation.turns).toHaveLength(1);
    expect(second.model).toMatchObject({ modelVersion: first.model.modelVersion });
  });
});

// A type-level check that withConversation keeps a ReturnModel assignable.
it("withConversation preserves the ReturnModel shape", () => {
  const model = createEmptyReturnModel("2025-26");
  const next = withConversation(model, emptyConversation());
  expect(next.targetYear).toBe(model.targetYear);
  expect(next[CONVERSATION_STATE_KEY]?.version).toBe(CONVERSATION_STATE_VERSION);
});
