/**
 * #88 / T15 — the new interview allow-list paths that close the "return can
 * never complete" blocker: taxpayer identity (name / DOB / postal address),
 * per-category deduction "not claiming" / "records held", the two rate
 * fields, and rental property identity. Mirrors the style of
 * `rental-fields.test.ts` (T6).
 *
 * The TFN and refund bank account are deliberately tested for the OPPOSITE —
 * they must NEVER be reachable through this allow-list (PRD FR-17); they are
 * collected only through the secure `identity` card / `provideIdentity`.
 */
import { createEmptyReturnModel, isSettled, type ReturnModel } from "@aus-tax-lodge/model";
import { describe, expect, it } from "vitest";

import {
  applyInterviewField,
  buildNextTurnPrompt,
  InterviewFieldError,
  isInterviewFieldPath,
} from "../../lib/interview";
import { emptyConversation } from "../../lib/conversation";

function apply(
  model: ReturnModel,
  path: string,
  value: unknown,
  kind: "string" | "number" | "boolean" | "date",
) {
  return applyInterviewField(model, {
    path,
    value: value as string | number | boolean | null,
    kind,
  });
}

describe("interview field allow-list — taxpayer identity (PRD FR-1, #88 / T15)", () => {
  it("lists fullName, dateOfBirth and every postalAddress sub-path", () => {
    for (const path of [
      "taxpayer.fullName",
      "taxpayer.dateOfBirth",
      "taxpayer.postalAddress.line1",
      "taxpayer.postalAddress.line2",
      "taxpayer.postalAddress.suburb",
      "taxpayer.postalAddress.state",
      "taxpayer.postalAddress.postcode",
    ]) {
      expect(isInterviewFieldPath(path)).toBe(true);
    }
  });

  it("NEVER lists the TFN or refund account — those are card-only (PRD FR-17)", () => {
    expect(isInterviewFieldPath("taxpayer.taxFileNumber")).toBe(false);
    expect(isInterviewFieldPath("taxpayer.refundAccount")).toBe(false);
    expect(() =>
      apply(createEmptyReturnModel(), "taxpayer.taxFileNumber", "123456782", "string"),
    ).toThrow(InterviewFieldError);
  });

  it("settles fullName and dateOfBirth as the user's own answer", () => {
    let model = createEmptyReturnModel();
    model = apply(model, "taxpayer.fullName", "Priya Example", "string");
    model = apply(model, "taxpayer.dateOfBirth", "1985-03-02", "date");
    expect(model.taxpayer.fullName).toMatchObject({ value: "Priya Example", status: "confirmed" });
    expect(model.taxpayer.dateOfBirth).toMatchObject({ value: "1985-03-02", status: "confirmed" });
  });

  it("merges postalAddress sub-answers, staying unsettled until the required parts are in", () => {
    let model = createEmptyReturnModel();
    model = apply(model, "taxpayer.postalAddress.line1", "1 Test St", "string");
    expect(isSettled(model.taxpayer.postalAddress)).toBe(false);
    expect(model.taxpayer.postalAddress.status).toBe("proposed");

    model = apply(model, "taxpayer.postalAddress.suburb", "Sydney", "string");
    model = apply(model, "taxpayer.postalAddress.state", "NSW", "string");
    model = apply(model, "taxpayer.postalAddress.postcode", "2000", "string");
    expect(isSettled(model.taxpayer.postalAddress)).toBe(true);
    expect(model.taxpayer.postalAddress).toMatchObject({
      status: "confirmed",
      value: {
        line1: "1 Test St",
        line2: "",
        suburb: "Sydney",
        state: "NSW",
        postcode: "2000",
        country: "Australia",
      },
    });
  });
});

