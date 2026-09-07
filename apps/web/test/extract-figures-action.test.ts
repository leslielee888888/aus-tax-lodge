import { createEmptyReturnModel } from "@aus-tax-lodge/model";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadReturn, saveReturn, listDocuments, getDocument, extractDocument, checkContent } =
  vi.hoisted(() => ({
    loadReturn: vi.fn(),
    saveReturn: vi.fn(),
    listDocuments: vi.fn(),
    getDocument: vi.fn(),
    extractDocument: vi.fn(),
    checkContent: vi.fn(),
  }));

vi.mock("../lib/returns", () => ({
  getReturnRepository: () => ({ loadReturn, saveReturn }),
}));

vi.mock("../lib/store", () => ({
  getDocumentStore: () => ({ listDocuments, getDocument }),
}));

vi.mock("../lib/ai/client", () => ({
  getClaudeClient: () => ({ askVision: vi.fn() }),
}));

vi.mock("@aus-tax-lodge/extraction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aus-tax-lodge/extraction")>();
  return { ...actual, extractDocument };
});

vi.mock("@aus-tax-lodge/scope", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aus-tax-lodge/scope")>();
  return { ...actual, checkDocumentForOutOfScopeContent: checkContent };
});

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import { detectOutOfScope, isBlocked } from "@aus-tax-lodge/scope";

import { extractFigures } from "../app/returns/[returnId]/documents/actions";
import { INITIAL_EXTRACT_FIGURES_STATE } from "../app/returns/[returnId]/documents/state";
import { scopeContentFindings } from "../lib/scope-content-scratch";

function fakeDoc(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    docId: "doc1",
    filename: "prefill.pdf",
    mimeType: "application/pdf",
    size: 100,
    detectedType: "ato-prefill-report",
    extractable: true,
    uploadedAt: "2026-09-04T00:00:00.000Z",
    ...overrides,
  };
}

const HIGH_CONFIDENCE = "high";

