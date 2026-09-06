import { unsetField } from "@aus-tax-lodge/model";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { confirmedField, notApplicable, readyModel } from "./review-fixtures";

const { loadReturn, saveReturn } = vi.hoisted(() => ({
  loadReturn: vi.fn(),
  saveReturn: vi.fn(),
}));

vi.mock("../lib/returns", () => ({
  getReturnRepository: () => ({ loadReturn, saveReturn }),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import {
  saveQuestions,
  type QuestionsFormState,
} from "../app/returns/[returnId]/questions/actions";

const DUMMY_STATE: QuestionsFormState = { values: {} as never, errors: {} };

function envelope(model: unknown, revision = 1, targetYear = "2025-26") {
  return { targetYear, data: model, revision, currentStep: "questions" };
}

function jointAccount(id: string, sharePercent: number | null) {
  return {
    id,
    institution: confirmedField("ING"),
    accountDescription: confirmedField("Savings"),
    grossInterest: confirmedField(624),
    tfnAmountsWithheld: notApplicable<number>(),
    ownershipSharePercent:
      sharePercent == null ? unsetField<number>() : confirmedField(sharePercent),
  };
}

function validForm(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const base: Record<string, string> = {
    residencyFullYear: "yes",
    studyLoanHeld: "no",
    privateCoverDates: "full",
    wfhDoubleClaimed: "no",
    rentalSoleOwnershipAllYear: "yes",
    rentalBoughtOrSold: "no",
    ...overrides,
  };
  for (const [key, value] of Object.entries(base)) fd.set(key, value);
  return fd;
}

describe("saveQuestions server action (PRD FR-6, FR-7, FR-16)", () => {
  beforeEach(() => {
    loadReturn.mockReset();
    saveReturn.mockReset();
  });

  it("saves a model with every answer confirmed via answer(), then redirects to the estimate step", async () => {
    loadReturn.mockResolvedValue({ envelope: envelope(readyModel(), 3), readOnly: false });
    saveReturn.mockImplementation(async (_id, input) => ({
      conflict: false,
      envelope: envelope(input.data, 4),
    }));

    await expect(saveQuestions("ret1", 3, DUMMY_STATE, validForm())).rejects.toThrow(
      "REDIRECT:/returns/ret1/estimate",
    );

    expect(saveReturn).toHaveBeenCalledExactlyOnceWith(
      "ret1",
      expect.objectContaining({ currentStep: "estimate", expectedRevision: 3 }),
    );
    const savedModel = saveReturn.mock.calls[0]![1].data;
    expect(savedModel.questionnaire.residencyFullYear).toMatchObject({
      value: true,
      status: "confirmed",
      origin: { kind: "user-answer" },
    });
    expect(savedModel.questionnaire.studyLoanHeld.value).toBe(false);
    expect(savedModel.questionnaire.wfhHoursNotDoubleClaimed.value).toBe(true);
    expect(savedModel.questionnaire.privateCoverDatesConfirmed.value).toBe(true);
  });

  it("applies each unsettled joint account's submitted share via answer()", async () => {
    const model = {
      ...readyModel(),
      income: {
        ...readyModel().income,
        interestAccounts: [jointAccount("j1", null)],
      },
    };
    loadReturn.mockResolvedValue({ envelope: envelope(model, 1), readOnly: false });
    saveReturn.mockImplementation(async (_id, input) => ({
      conflict: false,
      envelope: envelope(input.data, 2),
    }));

    await expect(
      saveQuestions("ret1", 1, DUMMY_STATE, validForm({ "jointShare.j1": "50" })),
    ).rejects.toThrow("REDIRECT:");

    const savedModel = saveReturn.mock.calls[0]![1].data;
    expect(savedModel.income.interestAccounts[0].ownershipSharePercent).toMatchObject({
      value: 50,
      status: "confirmed",
    });
    expect(savedModel.questionnaire.jointAccountSharesProvided.value).toBe(true);
  });

  it("rejects a joint-account share outside 0-100 without touching the repository", async () => {
    const model = {
      ...readyModel(),
      income: { ...readyModel().income, interestAccounts: [jointAccount("j1", null)] },
    };
    loadReturn.mockResolvedValue({ envelope: envelope(model, 1), readOnly: false });

    const state = await saveQuestions(
      "ret1",
      1,
      DUMMY_STATE,
      validForm({ "jointShare.j1": "150" }),
    );

    expect(state.errors.jointAccounts?.j1).toMatch(/between 0 and 100/i);
    expect(saveReturn).not.toHaveBeenCalled();
  });

  it("assembles the rental scope gate from the two rental questions when a rental is present", async () => {
    const model = { ...readyModel(), rental: { ...readyModel().rental, present: true } };
    loadReturn.mockResolvedValue({ envelope: envelope(model, 1), readOnly: false });
    saveReturn.mockImplementation(async (_id, input) => ({
      conflict: false,
      envelope: envelope(input.data, 2),
    }));

    await expect(
      saveQuestions(
        "ret1",
        1,
        DUMMY_STATE,
        validForm({ rentalSoleOwnershipAllYear: "no", rentalBoughtOrSold: "yes" }),
      ),
    ).rejects.toThrow("REDIRECT:");

    const savedModel = saveReturn.mock.calls[0]![1].data;
    expect(savedModel.questionnaire.rentalScopeGate.value).toEqual({
      solelyOwned: false,
      rentedOrAvailableAllYear: false,
      noPrivateUse: false,
      notBoughtOrSoldThisYear: false,
    });
  });

  it("surfaces a residency disagreement (non-resident context vs 'whole year resident' answer) as an error, not a silent overwrite", async () => {
    const model = {
      ...readyModel(),
      context: {
        ...readyModel().context,
        residency: confirmedField("non-resident" as const),
      },
    };
    loadReturn.mockResolvedValue({ envelope: envelope(model, 1), readOnly: false });

    const state = await saveQuestions(
      "ret1",
      1,
      DUMMY_STATE,
      validForm({ residencyFullYear: "yes" }),
    );

    expect(state.errors.residencyDisagreement).toMatch(/choose which is correct/i);
    expect(saveReturn).not.toHaveBeenCalled();
  });

  it("saves once the residency disagreement is resolved, updating context to match the chosen side", async () => {
    const model = {
      ...readyModel(),
      context: { ...readyModel().context, residency: confirmedField("non-resident" as const) },
    };
    loadReturn.mockResolvedValue({ envelope: envelope(model, 1), readOnly: false });
    saveReturn.mockImplementation(async (_id, input) => ({
      conflict: false,
      envelope: envelope(input.data, 2),
    }));

    await expect(
      saveQuestions(
        "ret1",
        1,
        DUMMY_STATE,
        validForm({ residencyFullYear: "yes", residencyDisagreement: "use-answer" }),
      ),
    ).rejects.toThrow("REDIRECT:");

    const savedModel = saveReturn.mock.calls[0]![1].data;
    expect(savedModel.context.residency.value).toBe("resident-full-year");
    expect(savedModel.questionnaire.residencyFullYear.value).toBe(true);
  });

  it("reports a conflict instead of saving when the revision has moved on", async () => {
    loadReturn.mockResolvedValue({ envelope: envelope(readyModel(), 5), readOnly: false });
    saveReturn.mockResolvedValue({ conflict: true, current: envelope(readyModel(), 6) });

    const state = await saveQuestions("ret1", 5, DUMMY_STATE, validForm());

    expect(state.conflict).toBe(true);
    expect(state.formError).toMatch(/changed in another tab/i);
  });

  it("refuses to save over a read-only return", async () => {
    loadReturn.mockResolvedValue({
      envelope: envelope(readyModel(), 1, "2024-25"),
      readOnly: true,
    });

    const state = await saveQuestions("ret1", 1, DUMMY_STATE, validForm());

    expect(state.formError).toMatch(/read-only/i);
    expect(saveReturn).not.toHaveBeenCalled();
  });
});
