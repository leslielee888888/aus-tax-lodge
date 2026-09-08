/**
 * T12 · Scenario 4 — conversation persistence across a restart + the auth gate.
 *
 * A v2 conversation is driven part-way through the interview (pre-fill upload,
 * income checkpoint with one inline correction), then a **fresh**
 * repository/store pair is built over the same encrypted temp dir — with no
 * shared in-memory state — and must read the whole conversation back: every
 * transcript turn, every confirmed figure, `pendingConfirmations`, `phase` and
 * `place`.
 *
 * The passphrase gate (`apps/web/lib/auth.ts`) is exercised alongside — the
 * store+auth basics are covered by the kept `persistence-and-auth.test.ts`;
 * this adds the v2 conversation-resume path.
 */
import { createReturnRepository } from "@aus-tax-lodge/store";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../lib/ai/client", () => ({
  getClaudeClient: () => {
    if (!holder.client) throw new Error("scripted Claude not installed");
    return holder.client;
  },
}));

import {
  createChatReturn,
  createClaudeScript,
  load,
  postPrefill,
  setupTestEnv,
  type ClaudeScript,
  type TestEnv,
} from "./harness";
import { prefillFixture } from "./fixtures/documents";
import { readConversation } from "../../lib/conversation";

let env: TestEnv;
let script: ClaudeScript;

beforeAll(async () => {
  env = await setupTestEnv("atl-int-v2-persist-");
  script = createClaudeScript();
  holder.client = script.client;
});

afterAll(async () => {
  await env.cleanup();
});

describe("Scenario 4 — conversation resume across a fresh store instance", () => {
  it("reads the transcript, confirmed figures, pendingConfirmations, phase and place back intact", async () => {
    const returnId = await createChatReturn();
    const prefill = await prefillFixture({ grossSalary: 95000, paygWithheld: 24000 });
    prefill.wire(script);
    script.queueNextTurn('{"kind":"card","card":"income-checkpoint"}');
    await postPrefill(returnId, prefill.filename, prefill.bytes);

    // Inline correction on the income checkpoint: salary 95,000 -> 96,000.
    const { correctIncome } = await import("../../app/returns/[returnId]/actions");
    let loaded = await load(returnId);
    const cardId = [...loaded.conversation.turns]
      .reverse()
      .find((t) => t.role === "assistant" && t.kind === "card")!.id;
    await correctIncome(returnId, loaded.envelope.revision, cardId, [
      { modelPath: "income.salaryWages[0].grossSalaryWages", value: 96000 },
    ]);

    loaded = await load(returnId);
    expect(loaded.conversation.phase).toBe("interview");
    const liveTurnCount = loaded.conversation.turns.length;
    const livePending = loaded.conversation.pendingConfirmations;
    expect(livePending.some((c) => c.modelPath === "income.salaryWages[0].grossSalaryWages")).toBe(
      true,
    );
    expect(loaded.model.income.salaryWages[0]!.grossSalaryWages.value).toBe(96000);

    // --- "Restart": a brand-new repository over the same directory --------
    const key = Buffer.from(env.encryptionKeyHex, "hex");
    const fresh = createReturnRepository({ dataDir: env.dir, encryptionKey: key });
    const reloaded = await fresh.loadReturn(returnId);
    expect(reloaded.readOnly).toBe(false);

    const model = reloaded.envelope.data as typeof loaded.model;
    const convo = readConversation(model);

    // Transcript intact.
    expect(convo.turns).toHaveLength(liveTurnCount);
    expect(convo.turns[0]).toMatchObject({ role: "assistant" }); // greeting
    expect(convo.turns.some((t) => t.kind === "file")).toBe(true);
    expect(convo.turns.some((t) => t.kind === "card-response")).toBe(true);

    // Confirmed figures + the edit trail survive.
    const salary = model.income.salaryWages[0]!.grossSalaryWages;
    expect(salary).toMatchObject({ value: 96000, status: "confirmed" });
    expect(salary.edits.length).toBeGreaterThan(0);
    expect(salary.proposedValue).toBe(95000);
    expect(model.income.dividends[0]!.frankingCredits.status).toBe("confirmed");

    // pendingConfirmations, phase and place all survive.
    expect(convo.pendingConfirmations).toEqual(livePending);
    expect(convo.pendingConfirmations.some((c) => c.reason === "user-corrected")).toBe(true);
    expect(convo.phase).toBe("interview");
    expect(convo.place).toBe(loaded.conversation.place);
  });

  it("verifies the APP_PASSPHRASE HMAC session gate (FR-17)", async () => {
    const { configuredPassphrase, sessionTokenFor, verifySession } = await import("../../lib/auth");
    expect(configuredPassphrase()).toBe(env.passphrase);

    const good = await sessionTokenFor(env.passphrase);
    expect(await verifySession(good, configuredPassphrase())).toBe(true);

    const wrong = await sessionTokenFor("not the passphrase");
    expect(await verifySession(wrong, configuredPassphrase())).toBe(false);
    expect(await verifySession(undefined, configuredPassphrase())).toBe(false);
  });
});
