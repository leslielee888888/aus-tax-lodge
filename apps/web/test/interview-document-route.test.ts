/**
 * T6 — `POST /api/returns/:id/interview-document`: a document dropped
 * mid-interview (PRD FR-6, FR-7, FR-24). Mirrors `prefill-route.test.ts`.
 */
import {
  createEmptyReturnModel,
  documentOrigin,
  propose,
  unsetField,
  type ReturnModel,
} from "@aus-tax-lodge/model";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  ingestUploads,
  loadConversation,
  saveConversation,
  classifyDocument,
  extractDocument,
  applyExtractions,
  nextTurn,
  checkModelInScope,
  getDocument,
  listDocuments,
  askVision,
} = vi.hoisted(() => ({
  ingestUploads: vi.fn(),
  loadConversation: vi.fn(),
  saveConversation: vi.fn(),
  classifyDocument: vi.fn(),
  extractDocument: vi.fn(),
  applyExtractions: vi.fn(),
  nextTurn: vi.fn(),
  checkModelInScope: vi.fn(),
  getDocument: vi.fn(),
  listDocuments: vi.fn(),
  askVision: vi.fn(),
}));

vi.mock("../lib/documents", () => ({ ingestUploads }));
vi.mock("../lib/ai/client", () => ({ getClaudeClient: () => ({ ask: vi.fn(), askVision }) }));
vi.mock("../lib/store", () => ({
  getDocumentStore: () => ({ getDocument, listDocuments, putDocument: vi.fn() }),
}));
vi.mock("../lib/returns", () => ({
  loadConversation,
  saveConversation,
  ConversationReadOnlyError: class ConversationReadOnlyError extends Error {},
}));
vi.mock("../lib/interview", () => ({ nextTurn }));
vi.mock("../lib/scope-check", () => ({ checkModelInScope }));
vi.mock("@aus-tax-lodge/ai", () => ({ classifyDocument }));
vi.mock("@aus-tax-lodge/extraction", () => ({ extractDocument, applyExtractions }));

import { POST } from "../app/api/returns/[returnId]/interview-document/route";
import { emptyConversation, type ConversationState } from "../lib/conversation";

const ctx = { params: Promise.resolve({ returnId: "ret1" }) };
const EMPTY = createEmptyReturnModel("2025-26");

function request(fileName = "doc.pdf"): Request {
  const form = new FormData();
  form.append("file", new File(["%PDF-1.4"], fileName, { type: "application/pdf" }));
  return new Request("http://localhost/api/returns/ret1/interview-document", {
    method: "POST",
    body: form,
  });
}

function modelWithSalary(gross = 95_000): ReturnModel {
  const origin = documentOrigin("prefill", 1, "95,000", "high");
  return {
    ...EMPTY,
    income: {
      ...EMPTY.income,
      salaryWages: [
        {
          id: "e1",
          payerName: propose(unsetField<string>(), "Acme Pty Ltd", origin),
          payerAbn: unsetField<string>(),
          grossSalaryWages: propose(unsetField<number>(), gross, origin),
          paygWithheld: propose(unsetField<number>(), 22_000, origin),
        },
      ],
    },
  };
}

function loaded(model: ReturnModel, phase: ConversationState["phase"] = "interview") {
  return {
    envelope: { revision: 4, targetYear: "2025-26" },
    model,
    conversation: { ...emptyConversation(), phase },
    readOnly: false,
  };
}

const savedConversation = (): ConversationState =>
  saveConversation.mock.calls[0]![1].conversation as ConversationState;
const savedModel = (): ReturnModel => saveConversation.mock.calls[0]![1].model as ReturnModel;

