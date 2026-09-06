import {
  answer,
  isReadyForEstimate,
  RENTAL_EXPENSE_KEYS,
  unsetField,
  type RentalScopeGateAnswer,
} from "@aus-tax-lodge/model";
import { describe, expect, it } from "vitest";

import {
  applyQuestionsToModel,
  describeInterestAccount,
  detailsHoldsStudyLoan,
  detailsResidentFullYear,
  initialQuestionsFormValues,
  parseQuestionsFormData,
  rentalAddressLabel,
  residencyDisagrees,
  studyLoanDisagrees,
  unsettledJointAccounts,
  validateQuestionsForm,
  type QuestionsFormValues,
} from "../lib/questions/form";
import { answered, confirmedField, notApplicable, readyModel } from "./review-fixtures";

function withInterestAccounts(
  model: ReturnType<typeof readyModel>,
  accounts: ReturnType<typeof readyModel>["income"]["interestAccounts"],
) {
  return { ...model, income: { ...model.income, interestAccounts: accounts } };
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

const BASE_VALUES: QuestionsFormValues = {
  residencyFullYear: "yes",
  studyLoanHeld: "no",
  privateCoverDates: "full",
  privateCoverDays: "",
  wfhDoubleClaimed: "no",
  jointAccounts: [],
  rentalSoleOwnershipAllYear: "yes",
  rentalBoughtOrSold: "no",
};

describe("describeInterestAccount / unsettledJointAccounts", () => {
  it("labels an account by institution and description", () => {
    expect(describeInterestAccount(jointAccount("a1", 50))).toBe("ING — Savings");
  });

  it("returns only accounts whose ownership share isn't settled", () => {
    const model = withInterestAccounts(readyModel(), [
      jointAccount("settled", 100),
      jointAccount("unsettled", null),
    ]);
    const rows = unsettledJointAccounts(model);
    expect(rows).toEqual([{ accountId: "unsettled", label: "ING — Savings" }]);
  });
});

describe("detailsResidentFullYear / detailsHoldsStudyLoan / rentalAddressLabel", () => {
  it("reads the details-step residency and study-loan flags", () => {
    const model = readyModel();
    expect(detailsResidentFullYear(model)).toBe(true);
    expect(detailsHoldsStudyLoan(model)).toBe(false);
  });

  it("falls back to a generic label when the rental address isn't set", () => {
    expect(rentalAddressLabel(readyModel())).toBe("your rental property");
  });
});

describe("residencyDisagrees / studyLoanDisagrees", () => {
  it("flags a disagreement only when the context field is settled and differs", () => {
    const model = readyModel();
    expect(residencyDisagrees(model, true)).toBe(false);
    expect(residencyDisagrees(model, false)).toBe(true);
    expect(studyLoanDisagrees(model, false)).toBe(false);
    expect(studyLoanDisagrees(model, true)).toBe(true);
  });

  it("never flags a disagreement when the context field is unset", () => {
    const model = {
      ...readyModel(),
      context: { ...readyModel().context, residency: unsetField<"resident-full-year">() },
    };
    expect(residencyDisagrees(model, false)).toBe(false);
  });
});

describe("initialQuestionsFormValues", () => {
  it("derives residency/study-loan defaults from context when the questionnaire hasn't answered yet", () => {
    const model = readyModel();
    const fresh = {
      ...model,
      questionnaire: {
        ...model.questionnaire,
        residencyFullYear: unsetField<boolean>(),
        studyLoanHeld: unsetField<boolean>(),
      },
    };
    const values = initialQuestionsFormValues(fresh);
    expect(values.residencyFullYear).toBe("yes");
    expect(values.studyLoanHeld).toBe("no");
  });

  it("classifies private-cover days into full/part/none", () => {
    const model = readyModel();
    const full = initialQuestionsFormValues({
      ...model,
      context: { ...model.context, privateHospitalCoverDays: confirmedField(365) },
    });
    expect(full.privateCoverDates).toBe("full");

    const part = initialQuestionsFormValues({
      ...model,
      context: { ...model.context, privateHospitalCoverDays: confirmedField(200) },
    });
    expect(part.privateCoverDates).toBe("part");
    expect(part.privateCoverDays).toBe("200");

    const none = initialQuestionsFormValues({
      ...model,
      context: { ...model.context, privateHospitalCoverDays: confirmedField(0) },
    });
    expect(none.privateCoverDates).toBe("none");
  });

  it("defaults the WFH double-claim question to 'no' (not double-claimed) when unanswered", () => {
    const model = readyModel();
    const values = initialQuestionsFormValues({
      ...model,
      questionnaire: { ...model.questionnaire, wfhHoursNotDoubleClaimed: unsetField<boolean>() },
    });
    expect(values.wfhDoubleClaimed).toBe("no");
  });

  it("lists one row per unsettled joint interest account", () => {
    const model = withInterestAccounts(readyModel(), [jointAccount("j1", null)]);
    const values = initialQuestionsFormValues(model);
    expect(values.jointAccounts).toEqual([{ accountId: "j1", sharePercent: "" }]);
  });
});

describe("parseQuestionsFormData", () => {
  it("reads every question plus the joint-account rows named for the given ids", () => {
    const fd = new FormData();
    fd.set("residencyFullYear", "no");
    fd.set("studyLoanHeld", "yes");
    fd.set("privateCoverDates", "part");
    fd.set("privateCoverDays", "200");
    fd.set("wfhDoubleClaimed", "yes");
    fd.set("jointShare.j1", "50");
    fd.set("rentalSoleOwnershipAllYear", "no");
    fd.set("rentalBoughtOrSold", "yes");

    const values = parseQuestionsFormData(fd, ["j1"]);
    expect(values).toEqual({
      residencyFullYear: "no",
      residencyDisagreement: undefined,
      studyLoanHeld: "yes",
      studyLoanDisagreement: undefined,
      privateCoverDates: "part",
      privateCoverDays: "200",
      wfhDoubleClaimed: "yes",
      jointAccounts: [{ accountId: "j1", sharePercent: "50" }],
      rentalSoleOwnershipAllYear: "no",
      rentalBoughtOrSold: "yes",
    });
  });
});

describe("validateQuestionsForm", () => {
  it("requires a disagreement resolution only when one is present", () => {
    const noDisagreement = validateQuestionsForm(BASE_VALUES, {
      residencyDisagreementPresent: false,
      studyLoanDisagreementPresent: false,
    });
    expect(noDisagreement.residencyDisagreement).toBeUndefined();

    const withDisagreement = validateQuestionsForm(BASE_VALUES, {
      residencyDisagreementPresent: true,
      studyLoanDisagreementPresent: true,
    });
    expect(withDisagreement.residencyDisagreement).toMatch(/choose which is correct/i);
    expect(withDisagreement.studyLoanDisagreement).toMatch(/choose which is correct/i);
  });

  it("requires a valid day count only when the choice isn't 'full'", () => {
    const full = validateQuestionsForm(
      { ...BASE_VALUES, privateCoverDates: "full", privateCoverDays: "" },
      { residencyDisagreementPresent: false, studyLoanDisagreementPresent: false },
    );
    expect(full.privateCoverDays).toBeUndefined();

    const part = validateQuestionsForm(
      { ...BASE_VALUES, privateCoverDates: "part", privateCoverDays: "" },
      { residencyDisagreementPresent: false, studyLoanDisagreementPresent: false },
    );
    expect(part.privateCoverDays).toMatch(/required/i);
  });

  it("validates each joint-account share is 0-100", () => {
    const result = validateQuestionsForm(
      { ...BASE_VALUES, jointAccounts: [{ accountId: "j1", sharePercent: "150" }] },
      { residencyDisagreementPresent: false, studyLoanDisagreementPresent: false },
    );
    expect(result.jointAccounts?.j1).toMatch(/between 0 and 100/i);
  });
});

describe("applyQuestionsToModel", () => {
  it("answers every questionnaire field as confirmed, user-entered", () => {
    const model = readyModel();
    const next = applyQuestionsToModel(model, {
      ...BASE_VALUES,
      residencyFullYear: "yes",
      studyLoanHeld: "no",
      privateCoverDates: "full",
      wfhDoubleClaimed: "no",
    });

    expect(next.questionnaire.residencyFullYear).toMatchObject({
      value: true,
      status: "confirmed",
      origin: { kind: "user-answer" },
    });
    expect(next.questionnaire.studyLoanHeld.value).toBe(false);
    expect(next.questionnaire.wfhHoursNotDoubleClaimed.value).toBe(true);
    expect(next.context.privateHospitalCoverDays.value).toBe(365);
    expect(next.questionnaire.privateCoverDatesConfirmed).toMatchObject({
      value: true,
      status: "confirmed",
    });
  });

  it("leaves context.residency untouched when the answer agrees", () => {
    const model = readyModel();
    const next = applyQuestionsToModel(model, { ...BASE_VALUES, residencyFullYear: "yes" });
    expect(next.context.residency).toBe(model.context.residency);
  });

  it("on a residency disagreement resolved 'use-answer', overwrites context.residency", () => {
    const model = readyModel(); // context.residency = resident-full-year
    const next = applyQuestionsToModel(model, {
      ...BASE_VALUES,
      residencyFullYear: "no",
      residencyDisagreement: "use-answer",
    });
    expect(next.context.residency).toMatchObject({ value: "non-resident", status: "confirmed" });
    expect(next.questionnaire.residencyFullYear.value).toBe(false);
  });

  it("on a residency disagreement resolved 'keep-details', reverts the questionnaire answer to match context", () => {
    const model = readyModel();
    const next = applyQuestionsToModel(model, {
      ...BASE_VALUES,
      residencyFullYear: "no",
      residencyDisagreement: "keep-details",
    });
    expect(next.context.residency).toBe(model.context.residency);
    expect(next.questionnaire.residencyFullYear.value).toBe(true);
  });

  it("on a study-loan disagreement resolved 'use-answer', overwrites context.holdsStudyLoan", () => {
    const model = readyModel(); // context.holdsStudyLoan = false
    const next = applyQuestionsToModel(model, {
      ...BASE_VALUES,
      studyLoanHeld: "yes",
      studyLoanDisagreement: "use-answer",
    });
    expect(next.context.holdsStudyLoan).toMatchObject({ value: true, status: "confirmed" });
    expect(next.questionnaire.studyLoanHeld.value).toBe(true);
  });

  it("sets each joint account's ownership share and marks the synthetic row provided", () => {
    const model = withInterestAccounts(readyModel(), [jointAccount("j1", null)]);
    const next = applyQuestionsToModel(model, {
      ...BASE_VALUES,
      jointAccounts: [{ accountId: "j1", sharePercent: "50" }],
    });
    expect(next.income.interestAccounts[0]!.ownershipSharePercent).toMatchObject({
      value: 50,
      status: "confirmed",
      origin: { kind: "user-answer" },
    });
    expect(next.questionnaire.jointAccountSharesProvided.value).toBe(true);
  });

  it("assembles the rental scope gate only when the rental is present", () => {
    const model = readyModel();
    const withoutRental = applyQuestionsToModel(model, {
      ...BASE_VALUES,
      rentalSoleOwnershipAllYear: "no",
      rentalBoughtOrSold: "yes",
    });
    expect(withoutRental.questionnaire.rentalScopeGate).toBe(model.questionnaire.rentalScopeGate);

    const withRental = {
      ...model,
      rental: { ...model.rental, present: true },
    };
    const next = applyQuestionsToModel(withRental, {
      ...BASE_VALUES,
      rentalSoleOwnershipAllYear: "no",
      rentalBoughtOrSold: "yes",
    });
    const gate = next.questionnaire.rentalScopeGate.value as RentalScopeGateAnswer;
    expect(gate).toEqual({
      solelyOwned: false,
      rentedOrAvailableAllYear: false,
      noPrivateUse: false,
      notBoughtOrSoldThisYear: false,
    });
    expect(next.questionnaire.rentalScopeGate.status).toBe("confirmed");
  });

  it("assembles an in-scope rental gate from 'yes to all' / 'no sale'", () => {
    const model = { ...readyModel(), rental: { ...readyModel().rental, present: true } };
    const next = applyQuestionsToModel(model, {
      ...BASE_VALUES,
      rentalSoleOwnershipAllYear: "yes",
      rentalBoughtOrSold: "no",
    });
    expect(next.questionnaire.rentalScopeGate.value).toEqual({
      solelyOwned: true,
      rentedOrAvailableAllYear: true,
      noPrivateUse: true,
      notBoughtOrSoldThisYear: true,
    });
  });
});

// Sanity check the fixtures helper re-exported by review-fixtures is usable here too.
describe("answer() sanity", () => {
  it("answered() is confirmed with a user-answer origin", () => {
    expect(answered(true)).toMatchObject({
      value: true,
      status: "confirmed",
      origin: { kind: "user-answer" },
    });
    expect(answer(unsetField<boolean>(), false).status).toBe("confirmed");
  });
});

describe("isReadyForEstimate after a completed questionnaire (closes T17's open loop)", () => {
  it("is true for a return with no rental once every question is answered", () => {
    // readyModel() already has every non-questionnaire label settled; applying
    // this step's own answers on top must be enough to flip the gate.
    const model = readyModel();
    const next = applyQuestionsToModel(model, {
      ...BASE_VALUES,
      residencyFullYear: "yes",
      studyLoanHeld: "no",
      privateCoverDates: "full",
      wfhDoubleClaimed: "no",
    });
    expect(isReadyForEstimate(next)).toBe(true);
  });

  it("is true for a fully-populated rental once T18's scope gate is the last thing answered", () => {
    // Everything else a rental return needs (T7's job) is already confirmed
    // here — the scope gate is the one row this step is responsible for.
    const base = readyModel();
    const expenses = Object.fromEntries(
      RENTAL_EXPENSE_KEYS.map((key) => [
        key,
        { amount: confirmedField(0), source: "agent-statement" as const },
      ]),
    ) as ReturnType<typeof readyModel>["rental"]["expenses"];
    const model = {
      ...base,
      rental: {
        ...base.rental,
        present: true,
        soleOwnership: confirmedField(true),
        rentedOrAvailableAllYear: confirmedField(true),
        noPrivateUse: confirmedField(true),
        grossRent: confirmedField(20_000),
        otherRentalIncome: confirmedField(0),
        expenses,
        netRentalResult: confirmedField(20_000),
      },
    };
    expect(isReadyForEstimate(model)).toBe(false); // scope gate not yet answered

    const next = applyQuestionsToModel(model, {
      ...BASE_VALUES,
      rentalSoleOwnershipAllYear: "yes",
      rentalBoughtOrSold: "no",
    });
    expect(isReadyForEstimate(next)).toBe(true);
  });

  it("is still false until the rental scope gate is answered", () => {
    const model = { ...readyModel(), rental: { ...readyModel().rental, present: true } };
    expect(isReadyForEstimate(model)).toBe(false);
  });
});
