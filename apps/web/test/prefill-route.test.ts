import {
  createEmptyReturnModel,
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
} = vi.hoisted(() => ({
  ingestUploads: vi.fn(),
  loadConversation: vi.fn(),
  saveConversation: vi.fn(),
  classifyDocument: vi.fn(),
  extractDocument: vi.fn(),
  applyExtractions: vi.fn(),
  nextTurn: vi.fn(),
}));

vi.mock("../lib/documents", () => ({ ingestUploads }));
vi.mock("../lib/ai/client", () => ({ getClaudeClient: () => ({ askVision: vi.fn(), ask: vi.fn() }) }));
vi.mock("../lib/store", () => ({ getDocumentStore: () => ({ getDocument: vi.fn(), putDocument: vi.fn() }) }));
vi.mock("../lib/returns", () => ({
  loadConversation,
  saveConversation,
  ConversationReadOnlyError: class ConversationReadOnlyError extends Error {},
}));
vi.mock("../lib/interview", () => ({ nextTurn }));
vi.mock("@aus-tax-lodge/ai", () => ({ classifyDocument }));
vi.mock("@aus-tax-lodge/extraction", () => ({ extractDocument, applyExtractions }));

import { POST } from "../app/api/returns/[returnId]/prefill/route";
import { emptyConversation, type ConversationState } from "../lib/conversation";

const EMPTY_MODEL = createEmptyReturnModel("2025-26");

function modelWithSalary(): ReturnModel {
  const base = createEmptyReturnModel("2025-26");
  const origin = { kind: "document", docId: "d1", page: 1, snippet: "x", confidence: "high" } as const;
  return {
    ...base,
    income: {
      ...base.income,
      salaryWages: [
        {
          id: "e1",
          payerName: propose(unsetField<string>(), "Acme Pty Ltd", origin),
          payerAbn: unsetField<string>(),
          grossSalaryWages: propose(unsetField<number>(), 95_000, origin),
          paygWithheld: propose(unsetField<number>(), 22_000, origin),
        },
      ],
    },
  };
}

function request(fileName = "prefill.pdf"): Request {
  const form = new FormData();
  form.append("file", new File(["%PDF-1.4"], fileName, { type: "application/pdf" }));
  return new Request("http://localhost/api/returns/ret1/prefill", { method: "POST", body: form });
}

const ctx = { params: Promise.resolve({ returnId: "ret1" }) };

function loadedUpload(overrides: Record<string, unknown> = {}) {
  return {
    envelope: { revision: 4, targetYear: "2025-26" },
    model: EMPTY_MODEL,
    conversation: { ...emptyConversation(), phase: "upload" } as ConversationState,
    readOnly: false,
    ...overrides,
  };
}

function savedConversation(): ConversationState {
  return saveConversation.mock.calls[0]![1].conversation as ConversationState;
}

beforeEach(() => {
  vi.clearAllMocks();
  loadConversation.mockResolvedValue(loadedUpload());
  saveConversation.mockResolvedValue({ conflict: false, envelope: { revision: 5 } });
  ingestUploads.mockResolvedValue({
    status: 201,
    body: {
      documents: [
        {
          docId: "doc1",
          filename: "prefill.pdf",
          mimeType: "application/pdf",
          size: 10,
          detectedType: "ato-prefill-report",
          extractable: true,
          uploadedAt: "2026-09-08T00:00:00.000Z",
        },
      ],
    },
  });
});

describe("POST /api/returns/:id/prefill (PRD FR-1, FR-2)", () => {
  it("rejects a non-pre-fill document, keeps phase 'upload', and never extracts", async () => {
    ingestUploads.mockResolvedValue({
      status: 201,
      body: {
        documents: [
          { docId: "doc9", filename: "divs.pdf", detectedType: "dividend-statement" },
        ],
      },
    });

    const res = await POST(request("divs.pdf"), ctx);
    const body = await res.json();

    expect(body.ok).toBe(false);
    expect(body.reason).toBe("wrong-type");
    expect(extractDocument).not.toHaveBeenCalled();

    const saved = savedConversation();
    expect(saved.phase).toBe("upload");
    const assistant = saved.turns.at(-1) as { role: string; kind: string; text: string };
    expect(assistant.role).toBe("assistant");
    expect(assistant.text).toMatch(/dividend statement/i);
    expect(assistant.text).toMatch(/pre-fill report/i);
  });

  it("extracts a real pre-fill report: file chip, income summary, phase 'interview', a first turn", async () => {
    extractDocument.mockResolvedValue({
      docId: "doc1",
      documentType: "ato-prefill-report",
      figures: [{ modelPath: "income.salaryWages[0].grossSalaryWages", value: 95000, page: 1, snippet: "x", confidence: "high" }],
    });
    applyExtractions.mockReturnValue({ model: modelWithSalary(), pendingReconciliation: [] });
    nextTurn.mockResolvedValue({ kind: "ask", text: "Did you work from home this year?" });

    const res = await POST(request(), ctx);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.revision).toBe(5);
    expect(nextTurn).toHaveBeenCalledOnce();

    const saved = savedConversation();
    expect(saved.phase).toBe("interview");

    const kinds = saved.turns.map((t) => `${t.role}:${t.kind}`);
    expect(kinds).toEqual(["user:file", "assistant:message", "assistant:message"]);

    expect((saved.turns[0] as { filename: string; docId: string })).toMatchObject({
      filename: "prefill.pdf",
      docId: "doc1",
    });
    expect((saved.turns[1] as { text: string }).text).toMatch(/\$95,000 salary from Acme Pty Ltd/);
    expect((saved.turns[2] as { text: string }).text).toBe("Did you work from home this year?");

    // Extraction bookkeeping rides along on the saved model.
    const savedModel = saveConversation.mock.calls[0]![1].model as Record<string, unknown>;
    expect(savedModel.__t16Extraction).toMatchObject({ extracted: [{ docId: "doc1", figuresCount: 1 }] });
  });

  it("does not crash or advance when extraction throws", async () => {
    extractDocument.mockRejectedValue(new Error("Claude 429"));

    const res = await POST(request(), ctx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("unreadable");
    expect(nextTurn).not.toHaveBeenCalled();

    const saved = savedConversation();
    expect(saved.phase).toBe("upload");
    expect((saved.turns.at(-1) as { text: string }).text).toMatch(/couldn't read that file/i);
    // The confirmed model is untouched.
    expect(saveConversation.mock.calls[0]![1].model).toBe(EMPTY_MODEL);
  });

  it("400s when no file field is present", async () => {
    const res = await POST(
      new Request("http://localhost/x", { method: "POST", body: new FormData() }),
      ctx,
    );
    expect(res.status).toBe(400);
    expect(ingestUploads).not.toHaveBeenCalled();
  });
});
