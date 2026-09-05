// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { proposed, readyModel } from "./review-fixtures";

const {
  confirmField,
  editField,
  markFieldNotApplicable,
  confirmInterestAccount,
  editInterestAccount,
  markInterestAccountNotApplicable,
  setPrivateHealthHeld,
  confirmRepairs,
  reclassifyRepairs,
  resolveMismatch,
  continueToQuestions,
} = vi.hoisted(() => ({
  confirmField: vi.fn(),
  editField: vi.fn(),
  markFieldNotApplicable: vi.fn(),
  confirmInterestAccount: vi.fn(),
  editInterestAccount: vi.fn(),
  markInterestAccountNotApplicable: vi.fn(),
  setPrivateHealthHeld: vi.fn(),
  confirmRepairs: vi.fn(),
  reclassifyRepairs: vi.fn(),
  resolveMismatch: vi.fn(),
  continueToQuestions: vi.fn(),
}));

vi.mock("../app/returns/[returnId]/review/actions", () => ({
  confirmField,
  editField,
  markFieldNotApplicable,
  confirmInterestAccount,
  editInterestAccount,
  markInterestAccountNotApplicable,
  setPrivateHealthHeld,
  confirmRepairs,
  reclassifyRepairs,
  resolveMismatch,
  continueToQuestions,
}));

import { ReviewSections } from "../app/returns/[returnId]/review/ReviewSections";

afterEach(cleanup);

/** The row `<div>` that carries `label`'s text — two levels up from the label itself (label → the label column → the row). */
function rowFor(label: string | RegExp): HTMLElement {
  return screen.getByText(label).parentElement!.parentElement as HTMLElement;
}

function continueButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: /continue to questions/i }) as HTMLButtonElement;
}

