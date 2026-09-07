/**
 * T25 — rental property web-flow wiring (PRD FR-24).
 *
 * Part 1: the `extractFigures` server action routes the three rental document
 * types through `assembleRentalSchedule` (never the generic prompt table),
 * folds owner-paid expenses and hand-entered Div 43 / Div 40 totals in, and a
 * no-QS-schedule rental still completes.
 *
 * Part 2: a fully-completed, negatively-geared rental return reaches the
 * estimate, is not export-blocked, and produces a non-null export
 * `rentalSchedule` carrying the expected net loss.
 */
import { assess, getTaxonomy, PARAMS_VERSION } from "@aus-tax-lodge/engine";
import {
  createEmptyReturnModel,
  isReadyForEstimate,
  recomputeNetRentalResult,
  RENTAL_EXPENSE_KEYS,
  toEngineInput,
  type ReturnModel,
} from "@aus-tax-lodge/model";
import { buildReturnJson } from "@aus-tax-lodge/export";
import { isExportBlocked, validateReturn } from "@aus-tax-lodge/validation";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { confirmedField, notApplicable, answered } from "./review-fixtures";
import { exportableModel } from "./export-fixtures";

// ---------------------------------------------------------------------------
// Part 1 — extractFigures rental routing
// ---------------------------------------------------------------------------

const { loadReturn, saveReturn, listDocuments, getDocument, askVision } = vi.hoisted(() => ({
  loadReturn: vi.fn(),
  saveReturn: vi.fn(),
  listDocuments: vi.fn(),
  getDocument: vi.fn(),
  askVision: vi.fn(),
}));

