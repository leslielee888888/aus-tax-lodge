import type { ReturnModel } from "@aus-tax-lodge/model";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { checkModelInScope, type ScopeCheckStore } from "../lib/scope-check";
import { readScopeContentScratch } from "../lib/scope-content-scratch";
import { readyModel } from "./review-fixtures";

/** A stubbed document store — `listDocuments` + `getDocument` are all the check touches. */
function fakeStore(
  docs: { docId: string; filename: string; detectedType: string }[],
): { store: ScopeCheckStore; getDocument: ReturnType<typeof vi.fn> } {
  const getDocument = vi.fn(async () => ({
    bytes: Buffer.from("%PDF-1.4 fake"),
    metadata: { mimeType: "application/pdf" as const },
  }));
  return {
    store: { listDocuments: vi.fn(async () => docs), getDocument },
    getDocument,
  };
}

/** A stubbed scope-vision client — one `askVision` call per checked document. */
function fakeVision(reply: string) {
  const askVision = vi.fn(async () => reply);
  return { visionClient: { askVision }, askVision };
}

const IN_SCOPE: ReturnModel = readyModel();

const NON_RESIDENT: ReturnModel = {
  ...readyModel(),
  context: {
    ...readyModel().context,
    residency: { ...readyModel().context.residency, value: "non-resident" as const },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("checkModelInScope (PRD FR-8, FR-20)", () => {
  it("returns no findings for an in-scope model with no documents", async () => {
    const { store } = fakeStore([]);
    const { visionClient, askVision } = fakeVision("[]");

    const result = await checkModelInScope({
      returnId: "r1",
      model: IN_SCOPE,
      store,
      visionClient,
    });

    expect(result.findings).toEqual([]);
    expect(askVision).not.toHaveBeenCalled();
  });

  it("raises a deterministic finding from the model (non-resident) without any Claude call", async () => {
    const { store } = fakeStore([
      { docId: "d1", filename: "prefill.pdf", detectedType: "ato-prefill-report" },
    ]);
    const { visionClient, askVision } = fakeVision("[]");

    const result = await checkModelInScope({
      returnId: "r1",
      model: NON_RESIDENT,
      store,
      visionClient,
    });

    expect(result.findings.map((f) => f.code)).toContain("non-resident");
    // `ato-prefill-report` is not a content-check type.
    expect(askVision).not.toHaveBeenCalled();
  });

  it("runs the content check over a dividend-statement and flags a trust distribution", async () => {
    const { store } = fakeStore([
      { docId: "d9", filename: "statement.pdf", detectedType: "dividend-statement" },
    ]);
    const { visionClient, askVision } = fakeVision(
      JSON.stringify(["trust-partnership-managed-fund-distribution"]),
    );

    const result = await checkModelInScope({
      returnId: "r1",
      model: IN_SCOPE,
      store,
      visionClient,
    });

    expect(askVision).toHaveBeenCalledOnce();
    expect(result.findings.map((f) => f.code)).toContain(
      "trust-partnership-managed-fund-distribution",
    );
    // The classification is cached on the returned model.
    expect(readScopeContentScratch(result.model).classifications).toEqual([
      expect.objectContaining({ docId: "d9", detectedType: "dividend-statement" }),
    ]);
  });

  it("reuses a cached classification — no second Claude call on the same document", async () => {
    const { store } = fakeStore([
      { docId: "d9", filename: "statement.pdf", detectedType: "dividend-statement" },
    ]);
    const { visionClient, askVision } = fakeVision(
      JSON.stringify(["trust-partnership-managed-fund-distribution"]),
    );

    const first = await checkModelInScope({ returnId: "r1", model: IN_SCOPE, store, visionClient });
    askVision.mockClear();

    const second = await checkModelInScope({
      returnId: "r1",
      model: first.model,
      store,
      visionClient,
    });

    expect(askVision).not.toHaveBeenCalled();
    expect(second.findings.map((f) => f.code)).toContain(
      "trust-partnership-managed-fund-distribution",
    );
  });

  it("re-checks a document whose detectedType changed since it was cached", async () => {
    const { store } = fakeStore([
      { docId: "d9", filename: "file.pdf", detectedType: "dividend-statement" },
    ]);
    const { visionClient, askVision } = fakeVision("[]");

    const first = await checkModelInScope({ returnId: "r1", model: IN_SCOPE, store, visionClient });
    askVision.mockClear();

    // Same docId, now classified `unrecognised` — still a content-check type, but the
    // cache entry is stale and must be re-run.
    const { store: store2 } = fakeStore([
      { docId: "d9", filename: "file.pdf", detectedType: "unrecognised" },
    ]);
    await checkModelInScope({ returnId: "r1", model: first.model, store: store2, visionClient });

    expect(askVision).toHaveBeenCalledOnce();
  });
});
