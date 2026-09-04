import { answer, unsetField, type RentalScopeGateAnswer } from "@aus-tax-lodge/model";
import { describe, expect, it } from "vitest";

import {
  carMethodOutOfScope,
  detectOutOfScope,
  documentsNeedingContentCheck,
  wfhMethodOutOfScope,
  type DocumentContentClassification,
} from "../src/detect";
import {
  cleanRentalReturn,
  cleanSalaryReturn,
  conf,
  type ResidencyStatus,
  withRentalScopeGate,
} from "./fixtures";

describe("detectOutOfScope — clean returns", () => {
  it("returns [] for a clean salary-only return", () => {
    expect(detectOutOfScope({ model: cleanSalaryReturn() })).toEqual([]);
  });

  it("returns [] for a clean return with one compliant solely-owned full-year rental", () => {
    const findings = detectOutOfScope({
      model: cleanRentalReturn(),
      contentFindings: [{ docId: "d1", filename: "agent-statement.pdf", categories: [] }],
    });
    expect(findings).toEqual([]);
  });
});

describe("detectOutOfScope — from answers / model", () => {
  it("flags a co-owned rental from the scope-gate answer, naming the item", () => {
    const model = withRentalScopeGate(cleanRentalReturn(), {
      solelyOwned: false,
      rentedOrAvailableAllYear: true,
      noPrivateUse: true,
      notBoughtOrSoldThisYear: true,
    });
    const findings = detectOutOfScope({ model });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: "rental-co-owned",
      source: "answer",
      item: "Rental property co-owned with another person",
    });
    expect(findings[0]!.detail).toMatch(/registered tax agent|myTax/i);
  });

  it("flags part-year, private-use and sale from the scope gate together", () => {
    const model = withRentalScopeGate(cleanRentalReturn(), {
      solelyOwned: true,
      rentedOrAvailableAllYear: false,
      noPrivateUse: false,
      notBoughtOrSoldThisYear: false,
    });
    const codes = detectOutOfScope({ model }).map((f) => f.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "rental-part-year",
        "rental-private-use",
        "rental-bought-or-sold-this-year",
      ]),
    );
  });

  it("does not run rental checks when there is no rental", () => {
    const model = cleanSalaryReturn();
    // A stale gate answer with the property absent must not trigger.
    const withStaleGate = {
      ...model,
      questionnaire: {
        ...model.questionnaire,
        rentalScopeGate: answer<RentalScopeGateAnswer>(unsetField<RentalScopeGateAnswer>(), {
          solelyOwned: false,
          rentedOrAvailableAllYear: false,
          noPrivateUse: false,
          notBoughtOrSoldThisYear: false,
        }),
      },
    };
    expect(detectOutOfScope({ model: withStaleGate })).toEqual([]);
  });

  it("flags a part-year resident", () => {
    const model = cleanSalaryReturn();
    const partYear = {
      ...model,
      context: { ...model.context, residency: conf<ResidencyStatus>("part-year-resident") },
    };
    const findings = detectOutOfScope({ model: partYear });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ code: "part-year-resident", source: "answer" });
  });

  it("flags a non-resident", () => {
    const model = cleanSalaryReturn();
    const nonResident = {
      ...model,
      context: { ...model.context, residency: conf<ResidencyStatus>("non-resident") },
    };
    expect(detectOutOfScope({ model: nonResident }).map((f) => f.code)).toEqual(["non-resident"]);
  });

  it("flags residency from a 'not full year' questionnaire answer when the status field is unset", () => {
    const model = cleanSalaryReturn();
    const notFullYear = {
      ...model,
      context: { ...model.context, residency: unsetField<ResidencyStatus>() },
      questionnaire: {
        ...model.questionnaire,
        residencyFullYear: answer(unsetField<boolean>(), false),
      },
    };
    expect(detectOutOfScope({ model: notFullYear }).map((f) => f.code)).toEqual([
      "residency-not-full-year-resident",
    ]);
  });
});

describe("detectOutOfScope — from documents", () => {
  it("flags a managed-fund distribution statement the content check caught", () => {
    const contentFindings: DocumentContentClassification[] = [
      {
        docId: "d7",
        filename: "vanguard-annual-tax-statement.pdf",
        categories: ["trust-partnership-managed-fund-distribution"],
      },
    ];
    const findings = detectOutOfScope({ model: cleanSalaryReturn(), contentFindings });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: "trust-partnership-managed-fund-distribution",
      source: "document",
      item: "Trust, partnership or managed-fund distribution",
    });
    expect(findings[0]!.detail).toContain("vanguard-annual-tax-statement.pdf");
  });

  it("emits one finding per (document, category)", () => {
    const contentFindings: DocumentContentClassification[] = [
      { docId: "a", filename: "sharesale.pdf", categories: ["capital-gains"] },
      { docId: "b", filename: "overseas.pdf", categories: ["foreign-income", "capital-gains"] },
    ];
    const findings = detectOutOfScope({ model: cleanSalaryReturn(), contentFindings });
    expect(findings).toHaveLength(3);
  });
});

describe("deduction-method guards", () => {
  it("passes cents-per-km and an unset car method", () => {
    expect(carMethodOutOfScope("cents-per-km")).toBeNull();
    expect(carMethodOutOfScope("")).toBeNull();
  });

  it("flags the car logbook method", () => {
    expect(carMethodOutOfScope("logbook")).toMatchObject({
      code: "car-logbook-method",
      source: "figure",
    });
  });

  it("passes fixed-rate and an unset WFH method", () => {
    expect(wfhMethodOutOfScope("fixed-rate")).toBeNull();
    expect(wfhMethodOutOfScope("")).toBeNull();
  });

  it("flags the WFH actual-cost method", () => {
    expect(wfhMethodOutOfScope("actual-cost")).toMatchObject({
      code: "wfh-actual-cost-method",
      source: "figure",
    });
  });
});

describe("documentsNeedingContentCheck", () => {
  it("selects dividend-statement and unrecognised documents only", () => {
    const docs = [
      { docId: "1", detectedType: "dividend-statement", filename: "div.pdf" },
      { docId: "2", detectedType: "unrecognised", filename: "mystery.pdf" },
      { docId: "3", detectedType: "income-statement", filename: "payg.pdf" },
      { docId: "4", detectedType: "rental-agent-statement", filename: "agent.pdf" },
    ];
    expect(documentsNeedingContentCheck(docs).map((d) => d.docId)).toEqual(["1", "2"]);
  });
});