describe("extractFigures server action (PRD FR-2, FR-3, FR-7, FR-21)", () => {
  beforeEach(() => {
    loadReturn.mockReset();
    saveReturn.mockReset();
    listDocuments.mockReset();
    getDocument.mockReset();
    extractDocument.mockReset();
    checkContent.mockReset();
    getDocument.mockResolvedValue({
      metadata: { mimeType: "application/pdf" },
      bytes: Buffer.from("doc-bytes"),
    });
    // Default: the content check comes back clean (no out-of-scope categories).
    checkContent.mockImplementation(
      async ({ docId, filename }: { docId: string; filename: string }) => ({
        docId,
        filename,
        categories: [],
      }),
    );
  });

  it("extracts every extractable document not yet extracted, applies the figures, saves, and redirects to review", async () => {
    loadReturn.mockResolvedValue({
      envelope: { targetYear: "2025-26", data: null, revision: 1, currentStep: "documents" },
      readOnly: false,
    });
    listDocuments.mockResolvedValue([
      fakeDoc({ docId: "doc1" }),
      fakeDoc({ docId: "doc2", filename: "interest.pdf", detectedType: "bank-interest-notice" }),
    ]);
    extractDocument.mockImplementation(async (_returnId: string, docId: string) => ({
      docId,
      documentType: docId === "doc1" ? "ato-prefill-report" : "bank-interest-notice",
      figures: [
        {
          modelPath: "income.governmentAllowances",
          value: docId === "doc1" ? 1000 : 1000,
          page: 1,
          snippet: "Allowance $1,000",
          confidence: HIGH_CONFIDENCE,
        },
      ],
    }));
    saveReturn.mockResolvedValue({
      conflict: false,
      envelope: { targetYear: "2025-26", data: null, revision: 2 },
    });

    await expect(
      extractFigures("ret1", 1, INITIAL_EXTRACT_FIGURES_STATE, new FormData()),
    ).rejects.toThrow("REDIRECT:/returns/ret1/review");

    expect(extractDocument).toHaveBeenCalledTimes(2);
    expect(extractDocument).toHaveBeenCalledWith("ret1", "doc1", expect.anything());
    expect(extractDocument).toHaveBeenCalledWith("ret1", "doc2", expect.anything());

    expect(saveReturn).toHaveBeenCalledExactlyOnceWith(
      "ret1",
      expect.objectContaining({ currentStep: "review", expectedRevision: 1 }),
    );
    const savedModel = saveReturn.mock.calls[0]![1].data;
    expect(savedModel.income.governmentAllowances.value).toBe(1000);
    expect(savedModel.income.governmentAllowances.status).toBe("proposed");
  });

  it("skips a document that was already extracted in an earlier run", async () => {
    loadReturn.mockResolvedValue({
      envelope: {
        targetYear: "2025-26",
        revision: 1,
        currentStep: "documents",
        data: {
          ...createEmptyReturnModel("2025-26"),
          __t16Extraction: {
            extracted: [{ docId: "doc1", figuresCount: 1 }],
            pendingReconciliation: [],
          },
        },
      },
      readOnly: false,
    });
    listDocuments.mockResolvedValue([fakeDoc({ docId: "doc1" })]);
    saveReturn.mockResolvedValue({
      conflict: false,
      envelope: { targetYear: "2025-26", data: null, revision: 2 },
    });

    await expect(
      extractFigures("ret1", 1, INITIAL_EXTRACT_FIGURES_STATE, new FormData()),
    ).rejects.toThrow("REDIRECT:");

    expect(extractDocument).not.toHaveBeenCalled();
  });

  it("catches a single document's extraction failure, still applies and saves the others, and does not redirect", async () => {
    loadReturn.mockResolvedValue({
      envelope: { targetYear: "2025-26", data: null, revision: 4, currentStep: "documents" },
      readOnly: false,
    });
    listDocuments.mockResolvedValue([
      fakeDoc({ docId: "doc-ok" }),
      fakeDoc({ docId: "doc-bad", filename: "corrupt.pdf", detectedType: "dividend-statement" }),
    ]);
    extractDocument.mockImplementation(async (_returnId: string, docId: string) => {
      if (docId === "doc-bad") throw new Error("password-protected PDF");
      return {
        docId,
        documentType: "ato-prefill-report",
        figures: [
          {
            modelPath: "income.governmentAllowances",
            value: 500,
            page: 1,
            snippet: "$500",
            confidence: HIGH_CONFIDENCE,
          },
        ],
      };
    });
    saveReturn.mockResolvedValue({
      conflict: false,
      envelope: { targetYear: "2025-26", data: null, revision: 5 },
    });

    const result = await extractFigures("ret1", 4, INITIAL_EXTRACT_FIGURES_STATE, new FormData());

    expect(result.status).toBe("partial");
    expect(result.failed).toEqual([
      { docId: "doc-bad", filename: "corrupt.pdf", reason: "password-protected PDF" },
    ]);
    expect(result.succeeded).toEqual([{ docId: "doc-ok", figuresCount: 1 }]);

    // The batch didn't fail as a whole — the successful document's figures were saved.
    expect(saveReturn).toHaveBeenCalledExactlyOnceWith(
      "ret1",
      expect.objectContaining({ currentStep: "documents", expectedRevision: 4 }),
    );
    const savedModel = saveReturn.mock.calls[0]![1].data;
    expect(savedModel.income.governmentAllowances.value).toBe(500);
  });

  it("refuses to run on a read-only return", async () => {
    loadReturn.mockResolvedValue({
      envelope: { targetYear: "2024-25", data: null, revision: 1 },
      readOnly: true,
    });

    const result = await extractFigures("ret1", 1, INITIAL_EXTRACT_FIGURES_STATE, new FormData());

    expect(result.status).toBe("error");
    expect(result.formError).toMatch(/read-only/i);
    expect(listDocuments).not.toHaveBeenCalled();
  });

  it("reports a conflict instead of saving when the revision has moved on", async () => {
    loadReturn.mockResolvedValue({
      envelope: { targetYear: "2025-26", data: null, revision: 9, currentStep: "documents" },
      readOnly: false,
    });
    listDocuments.mockResolvedValue([]);
    saveReturn.mockResolvedValue({
      conflict: true,
      current: { targetYear: "2025-26", data: null, revision: 10 },
    });

    const result = await extractFigures("ret1", 9, INITIAL_EXTRACT_FIGURES_STATE, new FormData());

    expect(result.status).toBe("error");
    expect(result.conflict).toBe(true);
  });
});