vi.mock("../lib/returns", () => ({ getReturnRepository: () => ({ loadReturn, saveReturn }) }));
vi.mock("../lib/store", () => ({ getDocumentStore: () => ({ listDocuments, getDocument }) }));
vi.mock("../lib/ai/client", () => ({ getClaudeClient: () => ({ askVision }) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import { extractFigures } from "../app/returns/[returnId]/documents/actions";
import { INITIAL_EXTRACT_FIGURES_STATE } from "../app/returns/[returnId]/documents/state";

function rentalDoc(docId: string, detectedType: string, filename: string) {
  return {
    docId,
    filename,
    mimeType: "application/pdf",
    size: 100,
    detectedType,
    extractable: true,
    uploadedAt: "2026-09-04T00:00:00.000Z",
  };
}

function modelWithRentalPresent(): ReturnModel {
  const base = createEmptyReturnModel("2025-26");
  return { ...base, rental: { ...base.rental, present: true } };
}

function formDataWith(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

describe("extractFigures — rental documents (PRD FR-24)", () => {
  beforeEach(() => {
    loadReturn.mockReset();
    saveReturn.mockReset();
    listDocuments.mockReset();
    getDocument.mockReset();
    askVision.mockReset();

    loadReturn.mockResolvedValue({
      envelope: {
        targetYear: "2025-26",
        data: modelWithRentalPresent(),
        revision: 1,
        currentStep: "documents",
      },
      readOnly: false,
    });
    getDocument.mockResolvedValue({
      metadata: { mimeType: "application/pdf" },
      bytes: Buffer.from("pdf-bytes"),
    });
    saveReturn.mockResolvedValue({
      conflict: false,
      envelope: { targetYear: "2025-26", data: null, revision: 2 },
    });
    askVision.mockImplementation(async (_parts: unknown, prompt: string) => {
      if (prompt.includes("managing agent's annual statement")) {
        return JSON.stringify({
          grossRent: { amount: 24000, page: 1, snippet: "Rent collected $24,000" },
          otherRentalIncome: null,
          expenses: [
            {
              key: "agentFees",
              amount: 1800,
              page: 1,
              snippet: "Management fee $1,800",
              description: "",
            },
          ],
        });
      }
      if (prompt.includes("lender's annual interest summary")) {
        return JSON.stringify({
          interestOnLoans: { amount: 30000, page: 1, snippet: "Interest charged $30,000" },
          borrowingExpenses: null,
        });
      }
      return "{}";
    });
  });

  it("routes agent statement + loan summary through assembleRentalSchedule and never calls the generic extractor", async () => {
    listDocuments.mockResolvedValue([
      rentalDoc("agent", "rental-agent-statement", "agent.pdf"),
      rentalDoc("loan", "loan-interest-summary", "loan.pdf"),
    ]);

    await expect(
      extractFigures("ret1", 1, INITIAL_EXTRACT_FIGURES_STATE, new FormData()),
    ).rejects.toThrow("REDIRECT:/returns/ret1/review");

    const saved: ReturnModel = saveReturn.mock.calls[0]![1].data;
    expect(saved.rental.present).toBe(true);
    expect(saved.rental.grossRent.value).toBe(24000);
    expect(saved.rental.grossRent.status).toBe("proposed");
    expect(saved.rental.expenses.agentFees.amount.value).toBe(1800);
    expect(saved.rental.expenses.agentFees.source).toBe("agent-statement");
    expect(saved.rental.expenses.interestOnLoans.amount.value).toBe(30000);
    expect(saved.rental.expenses.interestOnLoans.source).toBe("loan-summary");
    // net = 24000 − (1800 + 30000) = −7800
    expect(saved.rental.netRentalResult.value).toBe(-7800);

    expect(getDocument).toHaveBeenCalledWith("ret1", "agent");
    expect(getDocument).toHaveBeenCalledWith("ret1", "loan");
    expect(askVision).toHaveBeenCalledTimes(2);
  });

  it("folds owner-paid expenses and, with no QS schedule, hand-entered Div 43 / Div 40 totals", async () => {
    listDocuments.mockResolvedValue([rentalDoc("agent", "rental-agent-statement", "agent.pdf")]);

    await expect(
      extractFigures(
        "ret1",
        1,
        INITIAL_EXTRACT_FIGURES_STATE,
        formDataWith({
          ownerPaidInsurance: "640",
          ownerPaidLandTax: "1200",
          manualCapitalWorks: "5000",
          manualDeclineInValue: "2200",
        }),
      ),
    ).rejects.toThrow("REDIRECT:");

    const saved: ReturnModel = saveReturn.mock.calls[0]![1].data;
    expect(saved.rental.expenses.insurance.amount.value).toBe(640);
    expect(saved.rental.expenses.insurance.amount.status).toBe("confirmed");
    expect(saved.rental.expenses.insurance.source).toBe("owner-paid");
    expect(saved.rental.expenses.landTax.amount.value).toBe(1200);
    expect(saved.rental.expenses.capitalWorks.amount.value).toBe(5000);
    expect(saved.rental.expenses.capitalWorks.amount.status).toBe("confirmed");
    expect(saved.rental.expenses.declineInValue.amount.value).toBe(2200);
  });

  it("ignores hand-entered Div 43 / Div 40 when a QS depreciation schedule is uploaded", async () => {
    listDocuments.mockResolvedValue([
      rentalDoc("agent", "rental-agent-statement", "agent.pdf"),
      rentalDoc("qs", "qs-depreciation-schedule", "qs.pdf"),
    ]);
    askVision.mockImplementation(async (_parts: unknown, prompt: string) => {
      if (prompt.includes("managing agent's annual statement")) {
        return JSON.stringify({
          grossRent: { amount: 24000, page: 1, snippet: "x" },
          otherRentalIncome: null,
          expenses: [],
        });
      }
      if (prompt.includes("quantity surveyor's tax depreciation schedule")) {
        return JSON.stringify({
          capitalWorks: { amount: 3100, page: 1, snippet: "Div 43 $3,100" },
          declineInValue: { amount: 900, page: 1, snippet: "Div 40 $900" },
        });
      }
      return "{}";
    });

    await expect(
      extractFigures(
        "ret1",
        1,
        INITIAL_EXTRACT_FIGURES_STATE,
        formDataWith({ manualCapitalWorks: "9999" }),
      ),
    ).rejects.toThrow("REDIRECT:");

    const saved: ReturnModel = saveReturn.mock.calls[0]![1].data;
    expect(saved.rental.expenses.capitalWorks.amount.value).toBe(3100);
    expect(saved.rental.expenses.capitalWorks.source).toBe("qs-schedule");
    expect(saved.rental.expenses.declineInValue.amount.value).toBe(900);
  });

  it("reports a rental document it cannot read like any other failed file, without aborting the batch", async () => {
    listDocuments.mockResolvedValue([
      rentalDoc("agent", "rental-agent-statement", "agent.pdf"),
      rentalDoc("loan", "loan-interest-summary", "loan.pdf"),
    ]);
    getDocument.mockImplementation(async (_returnId: string, docId: string) => {
      if (docId === "loan") throw new Error("password-protected PDF");
      return { metadata: { mimeType: "application/pdf" }, bytes: Buffer.from("x") };
    });

    const result = await extractFigures("ret1", 1, INITIAL_EXTRACT_FIGURES_STATE, new FormData());
    expect(result.status).toBe("partial");
    expect(result.failed).toEqual([
      { docId: "loan", filename: "loan.pdf", reason: "password-protected PDF" },
    ]);
    const saved: ReturnModel = saveReturn.mock.calls[0]![1].data;
    expect(saved.rental.grossRent.value).toBe(24000);
    expect(saveReturn).toHaveBeenCalledWith(
      "ret1",
      expect.objectContaining({ currentStep: "documents" }),
    );
  });
});

// ---------------------------------------------------------------------------
// Part 2 — a completed negatively-geared rental return
// ---------------------------------------------------------------------------

/**
 * `exportableModel()` (readyModel + taxpayer identity) plus a fully-confirmed
 * rental: gross rent $24,000, interest $30,000, agent fees $2,000 → a net
 * rental loss of −$8,000. Every other rental expense line is nil.
 */
function negativelyGearedRental(): ReturnModel {
  const base = exportableModel();
  const expenses = { ...base.rental.expenses };
  for (const key of RENTAL_EXPENSE_KEYS) {
    expenses[key] = { amount: notApplicable<number>(), source: null };
  }
  expenses.interestOnLoans = { amount: confirmedField(30_000), source: "loan-summary" };
  expenses.agentFees = { amount: confirmedField(2_000), source: "agent-statement" };

  const rental = recomputeNetRentalResult({
    ...base.rental,
    present: true,
    property: {
      addressLine1: confirmedField("10 Landlord Ln"),
      suburb: confirmedField("Brunswick"),
      state: confirmedField("VIC"),
      postcode: confirmedField("3056"),
      firstEarnedIncomeOn: confirmedField("2019-07-01"),
    },
    soleOwnership: confirmedField(true),
    rentedOrAvailableAllYear: confirmedField(true),
    noPrivateUse: confirmedField(true),
    grossRent: confirmedField(24_000),
    otherRentalIncome: notApplicable<number>(),
    expenses,
    repairsConfirmedNotCapital: false,
  });

  return {
    ...base,
    rental,
    questionnaire: {
      ...base.questionnaire,
      rentalScopeGate: answered({
        solelyOwned: true,
        rentedOrAvailableAllYear: true,
        noPrivateUse: true,
        notBoughtOrSoldThisYear: true,
      }),
    },
  };
}

describe("a completed negatively-geared rental return (PRD FR-24)", () => {
  it("reaches the estimate, is not export-blocked, and exports a net rental loss of −$8,000", () => {
    const model = negativelyGearedRental();

    // net rental result = 24,000 − (30,000 + 2,000) = −8,000
    expect(model.rental.netRentalResult.value).toBe(-8_000);

    expect(isReadyForEstimate(model)).toBe(true);

    const assessment = assess(toEngineInput(model));
    const issues = validateReturn(model, assessment);
    expect(isExportBlocked(issues)).toBe(false);

    const json = buildReturnJson({
      model,
      assessment,
      taxonomy: getTaxonomy(model.targetYear),
      paramsVersion: PARAMS_VERSION,
      targetYear: model.targetYear,
      documents: [],
      acknowledgedWarningIds: [],
      statedAssumptions: [],
    });
    expect(json.rentalSchedule).not.toBeNull();
    expect(json.rentalSchedule!.netRentalResult).toBe(-8_000);
  });
});
