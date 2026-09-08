/**
 * `listReturnsWithConversation` (T9, option (a)) against a REAL
 * `@aus-tax-lodge/store` repository on a temp `DATA_DIR` with real AES
 * encryption — the summary-line derivation must survive a round-trip through the
 * encrypted envelope, the same way v1's integration tests exercise the store.
 */
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createEmptyReturnModel } from "@aus-tax-lodge/model";
import { createReturnRepository } from "@aus-tax-lodge/store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { emptyConversation, withConversation, type ConversationState } from "../lib/conversation";
import { listReturnsWithConversation } from "../lib/returns";

let dir: string;
const key = randomBytes(32);

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "atl-returns-list-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function state(overrides: Partial<ConversationState>): ConversationState {
  return { ...emptyConversation(), ...overrides };
}

function modelWith(conversation: ConversationState) {
  return withConversation(createEmptyReturnModel("2025-26"), conversation);
}

describe("listReturnsWithConversation", () => {
  it("derives the summary line, phase and stop reason for each return", async () => {
    const repo = createReturnRepository({ dataDir: dir, encryptionKey: key });

    const interview = await repo.createReturn({
      currentStep: "chat",
      data: modelWith(state({ phase: "interview", place: "work-from-home deductions" })),
    });
    const exported = await repo.createReturn({
      currentStep: "chat",
      data: modelWith(state({ phase: "exported" })),
    });
    const stopped = await repo.createReturn({
      currentStep: "chat",
      data: modelWith(
        state({ phase: "stopped", stoppedReason: "capital gains event (sold shares)" }),
      ),
    });
    // A return with no conversation block at all (defensive — e.g. a v1 shape).
    const bare = await repo.createReturn({ currentStep: "chat", data: {} });

    const items = await listReturnsWithConversation(repo);
    const byId = new Map(items.map((i) => [i.summary.returnId, i]));

    expect(byId.get(interview.returnId)).toMatchObject({
      phase: "interview",
      summaryLine: "up to: work-from-home deductions",
      stoppedReason: null,
    });
    expect(byId.get(exported.returnId)).toMatchObject({
      phase: "exported",
      summaryLine: "Lodgement package ready",
    });
    expect(byId.get(stopped.returnId)).toMatchObject({
      phase: "stopped",
      summaryLine: "Stopped — capital gains event (sold shares)",
      stoppedReason: "capital gains event (sold shares)",
    });
    expect(byId.get(bare.returnId)).toMatchObject({
      phase: "upload",
      summaryLine: "Waiting for your pre-fill report",
      stoppedReason: null,
    });
  });

  it("returns an empty list when there are no returns", async () => {
    const repo = createReturnRepository({ dataDir: dir, encryptionKey: key });
    expect(await listReturnsWithConversation(repo)).toEqual([]);
  });
});