describe("interview field allow-list — deductions not-claimed / records-held (PRD FR-5, #88 / T15)", () => {
  it("lists notClaimed and recordsHeld for every deduction category", () => {
    for (const key of [
      "workRelatedCar",
      "workRelatedTravel",
      "workRelatedClothing",
      "selfEducation",
      "otherWorkRelated",
      "workFromHome",
      "giftsAndDonations",
      "costOfManagingTaxAffairs",
    ]) {
      expect(isInterviewFieldPath(`deductions.${key}.notClaimed`)).toBe(true);
      expect(isInterviewFieldPath(`deductions.${key}.recordsHeld`)).toBe(true);
    }
    expect(isInterviewFieldPath("deductions.workRelatedCar.ratePerKm")).toBe(true);
    expect(isInterviewFieldPath("deductions.workFromHome.ratePerHour")).toBe(true);
  });

  it("'not claiming' settles amount + substantiationRef nil for a plain category", () => {
    const model = apply(
      createEmptyReturnModel(),
      "deductions.giftsAndDonations.notClaimed",
      true,
      "boolean",
    );
    expect(model.deductions.giftsAndDonations.amount).toMatchObject({
      value: null,
      status: "not-applicable",
    });
    expect(model.deductions.giftsAndDonations.substantiationRef.status).toBe("not-applicable");
  });

  it("'not claiming' the car also settles businessKilometres + ratePerKm nil", () => {
    const model = apply(
      createEmptyReturnModel(),
      "deductions.workRelatedCar.notClaimed",
      true,
      "boolean",
    );
    const car = model.deductions.workRelatedCar;
    expect(car.amount.status).toBe("not-applicable");
    expect(car.substantiationRef.status).toBe("not-applicable");
    expect(car.businessKilometres.status).toBe("not-applicable");
    expect(car.ratePerKm.status).toBe("not-applicable");
  });

  it("'not claiming' working from home also settles hours + ratePerHour nil", () => {
    const model = apply(
      createEmptyReturnModel(),
      "deductions.workFromHome.notClaimed",
      true,
      "boolean",
    );
    const wfh = model.deductions.workFromHome;
    expect(wfh.amount.status).toBe("not-applicable");
    expect(wfh.substantiationRef.status).toBe("not-applicable");
    expect(wfh.hours.status).toBe("not-applicable");
    expect(wfh.ratePerHour.status).toBe("not-applicable");
  });

  it("a 'false' notClaimed is a no-op — the claim is settled by amount / recordsHeld instead", () => {
    const model = createEmptyReturnModel();
    const next = apply(model, "deductions.giftsAndDonations.notClaimed", false, "boolean");
    expect(next).toBe(model);
  });

  it("recordsHeld true settles substantiationRef with the records-held marker", () => {
    let model = apply(
      createEmptyReturnModel(),
      "deductions.giftsAndDonations.amount",
      500,
      "number",
    );
    model = apply(model, "deductions.giftsAndDonations.recordsHeld", true, "boolean");
    expect(model.deductions.giftsAndDonations.substantiationRef).toMatchObject({
      value: "records-held-confirmed-in-interview",
      status: "confirmed",
    });
    expect(model.deductions.giftsAndDonations.unsubstantiated).toBe(false);
  });

  it("recordsHeld false settles substantiationRef with the acknowledgement marker and flags unsubstantiated", () => {
    let model = apply(
      createEmptyReturnModel(),
      "deductions.giftsAndDonations.amount",
      500,
      "number",
    );
    model = apply(model, "deductions.giftsAndDonations.recordsHeld", false, "boolean");
    expect(model.deductions.giftsAndDonations.substantiationRef).toMatchObject({
      value: "user-acknowledges-substantiation-required",
      status: "confirmed",
    });
    expect(model.deductions.giftsAndDonations.unsubstantiated).toBe(true);
  });

  it("recordsHeld throws on a null (no-answer) value — a yes/no is required", () => {
    expect(() =>
      apply(createEmptyReturnModel(), "deductions.giftsAndDonations.recordsHeld", null, "boolean"),
    ).toThrow(InterviewFieldError);
  });

  it("ratePerKm / ratePerHour are settled as the user's stated figure (no statutory constant — see T15 report)", () => {
    let model = apply(
      createEmptyReturnModel(),
      "deductions.workRelatedCar.ratePerKm",
      0.88,
      "number",
    );
    expect(model.deductions.workRelatedCar.ratePerKm).toMatchObject({
      value: 0.88,
      status: "confirmed",
      origin: { kind: "user-answer" },
    });
    model = apply(model, "deductions.workFromHome.ratePerHour", 0.7, "number");
    expect(model.deductions.workFromHome.ratePerHour).toMatchObject({
      value: 0.7,
      status: "confirmed",
    });
  });
});

describe("interview field allow-list — rental property identity (PRD FR-24, #88 / T15)", () => {
  it("lists every rental.property.* path", () => {
    for (const path of [
      "rental.property.addressLine1",
      "rental.property.suburb",
      "rental.property.state",
      "rental.property.postcode",
      "rental.property.firstEarnedIncomeOn",
    ]) {
      expect(isInterviewFieldPath(path)).toBe(true);
    }
  });

  it("settles the property identity fields and marks the rental present", () => {
    let model = createEmptyReturnModel();
    model = apply(model, "rental.property.addressLine1", "10 Landlord Lane", "string");
    model = apply(model, "rental.property.suburb", "Brunswick", "string");
    model = apply(model, "rental.property.state", "VIC", "string");
    model = apply(model, "rental.property.postcode", "3056", "string");
    model = apply(model, "rental.property.firstEarnedIncomeOn", "2019-07-01", "date");

    expect(model.rental.present).toBe(true);
    expect(model.rental.property.addressLine1).toMatchObject({
      value: "10 Landlord Lane",
      status: "confirmed",
    });
    expect(model.rental.property.firstEarnedIncomeOn).toMatchObject({
      value: "2019-07-01",
      status: "confirmed",
    });
  });
});

describe("prompt safety — the TFN and refund account never reach a prompt (PRD FR-17, #88 / T15)", () => {
  it("buildNextTurnPrompt omits the TFN digits and the account number even when both are set", () => {
    let model = createEmptyReturnModel();
    model = {
      ...model,
      taxpayer: {
        ...model.taxpayer,
        fullName: apply(model, "taxpayer.fullName", "Priya Example", "string").taxpayer.fullName,
        taxFileNumber: { ...model.taxpayer.taxFileNumber, value: "123456782", status: "confirmed" },
        refundAccount: {
          ...model.taxpayer.refundAccount,
          value: { bsb: "062-000", accountNumber: "87654321", accountName: "Priya Example" },
          status: "confirmed",
        },
      },
    };
    const prompt = buildNextTurnPrompt(model, emptyConversation());
    expect(prompt).not.toContain("123456782");
    expect(prompt).not.toContain("87654321");
    expect(prompt).not.toContain("062-000");
  });
});
