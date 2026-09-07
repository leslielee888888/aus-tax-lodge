/**
 * T26 · document-content out-of-scope detection, end to end (PRD FR-20, Q12).
 *
 * The gap `out-of-scope.test.ts` documented — the running app never ran T11's
 * Claude content check, so a "dividend statement" that is really a trust /
 * managed-fund distribution slipped through review — is closed here.
 *
 * This drives the REAL `extractFigures` server action
 * (`app/returns/[returnId]/documents/actions.ts`) against a real encrypted
 * temp-dir store, with only Claude mocked, then follows the review page's data
 * path (`loadReturnModel` → `detectOutOfScope({ contentFindings })`) and the
 * FR-13 export gate. Both must land at the FR-20 hard stop.
 */
import { detectOutOfScope, isBlocked } from "@aus-tax-lodge/scope";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { fakePdf, setupTestEnv, type TestEnv } from "./harness";

// Only Claude is mocked. `extractFigures` calls `getClaudeClient()` directly, so
// the client singleton is replaced with a prompt-routing stub.
const { mockClaude } = vi.hoisted(() => {
  const calls: { prompt: string }[] = [];
  return {
    mockClaude: {
      calls,
      ask: async () => "",
      askVision: async (_parts: unknown, prompt: string) => {
        calls.push({ prompt });
        if (/Does this document contain, report or evidence ANY of the following/.test(prompt)) {
          return JSON.stringify(["trust-partnership-managed-fund-distribution"]);
        }
        if (/dividend or distribution statement from a company or share registry/.test(prompt)) {
          return "[]";
        }
        throw new Error(`mock Claude: unexpected prompt:\n${prompt.slice(0, 200)}`);
      },
    },
  };
});

vi.mock("../../lib/ai/client", () => ({ getClaudeClient: () => mockClaude }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

let env: TestEnv;

beforeAll(async () => {
  env = await setupTestEnv("atl-int-oos-content-");
});

afterAll(async () => {
  await env.cleanup();
});

describe("T26 — document-content out-of-scope hard stop (FR-20)", () => {
  it("stops a return whose 'dividend statement' is really a trust distribution", async () => {
    const { getReturnRepository } = await import("../../lib/returns");
    const { getDocumentStore } = await import("../../lib/store");
    const { loadReturnModel } = await import("../../lib/returns");
    const { scopeContentFindings } = await import("../../lib/scope-content-scratch");
    const { computeExportGate } = await import("../../lib/export/gate");
    const { extractFigures } = await import("../../app/returns/[returnId]/documents/actions");
    const { INITIAL_EXTRACT_FIGURES_STATE } =
      await import("../../app/returns/[returnId]/documents/state");
    const { createEmptyReturnModel } = await import("@aus-tax-lodge/model");

    const repo = getReturnRepository();
    const store = getDocumentStore();

    const created = await repo.createReturn({
      data: createEmptyReturnModel("2025-26"),
      currentStep: "documents",
    });
    const returnId = created.returnId;

    // A file the classifier took for a plain dividend statement.
    await store.putDocument(returnId, {
      filename: "acme-diversified-fund-annual-tax-statement.pdf",
      mimeType: "application/pdf",
      bytes: fakePdf(
        "ACME Diversified Fund — Annual tax statement. Net cash distribution. " +
          "Franked distribution. Foreign income. Net capital gains. AMIT cost base net amount.",
      ),
      detectedType: "dividend-statement",
    });

    // --- Run the real extraction pipeline (Claude mocked) -------------------
    await expect(
      extractFigures(returnId, created.revision, INITIAL_EXTRACT_FIGURES_STATE, new FormData()),
    ).rejects.toThrow(`REDIRECT:/returns/${returnId}/review`);

    // The content check ran exactly once, over that document.
    expect(
      mockClaude.calls.filter((c) =>
        /Does this document contain, report or evidence ANY of the following/.test(c.prompt),
      ),
    ).toHaveLength(1);

    // --- The review page's data path --------------------------------------
    const { model } = await loadReturnModel(returnId);
    const documents = await store.listDocuments(returnId);

    const findings = detectOutOfScope({
      model,
      documents: documents.map((d) => ({
        docId: d.docId,
        detectedType: d.detectedType,
        filename: d.filename,
      })),
      contentFindings: scopeContentFindings(model),
    });

    expect(isBlocked(findings)).toBe(true);
    const trust = findings.find((f) => f.code === "trust-partnership-managed-fund-distribution");
    expect(trust).toBeDefined();
    expect(trust!.source).toBe("document");
    expect(trust!.item).toBe("Trust, partnership or managed-fund distribution");
    expect(trust!.detail).toContain("acme-diversified-fund-annual-tax-statement.pdf");

    // --- Defense in depth: the FR-13 export gate is blocked too -----------
    const gate = computeExportGate(model, null, []);
    expect(gate.blocked).toBe(true);
    expect(
      gate.errors.some(
        (e) => e.code === "out-of-scope:trust-partnership-managed-fund-distribution",
      ),
    ).toBe(true);

    // --- A second run does not call Claude for the content check again ----
    const before = mockClaude.calls.length;
    const reloaded = await repo.loadReturn(returnId);
    await expect(
      extractFigures(
        returnId,
        reloaded.envelope.revision,
        INITIAL_EXTRACT_FIGURES_STATE,
        new FormData(),
      ),
    ).rejects.toThrow("REDIRECT:");
    expect(
      mockClaude.calls
        .slice(before)
        .filter((c) =>
          /Does this document contain, report or evidence ANY of the following/.test(c.prompt),
        ),
    ).toHaveLength(0);
  });
});
