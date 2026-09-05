import { documentOrigin, type Provenanced } from "@aus-tax-lodge/model";
import { describe, expect, it } from "vitest";

import { isExportBlocked, validateReturn } from "../src/validate";
import { conf, validReturn } from "./fixtures";

describe("validateReturn — clean return (PRD FR-13)", () => {
  it("returns [] for a fully valid, complete, in-scope return", () => {
    expect(validateReturn(validReturn())).toEqual([]);
  });
});

describe("validateReturn — mandatory labels (PRD FR-13)", () => {
  it("flags a missing mandatory label by name", () => {
    const base = validReturn();
    const employer = {
      ...base.income.salaryWages[0]!,
      grossSalaryWages: { value: null, status: "unset" as const, origin: null, proposedValue: null, edits: [] },
    };
    const model = { ...base, income: { ...base.income, salaryWages: [employer] } };
    const issues = validateReturn(model);
    const found = issues.find((i) => i.code === "mandatory-label-missing" && i.path === "1");
    expect(found).toBeDefined();
    expect(found?.message).toContain("Salary");
  });
});

describe("validateReturn — out-of-scope (PRD FR-13, FR-20)", () => {
  it("flags an out-of-scope return with an error", () => {
    const base = validReturn();
    const model = {
      ...base,
      context: { ...base.context, residency: conf<"non-resident">("non-resident") },
    };
    const issues = validateReturn(model);
    expect(issues.some((i) => i.code === "out-of-scope:non-resident" && i.severity === "error")).toBe(
      true,
    );
  });
});

describe("validateReturn — TFN / BSB (PRD FR-1, FR-13)", () => {
  it("flags a TFN that fails the checksum", () => {
    const base = validReturn();
    const model = {
      ...base,
      taxpayer: { ...base.taxpayer, taxFileNumber: conf("123456781") },
    };
    const issues = validateReturn(model);
    expect(issues).toContainEqual(
      expect.objectContaining({ code: "tfn-invalid", severity: "error", path: "taxpayer.taxFileNumber" }),
    );
  });

  it("flags a malformed BSB", () => {
    const base = validReturn();
    const model = {
      ...base,
      taxpayer: {
        ...base.taxpayer,
        refundAccount: conf({
          bsb: "1234567",
          accountNumber: "12345678",
          accountName: "Priya Example",
        }),
      },
    };
    const issues = validateReturn(model);
    expect(issues).toContainEqual(
      expect.objectContaining({ code: "bsb-invalid", severity: "error" }),
    );
  });
});

describe("validateReturn — no disallowed negatives (PRD FR-13)", () => {
  it("flags a negative salary figure", () => {
    const base = validReturn();
    const employer = { ...base.income.salaryWages[0]!, grossSalaryWages: conf(-100) };
    const model = { ...base, income: { ...base.income, salaryWages: [employer] } };
    const issues = validateReturn(model);
    expect(issues).toContainEqual(
      expect.objectContaining({
        code: "negative-amount",
        severity: "error",
        path: "income.salaryWages[0].grossSalaryWages",
      }),
    );
  });

  it("does not flag a negative net rental result", () => {
    const base = validReturn();
    const model = {
      ...base,
      rental: { ...base.rental, netRentalResult: conf(-4_080) },
    };
    const issues = validateReturn(model);
    expect(issues.some((i) => i.code === "negative-amount")).toBe(false);
  });
});

describe("validateReturn — plausibility (PRD FR-13, warnings only)", () => {
  it("flags franking credits wildly off the gross-up ratio as a warning, not an error", () => {
    const base = validReturn();
    const holding = { ...base.income.dividends[0]!, frankingCredits: conf(3_000) };
    const model = { ...base, income: { ...base.income, dividends: [holding] } };
    const issues = validateReturn(model);
    const found = issues.find((i) => i.code === "franking-credit-implausible");
    expect(found).toBeDefined();
    expect(found?.severity).toBe("warning");
    expect(issues.some((i) => i.severity === "error")).toBe(false);
  });

  it("flags PAYG withheld implausibly low relative to salary as a warning", () => {
    const base = validReturn();
    const employer = { ...base.income.salaryWages[0]!, paygWithheld: conf(100) };
    const model = { ...base, income: { ...base.income, salaryWages: [employer] } };
    const issues = validateReturn(model);
    expect(issues).toContainEqual(
      expect.objectContaining({ code: "payg-withheld-implausible", severity: "warning" }),
    );
  });

  it("flags loan interest more than 3x gross rent as a warning", () => {
    const base = validReturn();
    const expenses = {
      ...base.rental.expenses,
      interestOnLoans: { amount: conf(90_000), source: "loan-summary" as const },
    };
    const model = { ...base, rental: { ...base.rental, expenses } };
    const issues = validateReturn(model);
    expect(issues).toContainEqual(
      expect.objectContaining({ code: "loan-interest-implausible", severity: "warning" }),
    );
  });

  it("skips the capital-works check entirely when the model carries no construction-cost figure", () => {
    const base = validReturn();
    const expenses = {
      ...base.rental.expenses,
      capitalWorks: { amount: conf(50_000), source: "qs-schedule" as const },
    };
    const model = { ...base, rental: { ...base.rental, expenses } };
    const issues = validateReturn(model);
    expect(issues.some((i) => i.code === "capital-works-implausible")).toBe(false);
  });
});

