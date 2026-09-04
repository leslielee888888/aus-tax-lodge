import { describe, expect, it } from "vitest";

import { getTaxonomy, taxonomy202526 } from "../src/index";

const taxonomy = getTaxonomy();

describe("ATO individual-return label taxonomy 2025-26", () => {
  it("is the same object the registry returns", () => {
    expect(taxonomy).toBe(taxonomy202526);
  });

  it("lists the myTax sections in on-screen order", () => {
    expect(taxonomy.myTaxSectionOrder).toEqual([
      "personalise",
      "income",
      "deductions",
      "tax-losses",
      "tax-offsets",
      "adjustments",
      "medicare-and-phi",
      "spouse-and-income-tests",
      "estimate",
    ]);
  });

  it("carries the in-scope income, deduction, Medicare and income-test labels", () => {
    const codes = new Set(taxonomy.labels.map((l) => l.code));
    for (const code of [
      "1",
      "5",
      "10L",
      "11S",
      "11T",
      "11U",
      "D1",
      "D2",
      "D3",
      "D4",
      "D5",
      "D9",
      "D10",
      "21",
      "M1",
      "M2",
      "IT1",
      "IT2",
      "IT6",
      "IT8",
    ]) {
      expect(codes, `label ${code}`).toContain(code);
    }
  });

  it("marks the out-of-scope items so detection and the export can name them", () => {
    const byCode = new Map(taxonomy.labels.map((l) => [l.code, l]));
    for (const code of ["6", "13", "15", "18", "20", "D7", "D8", "T1", "T2", "IT4"]) {
      expect(byCode.get(code)?.inScope, `label ${code}`).toBe(false);
    }
  });

  it("every label has a name, a known section and a form", () => {
    const sections = new Set(taxonomy.myTaxSectionOrder);
    for (const l of taxonomy.labels) {
      expect(l.name.length).toBeGreaterThan(0);
      expect(sections.has(l.section)).toBe(true);
      expect(["main", "supplement"]).toContain(l.form);
    }
  });
});

describe("rental property schedule (item 21) is complete", () => {
  const rs = taxonomy.rentalSchedule;
  const keys = new Set(rs.map((l) => l.key));

  it("has the paper labels P, Q, F, U and a computed net-rent line", () => {
    const paperLabels = new Set(rs.map((l) => l.paperLabel));
    for (const p of ["P", "Q", "F", "U", "net"]) expect(paperLabels).toContain(p);
    expect(rs.filter((l) => l.paperLabel === "net")).toHaveLength(1);
  });

  it("carries gross rent + other rental income under label P", () => {
    const incomeLines = rs.filter((l) => l.kind === "income");
    expect(incomeLines.map((l) => l.key)).toEqual(
      expect.arrayContaining(["grossRent", "otherRentalIncome"]),
    );
    expect(incomeLines.every((l) => l.paperLabel === "P")).toBe(true);
  });

  it("carries interest (Q), capital works Div 43 (F) and decline in value Div 40 (U)", () => {
    expect(rs.find((l) => l.key === "interestOnLoans")?.paperLabel).toBe("Q");
    expect(rs.find((l) => l.key === "capitalWorks")?.paperLabel).toBe("F");
    expect(rs.find((l) => l.key === "declineInValue")?.paperLabel).toBe("U");
  });

  it("carries the full agent-statement + owner-paid expense sub-label list", () => {
    for (const key of [
      "borrowingExpenses",
      "advertising",
      "bodyCorporate",
      "cleaning",
      "councilRates",
      "gardeningLawn",
      "insurance",
      "landTax",
      "legalFees",
      "pestControl",
      "agentFees",
      "repairsAndMaintenance",
      "stationeryPhonePostage",
      "waterCharges",
      "sundryExpenses",
    ]) {
      expect(keys, `rental line ${key}`).toContain(key);
    }
  });

  it("keeps the denied travel-expense line but marks it out of scope", () => {
    expect(rs.find((l) => l.key === "travelExpenses")?.inScope).toBe(false);
  });

  it("flags the repairs line for the over-$1,000 confirmation (Q25 / FR-24)", () => {
    expect(rs.find((l) => l.key === "repairsAndMaintenance")?.note).toMatch(/\$1,000/);
  });

  it("has unique keys", () => {
    expect(keys.size).toBe(rs.length);
  });
});