describe("extractFigures — document-content out-of-scope check (PRD FR-20)", () => {
  beforeEach(() => {
    loadReturn.mockReset();
    saveReturn.mockReset();
    listDocuments.mockReset();
    getDocument.mockReset();
    extractDocument.mockReset();
    checkContent.mockReset();
    loadReturn.mockResolvedValue({
      envelope: { targetYear: "2025-26", data: null, revision: 1, currentStep: "documents" },
      readOnly: false,
    });
    getDocument.mockResolvedValue({
      metadata: { mimeType: "application/pdf" },
      bytes: Buffer.from("doc-bytes"),
    });
    extractDocument.mockImplementation(async (_returnId: string, docId: string) => ({
      docId,
      documentType: "dividend-statement",
      figures: [],
    }));
    checkContent.mockImplementation(
      async ({ docId, filename }: { docId: string; filename: string }) => ({
        docId,
        filename,
        categories: [],
      }),
    );
    saveReturn.mockResolvedValue({
      conflict: false,
      envelope: { targetYear: "2025-26", data: null, revision: 2 },
    });
  });

  it("checks a dividend-statement, persists an out-of-scope classification, and the review detector is then blocked", async () => {
    listDocuments.mockResolvedValue([
      fakeDoc({
        docId: "div1",
        filename: "acme-fund-statement.pdf",
        detectedType: "dividend-statement",
      }),
    ]);
    checkContent.mockResolvedValue({
      docId: "div1",
      filename: "acme-fund-statement.pdf",
      categories: ["trust-partnership-managed-fund-distribution"],
    });

    await expect(
      extractFigures("ret1", 1, INITIAL_EXTRACT_FIGURES_STATE, new FormData()),
    ).rejects.toThrow("REDIRECT:/returns/ret1/review");

    expect(checkContent).toHaveBeenCalledTimes(1);
    expect(checkContent).toHaveBeenCalledWith(
      expect.objectContaining({
        docId: "div1",
        filename: "acme-fund-statement.pdf",
        parts: [{ kind: "pdf", mimeType: "application/pdf", bytes: expect.any(Buffer) }],
      }),
      expect.anything(),
    );

    const savedModel = saveReturn.mock.calls[0]![1].data;
    expect(savedModel.__t26ScopeContent.classifications).toEqual([
      {
        docId: "div1",
        filename: "acme-fund-statement.pdf",
        detectedType: "dividend-statement",
        categories: ["trust-partnership-managed-fund-distribution"],
      },
    ]);

    // The review page's data path: feed the cached findings back to the detector.
    const findings = detectOutOfScope({
      model: savedModel,
      contentFindings: scopeContentFindings(savedModel),
    });
    expect(isBlocked(findings)).toBe(true);
    const trust = findings.find((f) => f.code === "trust-partnership-managed-fund-distribution");
    expect(trust?.source).toBe("document");
    expect(trust?.detail).toContain("acme-fund-statement.pdf");
  });

  it("checks an unrecognised document even though it is not extractable", async () => {
    listDocuments.mockResolvedValue([
      fakeDoc({
        docId: "unk1",
        filename: "mystery.pdf",
        detectedType: "unrecognised",
        extractable: false,
      }),
    ]);

    await expect(
      extractFigures("ret1", 1, INITIAL_EXTRACT_FIGURES_STATE, new FormData()),
    ).rejects.toThrow("REDIRECT:");

    expect(extractDocument).not.toHaveBeenCalled();
    expect(checkContent).toHaveBeenCalledTimes(1);
    expect(checkContent).toHaveBeenCalledWith(
      expect.objectContaining({ docId: "unk1" }),
      expect.anything(),
    );
    const savedModel = saveReturn.mock.calls[0]![1].data;
    expect(savedModel.__t26ScopeContent.classifications).toEqual([
      { docId: "unk1", filename: "mystery.pdf", detectedType: "unrecognised", categories: [] },
    ]);
  });

  it("does not re-check a document whose classification is already cached", async () => {
    loadReturn.mockResolvedValue({
      envelope: {
        targetYear: "2025-26",
        revision: 3,
        currentStep: "documents",
        data: {
          ...createEmptyReturnModel("2025-26"),
          __t26ScopeContent: {
            classifications: [
              {
                docId: "div1",
                filename: "divs.pdf",
                detectedType: "dividend-statement",
                categories: [],
              },
            ],
          },
        },
      },
      readOnly: false,
    });
    listDocuments.mockResolvedValue([
      fakeDoc({ docId: "div1", filename: "divs.pdf", detectedType: "dividend-statement" }),
    ]);

    await expect(
      extractFigures("ret1", 3, INITIAL_EXTRACT_FIGURES_STATE, new FormData()),
    ).rejects.toThrow("REDIRECT:");

    expect(checkContent).not.toHaveBeenCalled();
    const savedModel = saveReturn.mock.calls[0]![1].data;
    expect(savedModel.__t26ScopeContent.classifications).toHaveLength(1);
  });

  it("re-checks a document whose detectedType changed since it was cached", async () => {
    loadReturn.mockResolvedValue({
      envelope: {
        targetYear: "2025-26",
        revision: 3,
        currentStep: "documents",
        data: {
          ...createEmptyReturnModel("2025-26"),
          __t26ScopeContent: {
            classifications: [
              {
                docId: "doc1",
                filename: "f.pdf",
                detectedType: "unrecognised",
                categories: [],
              },
            ],
          },
        },
      },
      readOnly: false,
    });
    listDocuments.mockResolvedValue([
      fakeDoc({ docId: "doc1", filename: "f.pdf", detectedType: "dividend-statement" }),
    ]);

    await expect(
      extractFigures("ret1", 3, INITIAL_EXTRACT_FIGURES_STATE, new FormData()),
    ).rejects.toThrow("REDIRECT:");

    expect(checkContent).toHaveBeenCalledTimes(1);
    const savedModel = saveReturn.mock.calls[0]![1].data;
    expect(savedModel.__t26ScopeContent.classifications[0].detectedType).toBe("dividend-statement");
  });

  it("reports a content-check failure as a failed entry and does not advance to review", async () => {
    listDocuments.mockResolvedValue([
      fakeDoc({ docId: "div1", filename: "divs.pdf", detectedType: "dividend-statement" }),
    ]);
    checkContent.mockRejectedValue(new Error("Claude API 503"));

    const result = await extractFigures("ret1", 1, INITIAL_EXTRACT_FIGURES_STATE, new FormData());

    expect(result.status).toBe("partial");
    expect(result.failed).toEqual([
      { docId: "div1", filename: "divs.pdf", reason: "Claude API 503" },
    ]);
    expect(saveReturn).toHaveBeenCalledExactlyOnceWith(
      "ret1",
      expect.objectContaining({ currentStep: "documents", expectedRevision: 1 }),
    );
  });

  it("prunes a cached classification for a document that no longer needs a content check", async () => {
    loadReturn.mockResolvedValue({
      envelope: {
        targetYear: "2025-26",
        revision: 3,
        currentStep: "documents",
        data: {
          ...createEmptyReturnModel("2025-26"),
          __t16Extraction: {
            extracted: [{ docId: "doc1", figuresCount: 0 }],
            pendingReconciliation: [],
          },
          __t26ScopeContent: {
            classifications: [
              {
                docId: "doc1",
                filename: "f.pdf",
                detectedType: "dividend-statement",
                categories: [],
              },
            ],
          },
        },
      },
      readOnly: false,
    });
    // Re-typed to a recognised, trusted type — no longer in the content-check set.
    listDocuments.mockResolvedValue([
      fakeDoc({ docId: "doc1", filename: "f.pdf", detectedType: "bank-interest-notice" }),
    ]);

    await expect(
      extractFigures("ret1", 3, INITIAL_EXTRACT_FIGURES_STATE, new FormData()),
    ).rejects.toThrow("REDIRECT:");

    expect(checkContent).not.toHaveBeenCalled();
    const savedModel = saveReturn.mock.calls[0]![1].data;
    expect(savedModel.__t26ScopeContent.classifications).toEqual([]);
  });
});