describe("validateReturn — unverified figures (PRD FR-3, FR-13)", () => {
  it("flags a figure whose origin confidence is unverified, even if marked confirmed", () => {
    const base = validReturn();
    const unverified: Provenanced<number> = {
      value: 400,
      status: "confirmed",
      origin: documentOrigin("doc-9", 2, "$400 interest", "unverified"),
      proposedValue: 400,
      edits: [],
    };
    const account = { ...base.income.interestAccounts[0]!, grossInterest: unverified };
    const model = { ...base, income: { ...base.income, interestAccounts: [account] } };
    const issues = validateReturn(model);
    expect(issues).toContainEqual(
      expect.objectContaining({
        code: "unverified-figure",
        severity: "error",
        path: "income.interestAccounts[0].grossInterest",
      }),
    );
  });

  it("does not flag an unverified figure that has been marked not-applicable", () => {
    const base = validReturn();
    const unverifiedButNa: Provenanced<number> = {
      value: null,
      status: "not-applicable",
      origin: documentOrigin("doc-9", 2, "$400 interest", "unverified"),
      proposedValue: 400,
      edits: [],
    };
    const account = { ...base.income.interestAccounts[0]!, grossInterest: unverifiedButNa };
    const model = { ...base, income: { ...base.income, interestAccounts: [account] } };
    const issues = validateReturn(model);
    expect(issues.some((i) => i.code === "unverified-figure")).toBe(false);
  });
});

describe("validateReturn — unconfirmed fields (PRD FR-7, FR-13)", () => {
  it("flags an in-scope field left unset, distinct from the mandatory-label check", () => {
    const base = validReturn();
    const model = {
      ...base,
      taxpayer: {
        ...base.taxpayer,
        dateOfBirth: { value: null, status: "unset" as const, origin: null, proposedValue: null, edits: [] },
      },
    };
    const issues = validateReturn(model);
    expect(issues).toContainEqual(
      expect.objectContaining({
        code: "unconfirmed-field",
        severity: "error",
        path: "taxpayer.dateOfBirth",
      }),
    );
    // Not a taxonomy label — the mandatory-labels check should not also fire on it.
    expect(
      issues.some((i) => i.code === "mandatory-label-missing" && i.path === "taxpayer.dateOfBirth"),
    ).toBe(false);
  });
});

describe("validateReturn — rental repairs confirmation (PRD Q25, FR-13, FR-24)", () => {
  it("flags an over-threshold repairs line that has not been confirmed a genuine repair", () => {
    const base = validReturn();
    const expenses = {
      ...base.rental.expenses,
      repairsAndMaintenance: { amount: conf(3_500), source: "agent-statement" as const },
    };
    const model = {
      ...base,
      rental: { ...base.rental, expenses, repairsConfirmedNotCapital: false },
    };
    const issues = validateReturn(model);
    expect(issues).toContainEqual(
      expect.objectContaining({ code: "rental-repairs-unconfirmed", severity: "error" }),
    );
  });

  it("does not flag it once confirmed a genuine repair", () => {
    const base = validReturn();
    const expenses = {
      ...base.rental.expenses,
      repairsAndMaintenance: { amount: conf(3_500), source: "agent-statement" as const },
    };
    const model = {
      ...base,
      rental: { ...base.rental, expenses, repairsConfirmedNotCapital: true },
    };
    const issues = validateReturn(model);
    expect(issues.some((i) => i.code === "rental-repairs-unconfirmed")).toBe(false);
  });
});

describe("isExportBlocked (PRD FR-13)", () => {
  it("is false when there are no issues", () => {
    expect(isExportBlocked([])).toBe(false);
  });

  it("is false when only warnings are present", () => {
    const base = validReturn();
    const holding = { ...base.income.dividends[0]!, frankingCredits: conf(3_000) };
    const model = { ...base, income: { ...base.income, dividends: [holding] } };
    const issues = validateReturn(model);
    expect(issues.every((i) => i.severity === "warning")).toBe(true);
    expect(isExportBlocked(issues)).toBe(false);
  });

  it("is true when at least one error is present", () => {
    const base = validReturn();
    const employer = { ...base.income.salaryWages[0]!, grossSalaryWages: conf(-100) };
    const model = { ...base, income: { ...base.income, salaryWages: [employer] } };
    const issues = validateReturn(model);
    expect(isExportBlocked(issues)).toBe(true);
  });
});
