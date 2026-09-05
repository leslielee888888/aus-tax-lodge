import { beforeEach, describe, expect, it, vi } from "vitest";

import { saveDetails, type DetailsFormState } from "../app/returns/[returnId]/details/actions";

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

const DUMMY_STATE: DetailsFormState = { values: {} as never, errors: {} };

function validForm(overrides: Record<string, string> = {}, hasSpouse = false): FormData {
  const fd = new FormData();
  const base: Record<string, string> = {
    fullName: "Priya Sharma",
    dob: "14/03/1990",
    line1: "1 Test St",
    line2: "",
    suburb: "Sydney",
    state: "NSW",
    postcode: "2000",
    tfn: "123456782",
    residency: "resident-full-year",
    bsb: "063-018",
    accountNumber: "12345678",
    accountName: "Priya Sharma",
    studyLoan: "yes",
    privateCoverDays: "365",
    dependentChildren: "0",
    ...overrides,
  };
  for (const [key, value] of Object.entries(base)) fd.set(key, value);
  if (hasSpouse) {
    fd.set("hasSpouse", "on");
    fd.set("spouseName", overrides.spouseName ?? "Alex Sharma");
    fd.set("spouseDob", overrides.spouseDob ?? "02/09/1988");
    fd.set("spouseIncome", overrides.spouseIncome ?? "78400");
    fd.set("spouseCoverDays", overrides.spouseCoverDays ?? "365");
  }
  return fd;
}

describe("saveDetails server action (PRD FR-1, FR-7, FR-16)", () => {
  beforeEach(() => {
    loadReturn.mockReset();
    saveReturn.mockReset();
  });

  it("re-validates and returns field errors without touching the repository", async () => {
    const state = await saveDetails("ret1", 1, DUMMY_STATE, validForm({ fullName: "" }));

    expect(state.errors.fullName).toMatch(/required/i);
    expect(loadReturn).not.toHaveBeenCalled();
    expect(saveReturn).not.toHaveBeenCalled();
  });

  it("saves a model with every touched field confirmed, then redirects to documents", async () => {
    loadReturn.mockResolvedValue({
      envelope: { targetYear: "2025-26", data: null, revision: 3 },
      readOnly: false,
    });
    saveReturn.mockResolvedValue({
      conflict: false,
      envelope: { targetYear: "2025-26", data: null, revision: 4 },
    });

    await expect(saveDetails("ret1", 3, DUMMY_STATE, validForm())).rejects.toThrow(
      "REDIRECT:/returns/ret1/documents",
    );

    expect(saveReturn).toHaveBeenCalledExactlyOnceWith(
      "ret1",
      expect.objectContaining({ currentStep: "documents", expectedRevision: 3 }),
    );
    const savedModel = saveReturn.mock.calls[0]![1].data;
    expect(savedModel.taxpayer.fullName).toMatchObject({
      value: "Priya Sharma",
      status: "confirmed",
    });
    expect(savedModel.taxpayer.taxFileNumber.value).toBe("123456782");
    expect(savedModel.context.spouse.status.value).toBe("none");
  });

  it("marks the spouse fields confirmed when the spouse toggle is submitted on", async () => {
    loadReturn.mockResolvedValue({
      envelope: { targetYear: "2025-26", data: null, revision: 1 },
      readOnly: false,
    });
    saveReturn.mockResolvedValue({
      conflict: false,
      envelope: { targetYear: "2025-26", data: null, revision: 2 },
    });

    await expect(saveDetails("ret1", 1, DUMMY_STATE, validForm({}, true))).rejects.toThrow(
      "REDIRECT:",
    );

    const savedModel = saveReturn.mock.calls.at(-1)![1].data;
    expect(savedModel.context.spouse.status.value).toBe("had-spouse");
    expect(savedModel.context.spouse.name).toMatchObject({
      value: "Alex Sharma",
      status: "confirmed",
    });
    expect(savedModel.context.spouse.estimatedTaxableIncome.value).toBe(78400);
  });

  it("reports a conflict instead of saving when the revision has moved on", async () => {
    loadReturn.mockResolvedValue({
      envelope: { targetYear: "2025-26", data: null, revision: 5 },
      readOnly: false,
    });
    saveReturn.mockResolvedValue({
      conflict: true,
      current: { targetYear: "2025-26", data: null, revision: 6 },
    });

    const state = await saveDetails("ret1", 5, DUMMY_STATE, validForm());

    expect(state.conflict).toBe(true);
    expect(state.formError).toMatch(/changed in another tab/i);
  });

  it("refuses to save over a read-only return", async () => {
    loadReturn.mockResolvedValue({
      envelope: { targetYear: "2024-25", data: null, revision: 1 },
      readOnly: true,
    });

    const state = await saveDetails("ret1", 1, DUMMY_STATE, validForm());

    expect(state.formError).toMatch(/read-only/i);
    expect(saveReturn).not.toHaveBeenCalled();
  });
});
