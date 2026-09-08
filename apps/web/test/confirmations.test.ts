import {
  createEmptyDividendHolding,
  createEmptyEmployerIncome,
  createEmptyInterestAccount,
  createEmptyReturnModel,
  documentOrigin,
  edit,
  propose,
  unsetField,
  type FieldConfidence,
  type ReturnModel,
} from "@aus-tax-lodge/model";
import type { ValidationIssue } from "@aus-tax-lodge/validation";
import { describe, expect, it } from "vitest";

import {
  collectPendingConfirmations,
  confirmFieldAtPath,
  editFieldAtPath,
  mergePendingConfirmations,
} from "../lib/confirmations";

const doc = (confidence: FieldConfidence) => documentOrigin("doc1", 1, "snippet", confidence);
const num = (value: number, confidence: FieldConfidence = "high") =>
  propose(unsetField<number>(), value, doc(confidence));
const str = (value: string) => propose(unsetField<string>(), value, doc("high"));

/** A model with one salary payer, one interest account and one dividend holding, all proposed. */
function seededModel(
  opts: { salaryConfidence?: FieldConfidence; interestConfidence?: FieldConfidence } = {},
): ReturnModel {
  const base = createEmptyReturnModel("2025-26");
  return {
    ...base,
    income: {
      ...base.income,
      salaryWages: [
        {
          ...createEmptyEmployerIncome("e1"),
          payerName: str("Acme Pty Ltd"),
          grossSalaryWages: num(95_000, opts.salaryConfidence ?? "high"),
          paygWithheld: num(22_000, opts.salaryConfidence ?? "high"),
        },
      ],
      interestAccounts: [
        {
          ...createEmptyInterestAccount("a1"),
          institution: str("Southbank Mutual"),
          grossInterest: num(312, opts.interestConfidence ?? "high"),
          ownershipSharePercent: num(100),
        },
      ],
      dividends: [
        {
          ...createEmptyDividendHolding("d1"),
          company: str("BHP"),
          franked: num(700),
          frankingCredits: num(300),
        },
      ],
    },
  };
}

describe("collectPendingConfirmations (PRD FR-5, Q2)", () => {
  it("does not flag a high-confidence pre-fill figure with no validation flag and no edit", () => {
    expect(collectPendingConfirmations(seededModel(), [])).toEqual([]);
  });

  it("flags a low-confidence document figure with reason low-confidence", () => {
    const flagged = collectPendingConfirmations(seededModel({ interestConfidence: "low" }), []);
    const interest = flagged.find(
      (f) => f.modelPath === "income.interestAccounts[0].grossInterest",
    );
    expect(interest).toMatchObject({
      reason: "low-confidence",
      value: 312,
      label: "Gross interest — Southbank Mutual",
      source: "your pre-fill report",
      id: "pc:income.interestAccounts[0].grossInterest",
      resolved: false,
    });
  });

  it("flags a figure a validateReturn warning names, with reason plausibility", () => {
    const validation: ValidationIssue[] = [
      {
        code: "franking-credit-implausible",
        severity: "warning",
        message: "Franking credits look implausible.",
        path: "income.dividends[0].frankingCredits",
      },
    ];
    const flagged = collectPendingConfirmations(seededModel(), validation);
    expect(flagged.find((f) => f.modelPath === "income.dividends[0].frankingCredits")?.reason).toBe(
      "plausibility",
    );
  });

  it("ignores the 'not confirmed yet' bookkeeping codes", () => {
    const validation: ValidationIssue[] = [
      {
        code: "unconfirmed-field",
        severity: "error",
        message: "not confirmed",
        path: "income.salaryWages[0].grossSalaryWages",
      },
      { code: "mandatory-label-missing", severity: "error", message: "missing", path: "1" },
    ];
    expect(collectPendingConfirmations(seededModel(), validation)).toEqual([]);
  });

  it("flags a user-edited figure with reason user-corrected", () => {
    const model = seededModel();
    const corrected: ReturnModel = {
      ...model,
      income: {
        ...model.income,
        interestAccounts: [
          {
            ...model.income.interestAccounts[0]!,
            grossInterest: edit(model.income.interestAccounts[0]!.grossInterest, 340),
          },
        ],
      },
    };
    const interest = collectPendingConfirmations(corrected, []).find(
      (f) => f.modelPath === "income.interestAccounts[0].grossInterest",
    );
    expect(interest).toMatchObject({
      reason: "user-corrected",
      value: 340,
      source: "the correction you made",
    });
  });
});

describe("mergePendingConfirmations", () => {
  it("carries a prior resolution forward by modelPath", () => {
    const previous = [
      {
        id: "pc:income.interestAccounts[0].grossInterest",
        modelPath: "income.interestAccounts[0].grossInterest",
        label: "Gross interest",
        value: 312,
        source: "your pre-fill report",
        reason: "low-confidence" as const,
        resolved: true,
      },
    ];
    const fresh = collectPendingConfirmations(seededModel({ interestConfidence: "low" }), []);
    const merged = mergePendingConfirmations(previous, fresh);
    expect(merged.find((c) => c.modelPath === previous[0]!.modelPath)?.resolved).toBe(true);
  });
});

describe("confirmFieldAtPath / editFieldAtPath", () => {
  it("confirm() marks the figure confirmed without changing its value", () => {
    const model = confirmFieldAtPath(seededModel(), "income.interestAccounts[0].grossInterest");
    expect(model.income.interestAccounts[0]!.grossInterest).toMatchObject({
      status: "confirmed",
      value: 312,
    });
  });

  it("edit() writes the new value and keeps the original as proposedValue", () => {
    const model = editFieldAtPath(seededModel(), "income.interestAccounts[0].grossInterest", 340);
    const field = model.income.interestAccounts[0]!.grossInterest;
    expect(field.value).toBe(340);
    expect(field.proposedValue).toBe(312);
    expect(field.status).toBe("confirmed");
    expect(field.edits.at(-1)).toMatchObject({ from: 312, to: 340 });
  });

  it("throws for a path that is not a Provenanced field", () => {
    expect(() => confirmFieldAtPath(seededModel(), "income.notAThing")).toThrow();
  });
});
