import { needsRepairsConfirmation } from "@aus-tax-lodge/model";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { confirmedField, proposed, readyModel } from "./review-fixtures";

const { loadReturn, saveReturn, listDocuments, deleteReturn } = vi.hoisted(() => ({
  loadReturn: vi.fn(),
  saveReturn: vi.fn(),
  listDocuments: vi.fn(),
  deleteReturn: vi.fn(),
}));

vi.mock("../lib/returns", () => ({
  getReturnRepository: () => ({ loadReturn, saveReturn, deleteReturn }),
}));

vi.mock("../lib/store", () => ({
  getDocumentStore: () => ({ listDocuments }),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import {
  confirmField,
  confirmRepairs,
  continueToQuestions,
  deleteReturnAction,
  editField,
  markFieldNotApplicable,
  reclassifyRepairs,
  resolveMismatch,
  setPrivateHealthHeld,
} from "../app/returns/[returnId]/review/actions";

function envelope(model: unknown, revision = 1, targetYear = "2025-26") {
  return { targetYear, data: model, revision, currentStep: "review" };
}

describe("review server actions (PRD FR-7, FR-13, FR-21, FR-24)", () => {
  beforeEach(() => {
    loadReturn.mockReset();
    saveReturn.mockReset();
    listDocuments.mockReset();
    deleteReturn.mockReset();
  });

  it("confirmField accepts a proposed value and saves", async () => {
    const model = readyModel();
    const next = { ...model, income: { ...model.income, governmentAllowances: proposed(500) } };
    loadReturn.mockResolvedValue({ envelope: envelope(next, 3), readOnly: false });
    saveReturn.mockImplementation(async (_id, input) => ({
      conflict: false,
      envelope: envelope(input.data, 4),
    }));

    const result = await confirmField("ret1", 3, "income.governmentAllowances");

    expect(result.ok).toBe(true);
    expect(saveReturn).toHaveBeenCalledExactlyOnceWith(
      "ret1",
      expect.objectContaining({ expectedRevision: 3 }),
    );
    expect(result.model?.income.governmentAllowances).toMatchObject({
      value: 500,
      status: "confirmed",
    });
  });

  it("editField rejects a non-numeric value without touching the repository", async () => {
    const result = await editField("ret1", 1, "income.governmentAllowances", "not-a-number");
    expect(result.ok).toBe(false);
    expect(loadReturn).not.toHaveBeenCalled();
  });

  it("editField records the edit and confirms the field", async () => {
    const model = readyModel();
    const next = { ...model, income: { ...model.income, governmentAllowances: proposed(500) } };
    loadReturn.mockResolvedValue({ envelope: envelope(next, 1), readOnly: false });
    saveReturn.mockImplementation(async (_id, input) => ({
      conflict: false,
      envelope: envelope(input.data, 2),
    }));

    const result = await editField("ret1", 1, "income.governmentAllowances", "750");

    expect(result.model?.income.governmentAllowances).toMatchObject({
      value: 750,
      status: "confirmed",
      proposedValue: 500,
    });
  });

  it("markFieldNotApplicable marks a label nil", async () => {
    const model = readyModel();
    const next = { ...model, income: { ...model.income, governmentAllowances: proposed(500) } };
    loadReturn.mockResolvedValue({ envelope: envelope(next, 1), readOnly: false });
    saveReturn.mockImplementation(async (_id, input) => ({
      conflict: false,
      envelope: envelope(input.data, 2),
    }));

    const result = await markFieldNotApplicable("ret1", 1, "income.governmentAllowances");
    expect(result.model?.income.governmentAllowances).toMatchObject({
      value: null,
      status: "not-applicable",
    });
  });

  it("refuses to mutate a read-only return", async () => {
    loadReturn.mockResolvedValue({
      envelope: envelope(readyModel(), 1, "2024-25"),
      readOnly: true,
    });
    const result = await confirmField("ret1", 1, "income.governmentAllowances");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/read-only/i);
    expect(saveReturn).not.toHaveBeenCalled();
  });

  it("reports a conflict instead of saving when the revision has moved on", async () => {
    const model = readyModel();
    const next = { ...model, income: { ...model.income, governmentAllowances: proposed(500) } };
    loadReturn.mockResolvedValue({ envelope: envelope(next, 5), readOnly: false });
    saveReturn.mockResolvedValue({ conflict: true, current: envelope(next, 6) });

    const result = await confirmField("ret1", 5, "income.governmentAllowances");
    expect(result.ok).toBe(false);
    expect(result.conflict).toBe(true);
  });

  it("confirmRepairs confirms the repair and settles the amount, clearing the gate", async () => {
    const model = readyModel();
    const withRepairs = {
      ...model,
      rental: {
        ...model.rental,
        present: true,
        expenses: {
          ...model.rental.expenses,
          repairsAndMaintenance: {
            amount: confirmedField(1_500),
            source: "agent-statement" as const,
          },
        },
      },
    };
    // The fixture confirms it directly for the "over-threshold" check; simulate
    // it arriving `proposed` (extraction), the realistic pre-review state.
    withRepairs.rental.expenses.repairsAndMaintenance.amount = proposed(1_500);
    expect(needsRepairsConfirmation(withRepairs.rental)).toBe(true);

    loadReturn.mockResolvedValue({ envelope: envelope(withRepairs, 1), readOnly: false });
    saveReturn.mockImplementation(async (_id, input) => ({
      conflict: false,
      envelope: envelope(input.data, 2),
    }));

    const result = await confirmRepairs("ret1", 1);
    expect(result.ok).toBe(true);
    const rental = result.model!.rental;
    expect(rental.repairsConfirmedNotCapital).toBe(true);
    expect(rental.expenses.repairsAndMaintenance.amount.status).toBe("confirmed");
    expect(needsRepairsConfirmation(rental)).toBe(false);
  });

  it("reclassifyRepairs moves the amount into capital works and re-nets the schedule", async () => {
    const model = readyModel();
    const withRepairs = {
      ...model,
      rental: {
        ...model.rental,
        present: true,
        grossRent: confirmedField(10_000),
        otherRentalIncome: confirmedField(0),
        expenses: {
          ...model.rental.expenses,
          repairsAndMaintenance: { amount: proposed(1_500), source: "agent-statement" as const },
          capitalWorks: { amount: confirmedField(2_000), source: "qs-schedule" as const },
        },
      },
    };
    loadReturn.mockResolvedValue({ envelope: envelope(withRepairs, 1), readOnly: false });
    saveReturn.mockImplementation(async (_id, input) => ({
      conflict: false,
      envelope: envelope(input.data, 2),
    }));

    const result = await reclassifyRepairs("ret1", 1);
    const rental = result.model!.rental;
    expect(rental.expenses.repairsAndMaintenance.amount.value).toBe(0);
    expect(rental.expenses.capitalWorks.amount.value).toBe(3_500);
    expect(rental.repairsConfirmedNotCapital).toBe(false);
    expect(needsRepairsConfirmation(rental)).toBe(false);
  });

  it("resolveMismatch applies the chosen candidate and removes that entry from the scratch", async () => {
    const model = readyModel();
    const withScratch = {
      ...model,
      __t16Extraction: {
        extracted: [],
        pendingReconciliation: [
          {
            modelPath: "income.governmentAllowances",
            candidates: [
              {
                docId: "doc-a",
                documentType: "ato-prefill-report",
                page: 1,
                snippet: "a",
                confidence: "high",
                value: 1_000,
              },
              {
                docId: "doc-b",
                documentType: "income-statement",
                page: 2,
                snippet: "b",
                confidence: "medium",
                value: 1_200,
              },
            ],
          },
        ],
      },
    };
    loadReturn.mockResolvedValue({ envelope: envelope(withScratch, 1), readOnly: false });
    saveReturn.mockImplementation(async (_id, input) => ({
      conflict: false,
      envelope: envelope(input.data, 2),
    }));

    const result = await resolveMismatch("ret1", 1, "income.governmentAllowances", 1);
    expect(result.ok).toBe(true);
    const saved = result.model as typeof withScratch;
    expect(saved.income.governmentAllowances.value).toBe(1_200);
    expect(saved.__t16Extraction.pendingReconciliation).toEqual([]);
  });

  it("setPrivateHealthHeld records the user's yes/no as their own answer", async () => {
    const model = readyModel();
    loadReturn.mockResolvedValue({ envelope: envelope(model, 1), readOnly: false });
    saveReturn.mockImplementation(async (_id, input) => ({
      conflict: false,
      envelope: envelope(input.data, 2),
    }));

    const result = await setPrivateHealthHeld("ret1", 1, true);
    expect(result.model?.privateHealth.held).toMatchObject({ value: true, status: "confirmed" });
  });

  it("deleteReturnAction deletes the return then redirects home", async () => {
    deleteReturn.mockResolvedValue(undefined);
    await expect(deleteReturnAction("ret1")).rejects.toThrow("REDIRECT:/");
    expect(deleteReturn).toHaveBeenCalledExactlyOnceWith("ret1");
  });

  it("continueToQuestions refuses to advance while a figure is still unconfirmed", async () => {
    const incomplete = {
      ...readyModel(),
      income: { ...readyModel().income, governmentAllowances: proposed(500) },
    };
    loadReturn.mockResolvedValue({ envelope: envelope(incomplete, 1), readOnly: false });
    listDocuments.mockResolvedValue([]);

    const result = await continueToQuestions("ret1", 1);
    expect(result.ok).toBe(false);
    expect(saveReturn).not.toHaveBeenCalled();
  });

  it("continueToQuestions advances currentStep and redirects once every gate is settled", async () => {
    const complete = readyModel();
    loadReturn.mockResolvedValue({ envelope: envelope(complete, 1), readOnly: false });
    listDocuments.mockResolvedValue([]);
    saveReturn.mockResolvedValue({ conflict: false, envelope: envelope(complete, 2) });

    await expect(continueToQuestions("ret1", 1)).rejects.toThrow(
      "REDIRECT:/returns/ret1/questions",
    );
    expect(saveReturn).toHaveBeenCalledExactlyOnceWith(
      "ret1",
      expect.objectContaining({ currentStep: "questions", expectedRevision: 1 }),
    );
  });
});