function ingestAs(detectedType: string, extractable = true) {
  ingestUploads.mockResolvedValue({
    status: 201,
    body: {
      documents: [
        {
          docId: "new1",
          filename: "doc.pdf",
          mimeType: "application/pdf",
          detectedType,
          extractable,
        },
      ],
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  loadConversation.mockResolvedValue(loaded(EMPTY));
  saveConversation.mockResolvedValue({ conflict: false, envelope: { revision: 5 } });
  checkModelInScope.mockImplementation(async ({ model }: { model: unknown }) => ({
    findings: [],
    model,
  }));
  nextTurn.mockResolvedValue({ kind: "ask", text: "Anything else?" });
  getDocument.mockResolvedValue({
    metadata: { mimeType: "application/pdf" },
    bytes: Buffer.from("pdf"),
  });
  listDocuments.mockResolvedValue([]);
  applyExtractions.mockImplementation((model: ReturnModel) => ({
    model,
    pendingReconciliation: [],
  }));
});

describe("POST interview-document — guards", () => {
  it("400s when no file field is present", async () => {
    const res = await POST(
      new Request("http://localhost/x", { method: "POST", body: new FormData() }),
      ctx,
    );
    expect(res.status).toBe(400);
    expect(ingestUploads).not.toHaveBeenCalled();
  });

  it("409s when the conversation is not in the interview phase", async () => {
    ingestAs("wfh-or-expense-record");
    loadConversation.mockResolvedValue(loaded(EMPTY, "upload"));
    const res = await POST(request(), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe("not-in-interview");
  });
});

describe("POST interview-document — generic deduction document (PRD FR-3, FR-5)", () => {
  it("extracts, applies non-conflicting figures, and runs the interview on", async () => {
    ingestAs("wfh-or-expense-record");
    extractDocument.mockResolvedValue({
      docId: "new1",
      documentType: "wfh-or-expense-record",
      figures: [
        {
          modelPath: "deductions.workRelatedTravel.amount",
          value: 500,
          page: 1,
          snippet: "$500",
          confidence: "high",
        },
      ],
    });

    const res = await POST(request(), ctx);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.reason).toBe("generic");
    expect(applyExtractions).toHaveBeenCalledOnce();
    expect(nextTurn).toHaveBeenCalledOnce();

    const kinds = savedConversation().turns.map((t) => `${t.role}:${t.kind}`);
    expect(kinds).toEqual(["user:file", "assistant:message", "assistant:message"]);
    expect((savedModel() as unknown as Record<string, unknown>).__t16Extraction).toMatchObject({
      extracted: [{ docId: "new1", figuresCount: 1 }],
    });
  });

  it("holds back a figure that disagrees with the pre-fill and records a pending reconciliation (PRD FR-7)", async () => {
    ingestAs("income-statement");
    loadConversation.mockResolvedValue(loaded(modelWithSalary(95_000)));
    listDocuments.mockResolvedValue([
      { docId: "prefill", detectedType: "ato-prefill-report", filename: "prefill.pdf" },
      { docId: "new1", detectedType: "income-statement", filename: "doc.pdf" },
    ]);
    extractDocument.mockResolvedValue({
      docId: "new1",
      documentType: "income-statement",
      figures: [
        {
          modelPath: "income.salaryWages[0].grossSalaryWages",
          value: 98_000,
          page: 1,
          snippet: "98,000",
          confidence: "medium",
        },
      ],
    });

    const res = await POST(request(), ctx);
    expect((await res.json()).ok).toBe(true);

    // The conflicting figure was NOT applied (empty non-conflicting set)…
    expect(applyExtractions.mock.calls[0]![1][0].figures).toEqual([]);
    // …and the mismatch is on the scratch for the reconcile card, pre-fill first.
    const scratch = (savedModel() as unknown as Record<string, unknown>).__t16Extraction as {
      pendingReconciliation: { modelPath: string; candidates: { value: number }[] }[];
    };
    expect(scratch.pendingReconciliation).toHaveLength(1);
    expect(scratch.pendingReconciliation[0]!.modelPath).toBe(
      "income.salaryWages[0].grossSalaryWages",
    );
    expect(scratch.pendingReconciliation[0]!.candidates.map((c) => c.value)).toEqual([
      95_000, 98_000,
    ]);
  });

  it("says so plainly for an unhelpful document, staying in the interview", async () => {
    ingestAs("unrecognised", false);
    const res = await POST(request(), ctx);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.reason).toBe("not-helpful");
    expect(savedConversation().phase).toBe("interview");
    expect((savedConversation().turns[1] as { text: string }).text).toMatch(/tell me the amount/i);
    expect(extractDocument).not.toHaveBeenCalled();
  });
});

describe("POST interview-document — rental documents (PRD FR-24)", () => {
  it("folds a rental agent statement, summarises it, and warns about missing depreciation", async () => {
    ingestAs("rental-agent-statement");
    loadConversation.mockResolvedValue(
      loaded({ ...EMPTY, rental: { ...EMPTY.rental, present: true } }),
    );
    listDocuments.mockResolvedValue([
      { docId: "new1", detectedType: "rental-agent-statement", filename: "doc.pdf" },
    ]);
    askVision.mockImplementation(async (_p: unknown, prompt: string) =>
      prompt.includes("managing agent's annual statement")
        ? JSON.stringify({
            grossRent: { amount: 24_000, page: 1, snippet: "Rent $24,000" },
            otherRentalIncome: null,
            expenses: [
              {
                key: "repairsAndMaintenance",
                amount: 3200,
                page: 1,
                snippet: "Repairs $3,200",
                description: "",
              },
            ],
          })
        : "{}",
    );

    const res = await POST(request(), ctx);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.reason).toBe("rental");
    const model = savedModel();
    expect(model.rental.present).toBe(true);
    expect(model.rental.grossRent.value).toBe(24_000);

    const texts = savedConversation()
      .turns.filter((t) => t.role === "assistant" && t.kind === "message")
      .map((t) => (t as { text: string }).text);
    expect(texts.join(" ")).toMatch(/\$24,000 gross rent/);
    expect(texts.join(" ")).toMatch(/under-claiming/i); // no QS schedule warning
    expect(texts.join(" ")).toMatch(/\$3,200/); // repairs-over-$1,000 prompt
    expect(extractDocument).not.toHaveBeenCalled();
  });
});