describe("ReviewSections (PRD FR-7, FR-13, FR-21, FR-24)", () => {
  beforeEach(() => {
    confirmField.mockReset();
    editField.mockReset();
    markFieldNotApplicable.mockReset();
    confirmInterestAccount.mockReset();
    editInterestAccount.mockReset();
    markInterestAccountNotApplicable.mockReset();
    setPrivateHealthHeld.mockReset();
    confirmRepairs.mockReset();
    reclassifyRepairs.mockReset();
    resolveMismatch.mockReset();
    continueToQuestions.mockReset();
  });

  it("shows the partially-confirmed state and disables Continue while a figure is still proposed", () => {
    const model = {
      ...readyModel(),
      income: { ...readyModel().income, governmentAllowances: proposed(500) },
    };
    render(
      <ReviewSections
        returnId="ret1"
        initialModel={model}
        initialRevision={1}
        documentsByDocId={{}}
      />,
    );
    expect(continueButton().disabled).toBe(true);
    expect(screen.getByText(/unconfirmed figure/i)).toBeTruthy();
  });

  it("confirming a field calls the action and the row adopts the returned model's status", async () => {
    const model = {
      ...readyModel(),
      income: { ...readyModel().income, governmentAllowances: proposed(500) },
    };
    const confirmed = {
      ...model,
      income: {
        ...model.income,
        governmentAllowances: { ...proposed(500), status: "confirmed" as const },
      },
    };
    confirmField.mockResolvedValue({ ok: true, model: confirmed, revision: 2 });

    render(
      <ReviewSections
        returnId="ret1"
        initialModel={model}
        initialRevision={1}
        documentsByDocId={{}}
      />,
    );

    const row = rowFor("Australian Government allowances and payments");
    fireEvent.click(within(row).getByRole("button", { name: "Confirm" }));

    await waitFor(() =>
      expect(confirmField).toHaveBeenCalledWith("ret1", 1, "income.governmentAllowances"),
    );
    await waitFor(() =>
      expect(
        within(rowFor("Australian Government allowances and payments")).getByText("Confirmed"),
      ).toBeTruthy(),
    );
  });

  it("an unverified field's Confirm is hidden until the source is opened", async () => {
    const model = {
      ...readyModel(),
      income: {
        ...readyModel().income,
        governmentAllowances: proposed(500, { docId: "unverified-doc", confidence: "unverified" }),
      },
    };
    render(
      <ReviewSections
        returnId="ret1"
        initialModel={model}
        initialRevision={1}
        documentsByDocId={{ "unverified-doc": "receipt.pdf" }}
      />,
    );

    const row = rowFor("Australian Government allowances and payments");
    expect(within(row).queryByRole("button", { name: "Confirm" })).toBeNull();
    expect(within(row).getByText(/open source to confirm/i)).toBeTruthy();

    fireEvent.click(within(row).getByText(/receipt\.pdf/));
    await waitFor(() => expect(within(row).getByRole("button", { name: "Confirm" })).toBeTruthy());
  });

  it("the rental repairs prompt blocks Continue and reclassify moves the amount off the repairs line", async () => {
    const base = readyModel();
    const withRepairs = {
      ...base,
      rental: {
        ...base.rental,
        present: true,
        grossRent: proposed(10_000),
        expenses: {
          ...base.rental.expenses,
          repairsAndMaintenance: { amount: proposed(1_500), source: "agent-statement" as const },
          capitalWorks: { amount: proposed(0), source: "qs-schedule" as const },
        },
      },
    };
    const reclassified = {
      ...withRepairs,
      rental: {
        ...withRepairs.rental,
        repairsConfirmedNotCapital: false,
        expenses: {
          ...withRepairs.rental.expenses,
          repairsAndMaintenance: { amount: proposed(0), source: "agent-statement" as const },
          capitalWorks: { amount: proposed(1_500), source: "qs-schedule" as const },
        },
      },
    };
    reclassifyRepairs.mockResolvedValue({ ok: true, model: reclassified, revision: 2 });

    render(
      <ReviewSections
        returnId="ret1"
        initialModel={withRepairs}
        initialRevision={1}
        documentsByDocId={{}}
      />,
    );

    expect(continueButton().disabled).toBe(true);
    expect(screen.getByText(/confirm this is a repair/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Capital" }));
    await waitFor(() => expect(reclassifyRepairs).toHaveBeenCalledWith("ret1", 1));
    // The repairs-gate row is gone once resolved — its amount moved to capital works.
    await waitFor(() => expect(screen.queryByText(/confirm this is a repair/i)).toBeNull());
  });

  it("picking a mismatch calls resolveMismatch and removes that entry", async () => {
    const model = readyModel();
    const modelWithScratch = {
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
    const resolved = {
      ...model,
      income: { ...model.income, governmentAllowances: proposed(1_000) },
      __t16Extraction: { extracted: [], pendingReconciliation: [] },
    };
    resolveMismatch.mockResolvedValue({ ok: true, model: resolved, revision: 2 });

    render(
      <ReviewSections
        returnId="ret1"
        initialModel={modelWithScratch}
        initialRevision={1}
        documentsByDocId={{}}
      />,
    );

    expect(screen.getByText(/sources disagree/i)).toBeTruthy();
    const useButton = screen.getByRole("button", { name: /^use \$1,000$/i });
    fireEvent.click(useButton);

    await waitFor(() =>
      expect(resolveMismatch).toHaveBeenCalledWith("ret1", 1, "income.governmentAllowances", 0),
    );
    await waitFor(() => expect(screen.queryByText(/sources disagree/i)).toBeNull());
  });

  it("enables Continue once every gate is settled, and calls continueToQuestions", async () => {
    const model = readyModel();
    render(
      <ReviewSections
        returnId="ret1"
        initialModel={model}
        initialRevision={1}
        documentsByDocId={{}}
      />,
    );

    expect(continueButton().disabled).toBe(false);

    continueToQuestions.mockResolvedValue({ ok: true });
    fireEvent.click(continueButton());
    await waitFor(() => expect(continueToQuestions).toHaveBeenCalledWith("ret1", 1));
  });
});
