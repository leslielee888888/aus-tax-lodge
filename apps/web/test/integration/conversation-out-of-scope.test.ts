/**
 * T12 · Scenario 3 — out-of-scope hard stop, no override, export blocked.
 *
 * (a) A capital-gains mention in a typed answer → `detectOutOfScope` → the
 *     `out-of-scope` card, `phase: "stopped"`, the model NOT advanced past the
 *     stop, and `sendMessage` after the stop refuses to continue.
 * (b) A trust-distribution document dropped mid-chat (classified
 *     `dividend-statement`, content-checked as a trust/managed-fund
 *     distribution) → hard stop, `phase: "stopped"`, the document's figures NOT
 *     applied.
 *
 * In both cases `approveReturn` / the export gate refuse a stopped return.
 */
import { toEngineInput } from "@aus-tax-lodge/model";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../lib/ai/client", () => ({
  getClaudeClient: () => {
    if (!holder.client) throw new Error("scripted Claude not installed");
    return holder.client;
  },
}));

import type { ReturnModel } from "@aus-tax-lodge/model";

import {
  approve,
  confirmIncomeCheckpoint,
  createChatReturn,
  createClaudeScript,
  isApplyTurn,
  load,
  postInterviewDocument,
  postPrefill,
  send,
  setupTestEnv,
  type ClaudeScript,
  type TestEnv,
} from "./harness";
import { prefillFixture, trustDistributionFixture } from "./fixtures/documents";

let env: TestEnv;
let script: ClaudeScript;

beforeAll(async () => {
  env = await setupTestEnv("atl-int-v2-oos-");
  script = createClaudeScript();
  holder.client = script.client;
});

afterAll(async () => {
  await env.cleanup();
});

/** The tax-substantive slices of the model — everything except the transcript / scratch blocks. */
function taxState(model: ReturnModel) {
  const { income, deductions, context, rental, privateHealth, questionnaire, taxpayer } = model;
  return { income, deductions, context, rental, privateHealth, questionnaire, taxpayer };
}

async function startInterview(): Promise<string> {
  const returnId = await createChatReturn();
  const prefill = await prefillFixture({ grossSalary: 95000, paygWithheld: 24000 });
  prefill.wire(script);
  script.queueNextTurn('{"kind":"card","card":"income-checkpoint"}');
  await postPrefill(returnId, prefill.filename, prefill.bytes);
  return returnId;
}

describe("Scenario 3a — capital-gains mention in a typed answer", () => {
  it("hard-stops, does not advance the model, and refuses to continue", async () => {
    const returnId = await startInterview();
    await confirmIncomeCheckpoint(returnId);

    const before = await load(returnId);
    const modelBefore = before.model;

    script.onAsk(
      "answer:cgt",
      (p, o) => isApplyTurn(p, o) && p.includes("sold some Telstra shares"),
      JSON.stringify({ updates: [], outOfScope: ["capital-gains"] }),
    );
    const res = await send(
      returnId,
      "I also sold some Telstra shares this year for a tidy profit.",
    );
    expect(res.error).toBeUndefined();

    const stopped = await load(returnId);
    expect(stopped.conversation.phase).toBe("stopped");
    expect(stopped.conversation.stoppedReason).toMatch(/capital gains/i);
    const lastTurn = stopped.conversation.turns.at(-1)!;
    expect(lastTurn).toMatchObject({
      role: "assistant",
      kind: "card",
      card: { type: "out-of-scope" },
    });

    // The model is NOT advanced past the stop (PRD FR-9) — deep-equal to before.
    expect(taxState(stopped.model)).toEqual(taxState(modelBefore));

    // The composer would be hidden (phase drives that) and a further message is refused.
    const after = await send(returnId, "ok but can we keep going anyway?");
    const reply = after.conversation.turns.at(-1)!;
    expect(reply).toMatchObject({ role: "assistant", kind: "message" });
    if (reply.kind === "message") expect(reply.text).toMatch(/stopped|can't continue/i);
    // No user field-mapping happened.
    expect((await load(returnId)).conversation.phase).toBe("stopped");

    // Export is blocked for a stopped return.
    const { loadExportContext } = await import("../../lib/export/context");
    const { computeExportGate } = await import("../../lib/export/gate");
    const context = await loadExportContext(returnId);
    expect(context.assessment).toBeNull();
    expect(computeExportGate(context.model, null, []).blocked).toBe(true);

    const approved = await approve(returnId, "irrelevant-password-1234");
    expect(approved.ok).toBe(false);
    expect(approved.error).toMatch(/review stage/i);
  });
});

describe("Scenario 3b — trust-distribution document dropped mid-chat", () => {
  it("hard-stops on the content check, and the document's figures are not applied", async () => {
    const returnId = await startInterview();
    await confirmIncomeCheckpoint(returnId);

    const before = await load(returnId);
    expect(before.model.income.dividends).toHaveLength(1); // just the pre-fill ASX Co holding

    const trust = await trustDistributionFixture();
    trust.wire(script);
    const res = await postInterviewDocument(returnId, trust.filename, trust.bytes);
    expect(res.body.ok).toBe(false);
    expect(res.body.reason).toBe("out-of-scope");

    const stopped = await load(returnId);
    expect(stopped.conversation.phase).toBe("stopped");
    expect(stopped.conversation.stoppedReason).toMatch(/trust|partnership|managed[- ]fund/i);
    const card = stopped.conversation.turns.at(-1)!;
    expect(card).toMatchObject({ role: "assistant", kind: "card", card: { type: "out-of-scope" } });
    const findings = (card as { card: { payload: { findings: { code: string }[] } } }).card.payload
      .findings;
    expect(findings.some((f) => f.code === "trust-partnership-managed-fund-distribution")).toBe(
      true,
    );

    // FR-9 — the document's figures are NOT applied: dividends unchanged, no new holding.
    expect(stopped.model.income.dividends).toHaveLength(1);
    expect(stopped.model.income.dividends[0]!.company.value).toBe("ASX Co Ltd");
    expect(taxState(stopped.model)).toEqual(taxState(before.model));

    // The engine can't even run, and the export gate blocks.
    expect(() => toEngineInput(stopped.model)).toThrow();
    const { computeExportGate } = await import("../../lib/export/gate");
    expect(computeExportGate(stopped.model, null, []).blocked).toBe(true);

    const approved = await approve(returnId, "irrelevant-password-1234");
    expect(approved.ok).toBe(false);
  });
});
