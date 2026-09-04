import { describe, expect, it } from "vitest";

import {
  dataset202526,
  getParams,
  validateDataset,
  type TaxParams,
  type YearDataset,
} from "../src/index";

/** Recursively strips `readonly` so a cloned dataset can be mutated in a test. */
type Mutable<T> = T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;

function brokenClone(): Mutable<YearDataset> {
  return structuredClone(dataset202526) as Mutable<YearDataset>;
}

describe("2025-26 dataset validates against the schema", () => {
  it("passes the runtime validator with no errors", () => {
    const result = validateDataset(dataset202526);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("flags the figures that still need human verification", () => {
    const result = validateDataset(dataset202526);
    // The beneficiary tax offset formula is not on a year-stamped ATO page.
    expect(result.unverified.join("\n")).toMatch(/beneficiaryTaxOffset/i);
  });
});

describe("every required parameter group is present and non-null", () => {
  const params = getParams();
  const groups: Exclude<keyof TaxParams, "meta">[] = [
    "residentRates",
    "medicareLevy",
    "medicareLevySurcharge",
    "privateHealthRebate",
    "lowIncomeTaxOffset",
    "beneficiaryTaxOffset",
    "studyLoan",
    "rounding",
  ];

  it.each(groups)("%s has a value, an ato.gov.au source and a verification date", (key) => {
    const group = params[key];
    expect(group).toBeDefined();
    expect(group.value).not.toBeNull();
    expect(group.value).not.toBeUndefined();
    expect(group.source).toContain("ato.gov.au");
    expect(group.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("resident scale is the 5-band 2025-26 scale (0 / 16 / 30 / 37 / 45)", () => {
    expect(params.residentRates.value.map((b) => b.rate)).toEqual([0, 0.16, 0.3, 0.37, 0.45]);
    expect(params.residentRates.value.map((b) => b.incomeOver)).toEqual([
      0, 18200, 45000, 135000, 190000,
    ]);
  });

  it("study loan uses the marginal system from 2025-26 with a $67,000 minimum threshold", () => {
    expect(params.studyLoan.value.system).toBe("marginal");
    expect(params.studyLoan.value.minRepaymentThreshold).toBe(67000);
  });

  it("the private health rebate carries both 2025-26 adjustment periods", () => {
    const periods = params.privateHealthRebate.value.periods;
    expect(periods).toHaveLength(2);
    expect(periods[0]?.startDate).toBe("2025-07-01");
    expect(periods[1]?.startDate).toBe("2026-04-01");
    expect(periods[1]?.endDate).toBe("2026-06-30");
  });

  it("Medicare levy carries the rate, shade-in and every threshold band", () => {
    const ml = params.medicareLevy.value;
    expect(ml.rate).toBe(0.02);
    expect(ml.shadeInRate).toBe(0.1);
    expect(ml.single.lower).toBe(28011);
    expect(ml.family.lower).toBe(47238);
    expect(ml.familyChildIncrement.lower).toBe(4338);
  });

  it("rounding rules encode whole-dollar taxable income and cents-kept credits", () => {
    const r = params.rounding.value;
    expect(r.taxableIncome).toBe("floor-to-whole-dollar");
    expect(r.frankingCreditsAndWithholding).toBe("keep-cents");
    expect(r.studyLoanRepaymentIncome).toBe("floor-to-whole-dollar");
  });
});

describe("the validator rejects a broken dataset", () => {
  it("catches a non-ato source", () => {
    const broken = brokenClone();
    broken.params.residentRates.source = "https://example.com";
    const result = validateDataset(broken);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/residentRates: source must be an ato\.gov\.au URL/);
  });

  it("catches a non-contiguous tax scale", () => {
    const broken = brokenClone();
    const band = broken.params.residentRates.value[1];
    if (band) band.upTo = 44000;
    const result = validateDataset(broken);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/must equal the next band's incomeOver/);
  });

  it("catches rebate periods that don't span the income year", () => {
    const broken = brokenClone();
    const period = broken.params.privateHealthRebate.value.periods[0];
    if (period) period.startDate = "2025-08-01";
    const result = validateDataset(broken);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/must span the whole income year/);
  });
});
