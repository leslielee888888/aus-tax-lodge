import { createEmptyReturnModel } from "@aus-tax-lodge/model";
import { describe, expect, it } from "vitest";

import { topicsOutstanding, unsettledInScopeFieldHints } from "../../lib/interview";
import { readyModel } from "../review-fixtures";

describe("topicsOutstanding (PRD FR-3, Q1)", () => {
  it("is empty for a model that meets the deterministic completeness gate", () => {
    expect(topicsOutstanding(readyModel())).toEqual([]);
  });

  it("lists outstanding areas for a barely-started return", () => {
    const topics = topicsOutstanding(createEmptyReturnModel());
    expect(topics.length).toBeGreaterThan(0);
    // Deduction labels and the FR-6 questionnaire facts are all still open.
    expect(topics.join(" | ")).toMatch(/study|resident|cover|D5|donation/i);
  });
});

describe("unsettledInScopeFieldHints (PRD FR-3, #88 / T15)", () => {
  it("flags the taxpayer identity and deduction categories for a barely-started return", () => {
    const hints = unsettledInScopeFieldHints(createEmptyReturnModel());
    expect(hints.length).toBeGreaterThan(0);
    expect(hints.some((h) => /taxpayer.*name|date of birth|postal address/i.test(h))).toBe(true);
    expect(hints.some((h) => /car|not claimed|records/i.test(h))).toBe(true);
  });

  it("never mentions the TFN or refund account — those are card-only (PRD FR-17)", () => {
    const hints = unsettledInScopeFieldHints(createEmptyReturnModel());
    const joined = hints.join(" | ").toLowerCase();
    expect(joined).not.toContain("tax file number");
    expect(joined).not.toContain("refund account");
    expect(joined).not.toContain("taxfilenumber");
    expect(joined).not.toContain("refundaccount");
  });

  it("is empty for a model that meets the deterministic completeness gate (+ a settled identity block)", () => {
    const base = readyModel();
    const model = {
      ...base,
      taxpayer: {
        fullName: {
          ...base.taxpayer.fullName,
          value: "Priya Example",
          status: "confirmed" as const,
        },
        dateOfBirth: {
          ...base.taxpayer.dateOfBirth,
          value: "1985-03-02",
          status: "confirmed" as const,
        },
        postalAddress: {
          ...base.taxpayer.postalAddress,
          value: {
            line1: "1 Test St",
            line2: "",
            suburb: "Sydney",
            state: "NSW",
            postcode: "2000",
            country: "Australia",
          },
          status: "confirmed" as const,
        },
        taxFileNumber: base.taxpayer.taxFileNumber,
        refundAccount: base.taxpayer.refundAccount,
      },
    };
    expect(unsettledInScopeFieldHints(model)).toEqual([]);
  });
});
