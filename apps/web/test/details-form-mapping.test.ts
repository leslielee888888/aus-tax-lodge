import { answer, createEmptyReturnModel } from "@aus-tax-lodge/model";
import { describe, expect, it } from "vitest";

import {
  applyDetailsToModel,
  detailsFormValuesFromModel,
  emptyDetailsFormValues,
  validateDetailsForm,
  type DetailsFormValues,
} from "../lib/details/form";

function validValues(overrides: Partial<DetailsFormValues> = {}): DetailsFormValues {
  return {
    ...emptyDetailsFormValues(),
    fullName: "Priya Sharma",
    dob: "14/03/1990",
    line1: "1 Test St",
    line2: "",
    suburb: "Sydney",
    state: "NSW",
    postcode: "2000",
    tfn: "123456782",
    residency: "resident-full-year",
    bsb: "063018",
    accountNumber: "12345678",
    accountName: "Priya Sharma",
    studyLoan: "yes",
    privateCoverDays: "365",
    dependentChildren: "0",
    ...overrides,
  };
}

describe("validateDetailsForm", () => {
  it("passes a fully valid, spouse-less form", () => {
    expect(validateDetailsForm(validValues())).toEqual({});
  });

  it("flags a missing required field", () => {
    const errors = validateDetailsForm(validValues({ fullName: "" }));
    expect(errors.fullName).toMatch(/required/i);
  });

  it("only requires spouse fields when hasSpouse is set", () => {
    expect(validateDetailsForm(validValues({ hasSpouse: false }))).toEqual({});

    const errors = validateDetailsForm(validValues({ hasSpouse: true }));
    expect(errors.spouseName).toMatch(/required/i);
    expect(errors.spouseDob).toMatch(/required/i);
    expect(errors.spouseIncome).toMatch(/required/i);
    expect(errors.spouseCoverDays).toMatch(/required/i);
  });
});

describe("detailsFormValuesFromModel", () => {
  it("returns sensible defaults for a brand-new return", () => {
    const values = detailsFormValuesFromModel(createEmptyReturnModel());
    expect(values.fullName).toBe("");
    expect(values.residency).toBe("resident-full-year");
    expect(values.studyLoan).toBe("no");
    expect(values.dependentChildren).toBe("0");
    expect(values.hasSpouse).toBe(false);
  });

  it("pre-fills every field from a previously-saved model (the resuming state)", () => {
    const empty = createEmptyReturnModel();
    const model = applyDetailsToModel(
      empty,
      validValues({
        hasSpouse: true,
        spouseName: "Alex Sharma",
        spouseDob: "02/09/1988",
        spouseIncome: "78400",
        spouseCoverDays: "365",
      }),
    );

    const values = detailsFormValuesFromModel(model);
    expect(values.fullName).toBe("Priya Sharma");
    expect(values.dob).toBe("14/03/1990");
    expect(values.line1).toBe("1 Test St");
    expect(values.suburb).toBe("Sydney");
    expect(values.postcode).toBe("2000");
    expect(values.tfn).toBe("123456782");
    expect(values.bsb).toBe("063-018"); // normalized on the way in
    expect(values.accountNumber).toBe("12345678");
    expect(values.studyLoan).toBe("yes");
    expect(values.privateCoverDays).toBe("365");
    expect(values.hasSpouse).toBe(true);
    expect(values.spouseName).toBe("Alex Sharma");
    expect(values.spouseDob).toBe("02/09/1988");
    expect(values.spouseIncome).toBe("78400");
    expect(values.spouseCoverDays).toBe("365");
  });
});

describe("applyDetailsToModel (PRD FR-1, FR-7)", () => {
  it("lands every touched field as confirmed with a user-answer origin", () => {
    const model = applyDetailsToModel(createEmptyReturnModel(), validValues());

    expect(model.taxpayer.fullName).toEqual({
      value: "Priya Sharma",
      status: "confirmed",
      origin: { kind: "user-answer" },
      proposedValue: "Priya Sharma",
      edits: [],
    });
    expect(model.taxpayer.dateOfBirth.value).toBe("1990-03-14");
    expect(model.context.residency.status).toBe("confirmed");
    expect(model.context.residency.value).toBe("resident-full-year");
    expect(model.context.holdsStudyLoan.value).toBe(true);
    expect(model.context.dependentChildren.value).toBe(0);
  });

  it("normalizes the BSB and stores the full TFN, not a masked version", () => {
    const model = applyDetailsToModel(
      createEmptyReturnModel(),
      validValues({ bsb: "063018", tfn: "123456782" }),
    );
    expect(model.taxpayer.refundAccount.value?.bsb).toBe("063-018");
    expect(model.taxpayer.taxFileNumber.value).toBe("123456782");
  });

  it("records spouse status 'none' and clears spouse fields when the toggle is off", () => {
    const model = applyDetailsToModel(createEmptyReturnModel(), validValues({ hasSpouse: false }));
    expect(model.context.spouse.status.value).toBe("none");
    expect(model.context.spouse.name.value).toBeNull();
    expect(model.context.spouse.estimatedTaxableIncome.value).toBeNull();
  });

  it("records spouse details, marked confirmed, when the toggle is on", () => {
    const model = applyDetailsToModel(
      createEmptyReturnModel(),
      validValues({
        hasSpouse: true,
        spouseName: "Alex Sharma",
        spouseDob: "02/09/1988",
        spouseIncome: "78400",
        spouseCoverDays: "365",
      }),
    );
    expect(model.context.spouse.status.value).toBe("had-spouse");
    expect(model.context.spouse.name).toMatchObject({ value: "Alex Sharma", status: "confirmed" });
    expect(model.context.spouse.dateOfBirth.value).toBe("1988-09-02");
    expect(model.context.spouse.estimatedTaxableIncome).toMatchObject({
      value: 78400,
      status: "confirmed",
    });
    expect(model.context.spouse.privateHospitalCoverDays.value).toBe(365);
  });

  it("leaves every other section of the model untouched", () => {
    const base = createEmptyReturnModel();
    const seeded = {
      ...base,
      income: {
        ...base.income,
        governmentAllowances: answer(base.income.governmentAllowances, 500),
      },
    };
    const model = applyDetailsToModel(seeded, validValues());
    expect(model.income).toBe(seeded.income);
    expect(model.rental).toBe(seeded.rental);
    expect(model.deductions).toBe(seeded.deductions);
    expect(model.privateHealth).toBe(seeded.privateHealth);
    expect(model.questionnaire).toBe(seeded.questionnaire);
  });
});