describe("POST interview-document — out of scope (PRD FR-9)", () => {
  it("hard-stops, keeps the pre-document model, and does not run the interview", async () => {
    ingestAs("dividend-statement");
    loadConversation.mockResolvedValue(loaded(EMPTY));
    extractDocument.mockResolvedValue({
      docId: "new1",
      documentType: "dividend-statement",
      figures: [],
    });
    checkModelInScope.mockResolvedValue({
      findings: [
        {
          code: "trust-distribution",
          item: "Managed fund distribution",
          detail: "Needs the trust rules.",
          source: "document",
        },
      ],
      model: EMPTY,
    });

    const res = await POST(request(), ctx);
    const body = await res.json();

    expect(body.ok).toBe(false);
    expect(body.reason).toBe("out-of-scope");
    expect(nextTurn).not.toHaveBeenCalled();

    const saved = savedConversation();
    expect(saved.phase).toBe("stopped");
    expect(saved.stoppedReason).toBe("Managed fund distribution");
    expect(saved.turns.map((t) => `${t.role}:${t.kind}`)).toEqual(["user:file", "assistant:card"]);
    expect(saveConversation.mock.calls[0]![1].model).toBe(EMPTY);
  });
});

describe("POST interview-document — failure handling (FR-14)", () => {
  function extractableDoc() {
    ingestAs("wfh-or-expense-record");
    extractDocument.mockResolvedValue({
      docId: "new1",
      documentType: "wfh-or-expense-record",
      figures: [
        {
          modelPath: "deductions.workRelatedTravel.amount",
          value: 500,
          page: 1,
          snippet: "$500",
          confidence: "high",
        },
      ],
    });
  }

  it("a 429 reading the document is a resumable pause — model + phase untouched", async () => {
    ingestAs("wfh-or-expense-record");
    extractDocument.mockRejectedValue(Object.assign(new Error("429"), { status: 429 }));

    const res = await POST(request(), ctx);
    const body = await res.json();

    expect(body.ok).toBe(false);
    expect(body.reason).toBe("unreadable");
    expect(body.rateLimited).toBe(true);
    expect(nextTurn).not.toHaveBeenCalled();

    const saved = savedConversation();
    expect(saved.phase).toBe("interview");
    expect((saved.turns.at(-1) as { text: string }).text).toMatch(/usage limit/i);
    expect(saveConversation.mock.calls[0]![1].model).toBe(EMPTY);
  });

  it("an incomplete scope check does not let the document's figures through as in-scope", async () => {
    extractableDoc();
    checkModelInScope.mockRejectedValue(new Error("scope vision timeout"));

    const res = await POST(request(), ctx);
    const body = await res.json();

    expect(body.ok).toBe(false);
    expect(body.reason).toBe("scope-check-failed");
    expect(body.rateLimited).toBe(false);
    expect(nextTurn).not.toHaveBeenCalled();

    const saved = savedConversation();
    expect(saved.phase).toBe("interview");
    expect((saved.turns.at(-1) as { text: string }).text).toMatch(/couldn't finish checking/i);
    // The pre-document model is persisted — no figure leakage.
    expect(saveConversation.mock.calls[0]![1].model).toBe(EMPTY);
  });
});
