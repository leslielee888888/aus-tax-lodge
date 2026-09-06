// @vitest-environment jsdom
import { unsetField } from "@aus-tax-lodge/model";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { QuestionsForm } from "../app/returns/[returnId]/questions/QuestionsForm";
import { QuestionsReadOnly } from "../app/returns/[returnId]/questions/QuestionsReadOnly";
import {
  detailsHoldsStudyLoan,
  detailsResidentFullYear,
  initialQuestionsFormValues,
  rentalAddressLabel,
  unsettledJointAccounts,
} from "../lib/questions/form";
import { confirmedField, notApplicable, readyModel } from "./review-fixtures";

afterEach(cleanup);

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

function renderForm(model: ReturnType<typeof readyModel>) {
  return render(
    <QuestionsForm
      returnId="ret1"
      expectedRevision={1}
      initialValues={initialQuestionsFormValues(model)}
      jointAccounts={unsettledJointAccounts(model)}
      rentalPresent={model.rental.present}
      rentalAddressLabel={rentalAddressLabel(model)}
      detailsResidentFullYear={detailsResidentFullYear(model)}
      detailsHoldsStudyLoan={detailsHoldsStudyLoan(model)}
    />,
  );
}

describe("QuestionsForm — structured, not chat (PRD FR-6)", () => {
  it("renders every applicable question as a radio/select/number control, no rental", () => {
    renderForm(readyModel());

    expect(
      screen.getByText(/Were you an Australian resident for tax purposes for the whole year\?/i),
    ).toBeTruthy();
    expect(screen.getByText(/Did you hold a HELP or study\/training support loan/i)).toBeTruthy();
    expect(
      screen.getByText(
        /Which dates did you hold an appropriate level of private hospital cover\?/i,
      ),
    ).toBeTruthy();
    expect(screen.getByText(/also get claimed as a separate expense/i)).toBeTruthy();

    // No free-form text areas anywhere on the screen — every answer is a
    // structured radio or a bounded number input.
    expect(document.querySelectorAll("textarea")).toHaveLength(0);
    expect(document.querySelectorAll('input[type="radio"]').length).toBeGreaterThan(0);
  });

  it("does not render the rental scope-gate questions when there is no rental", () => {
    renderForm(readyModel());
    expect(screen.queryByText(/owned only by you, rented or genuinely available/i)).toBeNull();
    expect(screen.queryByText(/Did you buy or sell/i)).toBeNull();
  });

  it("renders the rental scope-gate questions when a rental is present", () => {
    const model = { ...readyModel(), rental: { ...readyModel().rental, present: true } };
    renderForm(model);
    expect(screen.getByText(/owned only by you, rented or genuinely available/i)).toBeTruthy();
    expect(screen.getByText(/Did you buy or sell/i)).toBeTruthy();
  });

  it("renders one row per unsettled joint interest account, and none for a settled one", () => {
    const model = {
      ...readyModel(),
      income: {
        ...readyModel().income,
        interestAccounts: [jointAccount("settled", 100), jointAccount("joint1", null)],
      },
    };
    renderForm(model);
    const shareInputs = document.querySelectorAll('input[name^="jointShare."]');
    expect(shareInputs).toHaveLength(1);
    expect(shareInputs[0]!.getAttribute("name")).toBe("jointShare.joint1");
    expect(
      screen.getByText(/What share of the interest from ING — Savings is yours\?/i),
    ).toBeTruthy();
  });

  it("surfaces a residency disagreement rather than silently resolving it", () => {
    // context.residency is resident-full-year (see readyModel); flip the radio to "No".
    renderForm(readyModel());

    expect(screen.queryByText(/disagrees with what you entered on the details step/i)).toBeNull();

    fireEvent.click(screen.getByText("No / part of the year"));

    expect(screen.getByText(/disagrees with what you entered on the details step/i)).toBeTruthy();
    // Submitting is blocked until the user says which side is right.
    const submit = screen.getByRole("button", { name: /see your estimate/i }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.click(screen.getByText(/This answer: not a resident all year/i));
    expect(submit.disabled).toBe(false);
  });
});

describe("QuestionsReadOnly (PRD FR-16)", () => {
  it("renders values only — no inputs, selects or buttons", () => {
    const { container } = render(<QuestionsReadOnly model={readyModel()} targetYear="2024-25" />);
    expect(container.querySelectorAll("input, select, textarea, button")).toHaveLength(0);
    expect(screen.getByText(/Lodged — 2024–25, read-only/)).toBeTruthy();
  });
});
