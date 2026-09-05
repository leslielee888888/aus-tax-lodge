import { createEmptyReturnModel } from "@aus-tax-lodge/model";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadReturn, saveReturn, listDocuments, extractDocument } = vi.hoisted(() => ({
  loadReturn: vi.fn(),
  saveReturn: vi.fn(),
  listDocuments: vi.fn(),
  extractDocument: vi.fn(),
}));

vi.mock("../lib/returns", () => ({
  getReturnRepository: () => ({ loadReturn, saveReturn }),
}));

vi.mock("../lib/store", () => ({
  getDocumentStore: () => ({ listDocuments }),
}));

vi.mock("../lib/ai/client", () => ({
  getClaudeClient: () => ({}),
}));

vi.mock("@aus-tax-lodge/extraction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aus-tax-lodge/extraction")>();
  return { ...actual, extractDocument };
});

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import {
  extractFigures,
  INITIAL_EXTRACT_FIGURES_STATE,
} from "../app/returns/[returnId]/documents/actions";

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
    extractDocument.mockReset();
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
