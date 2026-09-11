import { documentOrigin, createEmptyReturnModel } from "@aus-tax-lodge/model";
import { describe, expect, it } from "vitest";

import { applyFigureToModel, expectedValueKind, isKnownModelPath } from "../src/model-paths";

const ORIGIN = documentOrigin("doc-1", 1, "snippet text", "high");

describe("expectedValueKind / isKnownModelPath", () => {
  it("knows the array-typed income paths", () => {
    expect(expectedValueKind("income.salaryWages[0].grossSalaryWages")).toBe("number");
    expect(expectedValueKind("income.salaryWages[2].payerName")).toBe("string");
    expect(expectedValueKind("income.interestAccounts[0].institution")).toBe("string");
    expect(expectedValueKind("income.dividends[1].frankingCredits")).toBe("number");
  });

  it("knows the scalar and substantiated-deduction paths", () => {
    expect(expectedValueKind("income.governmentAllowances")).toBe("number");
    expect(expectedValueKind("privateHealth.premiumsEligibleForRebate")).toBe("number");
    expect(expectedValueKind("deductions.giftsAndDonations.amount")).toBe("number");
    expect(expectedValueKind("deductions.giftsAndDonations.substantiationRef")).toBe("string");
    expect(expectedValueKind("deductions.workFromHome.hours")).toBe("number");
  });

  it("returns null for an unknown path", () => {
    expect(expectedValueKind("income.salaryWages[0].nonsense")).toBeNull();
    expect(isKnownModelPath("rental.grossRent")).toBe(false);
  });

  it("knows the taxpayer identity paths", () => {
    expect(expectedValueKind("taxpayer.fullName")).toBe("string");
    expect(expectedValueKind("taxpayer.dateOfBirth")).toBe("string");
    expect(expectedValueKind("taxpayer.postalAddress.line1")).toBe("string");
    expect(expectedValueKind("taxpayer.postalAddress.suburb")).toBe("string");
    expect(expectedValueKind("taxpayer.postalAddress.state")).toBe("string");
    expect(expectedValueKind("taxpayer.postalAddress.postcode")).toBe("string");
  });

  it("NEVER treats the TFN or bank/refund details as a known path (PRD FR-17)", () => {
    expect(expectedValueKind("taxpayer.taxFileNumber")).toBeNull();
    expect(expectedValueKind("taxpayer.refundAccount")).toBeNull();
    expect(expectedValueKind("taxpayer.refundAccount.bsb")).toBeNull();
    expect(isKnownModelPath("taxpayer.taxFileNumber")).toBe(false);
  });
});

describe("applyFigureToModel", () => {
  it("proposes a scalar field", () => {
    const model = applyFigureToModel(
      createEmptyReturnModel(),
      "income.governmentAllowances",
      1_200,
      ORIGIN,
    );
    expect(model.income.governmentAllowances).toMatchObject({ value: 1_200, status: "proposed" });
  });

  it("creates a new array entry when the index doesn't exist yet", () => {
    const model = applyFigureToModel(
      createEmptyReturnModel(),
      "income.salaryWages[0].grossSalaryWages",
      90_000,
      ORIGIN,
    );
    expect(model.income.salaryWages).toHaveLength(1);
    expect(model.income.salaryWages[0]?.grossSalaryWages).toMatchObject({
      value: 90_000,
      status: "proposed",
      origin: ORIGIN,
    });
    // Untouched fields on the auto-created entry stay unset.
    expect(model.income.salaryWages[0]?.payerName.status).toBe("unset");
  });

  it("pads intermediate array entries when a higher index arrives first", () => {
    const model = applyFigureToModel(
      createEmptyReturnModel(),
      "income.dividends[1].company",
      "ASX Co",
      ORIGIN,
    );
    expect(model.income.dividends).toHaveLength(2);
    expect(model.income.dividends[0]?.company.status).toBe("unset");
    expect(model.income.dividends[1]?.company).toMatchObject({
      value: "ASX Co",
      status: "proposed",
    });
  });

  it("updates an existing array entry in place without touching its siblings", () => {
    let model = applyFigureToModel(
      createEmptyReturnModel(),
      "income.interestAccounts[0].institution",
      "Big Bank",
      ORIGIN,
    );
    model = applyFigureToModel(model, "income.interestAccounts[0].grossInterest", 400, ORIGIN);
    expect(model.income.interestAccounts).toHaveLength(1);
    expect(model.income.interestAccounts[0]).toMatchObject({
      institution: { value: "Big Bank" },
      grossInterest: { value: 400 },
    });
  });

  it("proposes a substantiated-deduction field", () => {
    const model = applyFigureToModel(
      createEmptyReturnModel(),
      "deductions.giftsAndDonations.amount",
      250,
      ORIGIN,
    );
    expect(model.deductions.giftsAndDonations.amount).toMatchObject({
      value: 250,
      status: "proposed",
    });
  });

  it("proposes the working-from-home hours field", () => {
    const model = applyFigureToModel(
      createEmptyReturnModel(),
      "deductions.workFromHome.hours",
      900,
      ORIGIN,
    );
    expect(model.deductions.workFromHome.hours).toMatchObject({ value: 900, status: "proposed" });
  });

  it("proposes taxpayer identity scalars", () => {
    let model = applyFigureToModel(
      createEmptyReturnModel(),
      "taxpayer.fullName",
      "Chuqi Li",
      ORIGIN,
    );
    model = applyFigureToModel(model, "taxpayer.dateOfBirth", "1989-08-17", ORIGIN);
    expect(model.taxpayer.fullName).toMatchObject({ value: "Chuqi Li", status: "proposed" });
    expect(model.taxpayer.dateOfBirth).toMatchObject({ value: "1989-08-17", status: "proposed" });
  });

  it("merges taxpayer.postalAddress.* parts onto one Provenanced<PostalAddress> as they arrive", () => {
    let model = applyFigureToModel(
      createEmptyReturnModel(),
      "taxpayer.postalAddress.line1",
      "PO BOX 156",
      ORIGIN,
    );
    model = applyFigureToModel(model, "taxpayer.postalAddress.suburb", "EPPING", ORIGIN);
    model = applyFigureToModel(model, "taxpayer.postalAddress.state", "NSW", ORIGIN);
    model = applyFigureToModel(model, "taxpayer.postalAddress.postcode", "2121", ORIGIN);
    expect(model.taxpayer.postalAddress).toMatchObject({
      status: "proposed",
      value: {
        line1: "PO BOX 156",
        line2: "",
        suburb: "EPPING",
        state: "NSW",
        postcode: "2121",
        country: "Australia",
      },
    });
  });

  it("throws for an unknown modelPath", () => {
    expect(() =>
      applyFigureToModel(createEmptyReturnModel(), "rental.grossRent", 1_000, ORIGIN),
    ).toThrow(/unknown modelPath/);
  });

  it("throws when the value type doesn't match what the path expects", () => {
    expect(() =>
      applyFigureToModel(
        createEmptyReturnModel(),
        "income.governmentAllowances",
        "not a number",
        ORIGIN,
      ),
    ).toThrow(/expects a number/);
  });
});
