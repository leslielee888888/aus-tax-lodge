/**
 * The 2025-26 golden set (PRD T5). ~44 hand-worked scenarios covering every
 * resident bracket boundary (±1), the Medicare levy shade-in band, the Medicare
 * levy surcharge (nil / part-year / all three tiers, single and partnered), the
 * LITO taper and its floor, the beneficiary tax offset, the study-loan repayment
 * threshold and band seams, excess- vs partial-franking-credit offset, a nil
 * return, the PHI rebate reconciliation, and rental cases (negatively geared,
 * positively geared, and depreciation-driven) including the FR-23 net-rental-loss
 * add-back to the income tests.
 *
 * `source` on every scenario shows the authoritative origin and the arithmetic.
 * Authorities used:
 *   - Resident rates 2025-26 — ATO "Tax rates – Australian resident"
 *     https://www.ato.gov.au/tax-rates-and-codes/tax-rates-australian-residents
 *     $0–18,200 nil · 18,201–45,000 16c/$1 over 18,200 · 45,001–135,000
 *     $4,288 + 30c over 45,000 · 135,001–190,000 $31,288 + 37c over 135,000 ·
 *     190,001+ $51,638 + 45c over 190,000.
 *   - Medicare levy 2025-26 — ATO "Medicare levy reduction for low-income
 *     earners" / "…family income". Rate 2%. Single: nil ≤ $28,011, shade-in to
 *     $35,013. Family: nil ≤ $47,238. Shade-in = lesser of 10c per $1 over the
 *     lower threshold and 2% of taxable income (Medicare Levy Act 1986 s7/s8).
 *   - Medicare levy surcharge 2025-26 — ATO "Medicare levy surcharge income,
 *     thresholds and rates". Single ≤ $101,000 nil · $101,001–118,000 1% ·
 *     $118,001–158,000 1.25% · $158,001+ 1.5%. Family doubled ($202,000 etc.).
 *     Levied on taxable income + reportable fringe benefits, for the days
 *     without an appropriate hospital cover / 365 (ATO M2).
 *   - LITO — ATO "Low income tax offset". Max $700 to $37,500; −5c per $1 to
 *     $45,000; then −1.5c per $1 to the $66,667 cut-out.
 *   - Study & training loan 2025-26 — ATO "Study and training loan repayment
 *     thresholds and rates" (marginal system, new for 2025-26). Nil ≤ $67,000 ·
 *     $67,001–125,000 15c per $1 over $67,000 · $125,001–179,285 $8,700 + 17c
 *     per $1 over $125,000 · $179,286+ 10% of the whole repayment income.
 *   - PHI rebate 2025-26 — ATO "Income thresholds and rates for the private
 *     health insurance rebate". Oldest person under 65, base tier: 24.288%
 *     (1 Jul 2025–31 Mar 2026) then 24.118% (1 Apr–30 Jun 2026).
 *   - Beneficiary tax offset — ATO "Beneficiary tax offset": a taxpayer whose
 *     only income is a rebatable benefit (JobSeeker etc.) pays no income tax;
 *     the offset is non-refundable and does not reduce the Medicare levy.
 *
 * The ATO online estimators/calculators (Income tax estimator, Simple tax
 * calculator, Study/training loan calculator, Medicare levy calculator) are
 * interactive tools that cannot be fetched as data; every figure here is
 * therefore hand-worked from the published rates pages above, which is the
 * method the PRD's "Calculation accuracy" non-functional prescribes for cases
 * the estimator does not cover.
 */
import type { EngineInput } from "../../src/types";
import type { Scenario } from "./scenario";

const ZERO: EngineInput = {
  income: {
    salaryWages: 0,
    paygWithheld: 0,
    grossInterest: 0,
    dividends: { unfranked: 0, franked: 0, frankingCredits: 0 },
    governmentAllowances: 0,
    netRentalResult: 0,
    reportableFringeBenefits: 0,
    reportableEmployerSuper: 0,
    privateHealth: null,
  },
  deductions: { total: 0 },
  context: {
    residency: "resident-full-year",
    spouseTaxableIncome: null,
    privateHospitalCoverDays: 0,
    holdsStudyLoan: false,
    dependentChildren: 0,
  },
};

function mk(patch: {
  income?: Partial<EngineInput["income"]>;
  deductions?: Partial<EngineInput["deductions"]>;
  context?: Partial<EngineInput["context"]>;
}): EngineInput {
  return {
    income: { ...ZERO.income, ...patch.income },
    deductions: { ...ZERO.deductions, ...patch.deductions },
    context: { ...ZERO.context, ...patch.context },
  };
}

export const scenarios: readonly Scenario[] = [
  // -------------------------------------------------------------------------
  // Nil return + resident bracket boundaries (±1) — FR-8, FR-15
  // -------------------------------------------------------------------------
  {
    id: "G01",
    description: "nil return — no income, no deductions",
    source:
      "No assessable income → taxable income $0 → tax $0, Medicare levy $0 (below $28,011), no credits. Final position: nil.",
    input: mk({}),
    expected: {
      assessableIncomeTotal: 0,
      taxableIncome: 0,
      taxOnTaxableIncome: 0,
      medicareLevy: 0,
      medicareLevySurcharge: 0,
      studyLoanRepayment: 0,
      outcomeSigned: 0,
    },
  },
  {
    id: "G02",
    description: "taxable income exactly at the tax-free threshold ($18,200)",
    source:
      "Resident scale: $0–$18,200 nil. Tax $0. Medicare levy $0 (≤ $28,011). LITO $700 but no tax to offset. Final: nil.",
    input: mk({ income: { salaryWages: 18_200 } }),
    expected: { taxableIncome: 18_200, taxOnTaxableIncome: 0, medicareLevy: 0, outcomeSigned: 0 },
  },
  {
    id: "G03",
    description: "taxable income $1 over the tax-free threshold ($18,201)",
    source:
      "Resident scale band 2: 16c × ($18,201 − $18,200) = $0.16. LITO $700 covers it → tax after offsets $0. Medicare levy $0. Final: nil.",
    input: mk({ income: { salaryWages: 18_201 } }),
    expected: {
      taxableIncome: 18_201,
      taxOnTaxableIncome: 0.16,
      taxAfterNonRefundableOffsets: 0,
      medicareLevy: 0,
      outcomeSigned: 0,
    },
  },
  {
    id: "G04",
    description: "$27,000 — mid band 2, below the Medicare levy threshold",
    source:
      "Tax: 16c × ($27,000 − $18,200) = $1,408. Medicare levy: $27,000 ≤ $28,011 → $0. LITO: $700 (income ≤ $37,500), applied against the $1,408 → tax after offsets $1,408 − $700 = $708. Amount payable $708.",
    input: mk({ income: { salaryWages: 27_000 } }),
    expected: {
      taxableIncome: 27_000,
      taxOnTaxableIncome: 1_408,
      medicareLevy: 0,
      lowIncomeTaxOffset: 700,
      taxAfterNonRefundableOffsets: 708,
      outcomeSigned: 708,
    },
  },
  {
    id: "G05",
    description: "$28,011 — exactly at the Medicare levy single lower threshold",
    source:
      "Tax: 16c × ($28,011 − $18,200) = $1,569.76. Medicare levy: income ≤ $28,011 → $0. LITO $700 → tax after offsets $869.76. Amount payable $869.76.",
    input: mk({ income: { salaryWages: 28_011 } }),
    expected: {
      taxOnTaxableIncome: 1_569.76,
      medicareLevy: 0,
      lowIncomeTaxOffset: 700,
      taxAfterNonRefundableOffsets: 869.76,
      outcomeSigned: 869.76,
    },
  },
  {
    id: "G06",
    description: "$32,000 — inside the Medicare levy shade-in band",
    source:
      "Tax: 16c × ($32,000 − $18,200) = $2,208. Medicare levy shade-in = lesser of 10c × ($32,000 − $28,011) = $398.90 and 2% × $32,000 = $640 → $398.90. LITO $700 → tax after offsets $1,508. Total tax liability $1,508 + $398.90 = $1,906.90.",
    input: mk({ income: { salaryWages: 32_000 } }),
    expected: {
      taxOnTaxableIncome: 2_208,
      medicareLevy: 398.9,
      lowIncomeTaxOffset: 700,
      taxAfterNonRefundableOffsets: 1_508,
      totalTaxLiability: 1_906.9,
      outcomeSigned: 1_906.9,
    },
  },
  {
    id: "G07",
    description: "$35,013 — top of the Medicare levy shade-in band (shade-in still the lesser)",
    source:
      "Tax: 16c × ($35,013 − $18,200) = $2,690.08. Medicare levy = lesser of 10c × ($35,013 − $28,011) = $700.20 and 2% × $35,013 = $700.26 → $700.20 (the ATO's published upper threshold is a rounded figure; the Act takes the lesser). LITO $700 → tax after offsets $1,990.08. Liability $1,990.08 + $700.20 = $2,690.28.",
    input: mk({ income: { salaryWages: 35_013 } }),
    expected: { taxOnTaxableIncome: 2_690.08, medicareLevy: 700.2, outcomeSigned: 2_690.28 },
  },
  {
    id: "G08",
    description: "$35,014 — $1 above the shade-in band (2% is now the lesser)",
    source:
      "Tax: 16c × ($35,014 − $18,200) = $2,690.24. Medicare levy = lesser of 10c × ($35,014 − $28,011) = $700.30 and 2% × $35,014 = $700.28 → $700.28. LITO $700 → tax after offsets $1,990.24. Liability $1,990.24 + $700.28 = $2,690.52.",
    input: mk({ income: { salaryWages: 35_014 } }),
    expected: { taxOnTaxableIncome: 2_690.24, medicareLevy: 700.28, outcomeSigned: 2_690.52 },
  },
  {
    id: "G09",
    description: "$44,999 — $1 below the 30% bracket threshold",
    source:
      "Tax (band 2): 16c × ($44,999 − $18,200) = $4,287.84. Medicare levy: 2% × $44,999 = $899.98. LITO: $700 − 5c × ($44,999 − $37,500) = $700 − $374.95 = $325.05. Tax after offsets $4,287.84 − $325.05 = $3,962.79. Liability $3,962.79 + $899.98 = $4,862.77.",
    input: mk({ income: { salaryWages: 44_999 } }),
    expected: {
      taxableIncome: 44_999,
      taxOnTaxableIncome: 4_287.84,
      medicareLevy: 899.98,
      lowIncomeTaxOffset: 325.05,
      outcomeSigned: 4_862.77,
    },
  },
  {
    id: "G10",
    description: "$45,000 — exactly at the 30% bracket threshold",
    source:
      "Tax (band 3 base): $4,288 + 30c × $0 = $4,288. Medicare levy: 2% × $45,000 = $900. LITO: $700 − 5c × ($45,000 − $37,500) = $325 (the 1.5c taper starts above $45,000). Tax after offsets $4,288 − $325 = $3,963. Liability $3,963 + $900 = $4,863.",
    input: mk({ income: { salaryWages: 45_000 } }),
    expected: {
      taxableIncome: 45_000,
      taxOnTaxableIncome: 4_288,
      medicareLevy: 900,
      lowIncomeTaxOffset: 325,
      outcomeSigned: 4_863,
    },
  },
  {
    id: "G11",
    description: "$45,001 — $1 above the 30% bracket threshold",
    source:
      "Tax: $4,288 + 30c × ($45,001 − $45,000) = $4,288.30. Medicare levy: 2% × $45,001 = $900.02. (LITO at this point is $324.985, a half-cent knife-edge on rounding — not asserted here; the bracket-boundary check is the tax and levy.)",
    input: mk({ income: { salaryWages: 45_001 } }),
    expected: { taxableIncome: 45_001, taxOnTaxableIncome: 4_288.3, medicareLevy: 900.02 },
  },
  {
    id: "G12",
    description: "$134,999 — $1 below the 37% bracket threshold",
    source:
      "Tax: $4,288 + 30c × ($134,999 − $45,000) = $4,288 + $26,999.70 = $31,287.70. Medicare levy: 2% × $134,999 = $2,699.98. LITO $0 (> $66,667). Full-year hospital cover → no surcharge. Liability $31,287.70 + $2,699.98 = $33,987.68.",
    input: mk({ income: { salaryWages: 134_999 }, context: { privateHospitalCoverDays: 365 } }),
    expected: {
      taxOnTaxableIncome: 31_287.7,
      medicareLevy: 2_699.98,
      lowIncomeTaxOffset: 0,
      outcomeSigned: 33_987.68,
    },
  },
  {
    id: "G13",
    description: "$135,000 — exactly at the 37% bracket threshold",
    source:
      "Tax (band 4 base): $31,288. Medicare levy: 2% × $135,000 = $2,700. Full-year hospital cover → no surcharge. Liability $31,288 + $2,700 = $33,988.",
    input: mk({ income: { salaryWages: 135_000 }, context: { privateHospitalCoverDays: 365 } }),
    expected: { taxOnTaxableIncome: 31_288, medicareLevy: 2_700, outcomeSigned: 33_988 },
  },
  {
    id: "G14",
    description: "$135,001 — $1 above the 37% bracket threshold",
    source:
      "Tax: $31,288 + 37c × ($135,001 − $135,000) = $31,288.37. Medicare levy: 2% × $135,001 = $2,700.02. Full-year hospital cover → no surcharge. Liability $33,988.39.",
    input: mk({ income: { salaryWages: 135_001 }, context: { privateHospitalCoverDays: 365 } }),
    expected: { taxOnTaxableIncome: 31_288.37, medicareLevy: 2_700.02, outcomeSigned: 33_988.39 },
  },
  {
    id: "G15",
    description: "$189,999 — $1 below the 45% bracket threshold",
    source:
      "Tax: $31,288 + 37c × ($189,999 − $135,000) = $31,288 + $20,349.63 = $51,637.63. Medicare levy: 2% × $189,999 = $3,799.98. Full-year hospital cover → no surcharge. Liability $55,437.61.",
    input: mk({ income: { salaryWages: 189_999 }, context: { privateHospitalCoverDays: 365 } }),
    expected: { taxOnTaxableIncome: 51_637.63, medicareLevy: 3_799.98, outcomeSigned: 55_437.61 },
  },
  {
    id: "G16",
    description: "$190,000 — exactly at the top (45%) bracket threshold",
    source:
      "Tax (band 5 base): $51,638. Medicare levy: 2% × $190,000 = $3,800. Full-year hospital cover → no surcharge. Liability $55,438.",
    input: mk({ income: { salaryWages: 190_000 }, context: { privateHospitalCoverDays: 365 } }),
    expected: { taxOnTaxableIncome: 51_638, medicareLevy: 3_800, outcomeSigned: 55_438 },
  },
  {
    id: "G17",
    description: "$190,001 — $1 into the top (45%) bracket",
    source:
      "Tax: $51,638 + 45c × ($190,001 − $190,000) = $51,638.45. Medicare levy: 2% × $190,001 = $3,800.02. Full-year hospital cover → no surcharge. Liability $55,438.47.",
    input: mk({ income: { salaryWages: 190_001 }, context: { privateHospitalCoverDays: 365 } }),
    expected: { taxOnTaxableIncome: 51_638.45, medicareLevy: 3_800.02, outcomeSigned: 55_438.47 },
  },

  // -------------------------------------------------------------------------
  // LITO taper and floor — FR-11
  // -------------------------------------------------------------------------
  {
    id: "G18",
    description: "LITO first taper (−5c per $1) at $40,000",
    source:
      "LITO: $700 − 5c × ($40,000 − $37,500) = $700 − $125 = $575. Tax: 16c × ($40,000 − $18,200) = $3,488. Medicare levy: 2% × $40,000 = $800. Tax after offsets $3,488 − $575 = $2,913. Liability $2,913 + $800 = $3,713.",
    input: mk({ income: { salaryWages: 40_000 } }),
    expected: {
      taxOnTaxableIncome: 3_488,
      medicareLevy: 800,
      lowIncomeTaxOffset: 575,
      outcomeSigned: 3_713,
    },
  },
  {
    id: "G19",
    description: "LITO second taper (−1.5c per $1) at $55,000",
    source:
      "LITO: $700 − 5c × ($45,000 − $37,500) − 1.5c × ($55,000 − $45,000) = $700 − $375 − $150 = $175. Tax: $4,288 + 30c × $10,000 = $7,288. Medicare levy: 2% × $55,000 = $1,100. Tax after offsets $7,113. Liability $7,113 + $1,100 = $8,213.",
    input: mk({ income: { salaryWages: 55_000 } }),
    expected: {
      taxOnTaxableIncome: 7_288,
      medicareLevy: 1_100,
      lowIncomeTaxOffset: 175,
      outcomeSigned: 8_213,
    },
  },
  {
    id: "G20",
    description: "LITO floor — $66,666, offset tapered to ~$0.01, never negative",
    source:
      "LITO: $700 − 5c × $7,500 − 1.5c × ($66,666 − $45,000) = $700 − $375 − $324.99 = $0.01 (floored at $0, so exactly $0.01 here). Tax: $4,288 + 30c × ($66,666 − $45,000) = $10,787.80. Medicare levy: 2% × $66,666 = $1,333.32. Tax after offsets $10,787.79. Liability $10,787.79 + $1,333.32 = $12,121.11.",
    input: mk({ income: { salaryWages: 66_666 } }),
    expected: {
      lowIncomeTaxOffset: 0.01,
      taxOnTaxableIncome: 10_787.8,
      medicareLevy: 1_333.32,
      outcomeSigned: 12_121.11,
    },
  },
  {
    id: "G21",
    description: "LITO cut-out — $66,667, offset is exactly $0",
    source:
      "LITO cut-out is $66,667: offset $0. Tax: $4,288 + 30c × ($66,667 − $45,000) = $10,788.10. Medicare levy: 2% × $66,667 = $1,333.34. Liability $10,788.10 + $1,333.34 = $12,121.44.",
    input: mk({ income: { salaryWages: 66_667 } }),
    expected: {
      lowIncomeTaxOffset: 0,
      taxOnTaxableIncome: 10_788.1,
      medicareLevy: 1_333.34,
      outcomeSigned: 12_121.44,
    },
  },

  // -------------------------------------------------------------------------
  // Beneficiary tax offset — FR-11
  // -------------------------------------------------------------------------
  {
    id: "G22",
    description: "beneficiary offset — JobSeeker $20,000 is the only income → nil income tax",
    source:
      "ATO 'Beneficiary tax offset': a taxpayer whose only income is a rebatable Government allowance pays no income tax. Tax on $20,000 = 16c × $1,800 = $288; the beneficiary offset reduces it to $0. Medicare levy $0 (< $28,011). Final position: nil.",
    input: mk({ income: { governmentAllowances: 20_000 } }),
    expected: {
      taxOnTaxableIncome: 288,
      taxAfterNonRefundableOffsets: 0,
      medicareLevy: 0,
      outcomeSigned: 0,
    },
  },
  {
    id: "G23",
    description:
      "beneficiary offset — JobSeeker $30,000 only: nil income tax, Medicare shade-in still payable",
    source:
      "Tax on $30,000 = 16c × $11,800 = $1,888, reduced to $0 by the beneficiary offset. The offset cannot reduce the Medicare levy: shade-in = 10c × ($30,000 − $28,011) = $198.90 (< 2% × $30,000). Amount payable $198.90.",
    input: mk({ income: { governmentAllowances: 30_000 } }),
    expected: {
      taxOnTaxableIncome: 1_888,
      taxAfterNonRefundableOffsets: 0,
      medicareLevy: 198.9,
      outcomeSigned: 198.9,
    },
  },

  // -------------------------------------------------------------------------
  // Medicare levy surcharge — FR-9, FR-23
  // -------------------------------------------------------------------------
  {
    id: "G24",
    description: "MLS — nil, full-year hospital cover at $150,000",
    source:
      "365 days of appropriate hospital cover → no surcharge at any income. Tax ($150,000 is in the 37% band): $31,288 + 37c × ($150,000 − $135,000) = $31,288 + $5,550 = $36,838. Medicare levy: 2% × $150,000 = $3,000. Liability $39,838.",
    input: mk({ income: { salaryWages: 150_000 }, context: { privateHospitalCoverDays: 365 } }),
    expected: {
      medicareLevySurcharge: 0,
      taxOnTaxableIncome: 36_838,
      medicareLevy: 3_000,
      outcomeSigned: 39_838,
    },
  },
  {
    id: "G25",
    description: "MLS — tier 1 (1%), single, no cover, $110,000",
    source:
      "Income for MLS purposes $110,000 → single tier 1 ($101,001–$118,000), rate 1%. Surcharge = 1% × ($110,000 taxable income + $0 RFB) × 365/365 = $1,100. Tax: $4,288 + 30c × $65,000 = $23,788. Medicare levy: 2% × $110,000 = $2,200. Liability $23,788 + $2,200 + $1,100 = $27,088.",
    input: mk({ income: { salaryWages: 110_000 }, context: { privateHospitalCoverDays: 0 } }),
    expected: {
      medicareLevySurcharge: 1_100,
      mlsIncome: 110_000,
      taxOnTaxableIncome: 23_788,
      medicareLevy: 2_200,
      outcomeSigned: 27_088,
    },
    tolerance: { medicareLevySurcharge: 1, outcomeSigned: 1 },
  },
  {
    id: "G26",
    description: "MLS — tier 2 (1.25%), single, no cover, $140,000",
    source:
      "MLS income $140,000 → single tier 2 ($118,001–$158,000), 1.25%. Surcharge = 1.25% × $140,000 = $1,750. Tax: $31,288 + 37c × $5,000 = $33,138. Medicare levy: 2% × $140,000 = $2,800. Liability $33,138 + $2,800 + $1,750 = $37,688.",
    input: mk({ income: { salaryWages: 140_000 }, context: { privateHospitalCoverDays: 0 } }),
    expected: {
      medicareLevySurcharge: 1_750,
      mlsIncome: 140_000,
      taxOnTaxableIncome: 33_138,
      medicareLevy: 2_800,
      outcomeSigned: 37_688,
    },
    tolerance: { medicareLevySurcharge: 1, outcomeSigned: 1 },
  },
  {
    id: "G27",
    description: "MLS — tier 3 (1.5%), single, no cover, $200,000",
    source:
      "MLS income $200,000 → single tier 3 ($158,001+), 1.5%. Surcharge = 1.5% × $200,000 = $3,000. Tax: $51,638 + 45c × $10,000 = $56,138. Medicare levy: 2% × $200,000 = $4,000. Liability $56,138 + $4,000 + $3,000 = $63,138.",
    input: mk({ income: { salaryWages: 200_000 }, context: { privateHospitalCoverDays: 0 } }),
    expected: {
      medicareLevySurcharge: 3_000,
      taxOnTaxableIncome: 56_138,
      medicareLevy: 4_000,
      outcomeSigned: 63_138,
    },
    tolerance: { medicareLevySurcharge: 1, outcomeSigned: 1 },
  },
  {
    id: "G28",
    description: "MLS — part-year gap, single, 200 days covered / 165 not, $150,000",
    source:
      "MLS income $150,000 → single tier 2, 1.25%. Days without cover = 365 − 200 = 165. Surcharge = 1.25% × $150,000 × 165/365 = $1,875 × 165 / 365 = $847.60. Tax ($150,000, 37% band): $31,288 + 37c × $15,000 = $36,838. Medicare levy $3,000. Liability $36,838 + $3,000 + $847.60 = $40,685.60.",
    input: mk({ income: { salaryWages: 150_000 }, context: { privateHospitalCoverDays: 200 } }),
    expected: {
      medicareLevySurcharge: 847.6,
      taxOnTaxableIncome: 36_838,
      medicareLevy: 3_000,
      outcomeSigned: 40_685.6,
    },
    tolerance: { medicareLevySurcharge: 1, outcomeSigned: 1 },
  },
  {
    id: "G29",
    description: "MLS — partnered, family tier 1, no cover (taxpayer $130,000 + spouse $90,000)",
    source:
      "Combined income for MLS purposes $130,000 + $90,000 = $220,000 → family tier 1 ($202,001–$236,000, no dependent children), rate 1%. Each spouse without cover is surcharged on their own taxable income + RFB: taxpayer 1% × $130,000 = $1,300. Medicare levy: family combined income far exceeds every threshold → full 2% × $130,000 = $2,600. Tax: $4,288 + 30c × $85,000 = $29,788. Liability $29,788 + $2,600 + $1,300 = $33,688.",
    input: mk({
      income: { salaryWages: 130_000 },
      context: { privateHospitalCoverDays: 0, spouseTaxableIncome: 90_000 },
    }),
    expected: {
      medicareLevySurcharge: 1_300,
      medicareLevy: 2_600,
      taxOnTaxableIncome: 29_788,
      mlsIncome: 130_000,
      outcomeSigned: 33_688,
    },
    tolerance: { medicareLevySurcharge: 1, outcomeSigned: 1 },
  },
  {
    id: "G30",
    description:
      "MLS — partnered, family income below the base-tier threshold → nil (taxpayer $120,000 + spouse $60,000)",
    source:
      "Combined MLS income $120,000 + $60,000 = $180,000 ≤ $202,000 family base-tier ceiling → no surcharge even without cover. Medicare levy: full 2% × $120,000 = $2,400. Tax: $4,288 + 30c × $75,000 = $26,788. Liability $26,788 + $2,400 = $29,188.",
    input: mk({
      income: { salaryWages: 120_000 },
      context: { privateHospitalCoverDays: 0, spouseTaxableIncome: 60_000 },
    }),
    expected: {
      medicareLevySurcharge: 0,
      medicareLevy: 2_400,
      taxOnTaxableIncome: 26_788,
      outcomeSigned: 29_188,
    },
  },

  // -------------------------------------------------------------------------
  // Study & training support loan — FR-10, FR-23
  // -------------------------------------------------------------------------
  {
    id: "G31",
    description: "study loan — repayment income exactly at the $67,000 threshold → nil",
    source:
      "2025-26 marginal system: no compulsory repayment when repayment income ≤ $67,000. Tax: $4,288 + 30c × $22,000 = $10,888. Medicare levy: 2% × $67,000 = $1,340. LITO $0 (income ≥ $66,667). Liability $10,888 + $1,340 = $12,228.",
    input: mk({ income: { salaryWages: 67_000 }, context: { holdsStudyLoan: true } }),
    expected: {
      studyLoanRepayment: 0,
      repaymentIncome: 67_000,
      taxOnTaxableIncome: 10_888,
      medicareLevy: 1_340,
      outcomeSigned: 12_228,
    },
  },
  {
    id: "G32",
    description: "study loan — $1 over the threshold ($67,001) → 15c on the $1",
    source:
      "Marginal band 2: 15c × ($67,001 − $67,000) = $0.15. Tax: $10,888 + 30c × $1 = $10,888.30. Medicare levy: 2% × $67,001 = $1,340.02. Liability $10,888.30 + $1,340.02 + $0.15 = $12,228.47.",
    input: mk({ income: { salaryWages: 67_001 }, context: { holdsStudyLoan: true } }),
    expected: {
      studyLoanRepayment: 0.15,
      taxOnTaxableIncome: 10_888.3,
      medicareLevy: 1_340.02,
      outcomeSigned: 12_228.47,
    },
  },
  {
    id: "G33",
    description: "study loan — band-2/band-3 seam at $125,000 (15c → 17c)",
    source:
      "Band 2 top: 15c × ($125,000 − $67,000) = $8,700 (this is exactly the $8,700 base carried into band 3). Tax: $4,288 + 30c × $80,000 = $28,288. Medicare levy: 2% × $125,000 = $2,500. Full-year hospital cover → no surcharge. Liability $28,288 + $2,500 + $8,700 = $39,488.",
    input: mk({
      income: { salaryWages: 125_000 },
      context: { holdsStudyLoan: true, privateHospitalCoverDays: 365 },
    }),
    expected: {
      studyLoanRepayment: 8_700,
      repaymentIncome: 125_000,
      taxOnTaxableIncome: 28_288,
      medicareLevy: 2_500,
      outcomeSigned: 39_488,
    },
  },
  {
    id: "G34",
    description:
      "study loan — marginal/flat seam at $179,286 (→ 10% of the whole repayment income)",
    source:
      "Top band ($179,286+): 10% × $179,286 = $17,928.60 (band 3 would give $8,700 + 17c × $54,285 = $17,928.45 at $179,285 — the flat 10% band takes over $1 higher). Tax: $31,288 + 37c × ($179,286 − $135,000) = $47,673.82. Medicare levy: 2% × $179,286 = $3,585.72. Full-year hospital cover → no surcharge. Liability $47,673.82 + $3,585.72 + $17,928.60 = $69,188.14.",
    input: mk({
      income: { salaryWages: 179_286 },
      context: { holdsStudyLoan: true, privateHospitalCoverDays: 365 },
    }),
    expected: {
      studyLoanRepayment: 17_928.6,
      repaymentIncome: 179_286,
      taxOnTaxableIncome: 47_673.82,
      medicareLevy: 3_585.72,
      outcomeSigned: 69_188.14,
    },
  },

  // -------------------------------------------------------------------------
  // FR-23 income tests + rental cases — FR-8, FR-23, FR-24
  // -------------------------------------------------------------------------
  {
    id: "G35",
    description: "FR-23 — net rental loss cuts taxable income below $67,000 but HELP still applies",
    source:
      "Salary $100,000, net rental loss −$40,000 → taxable income $60,000. Repayment income adds the net rental loss back: $60,000 + $40,000 = $100,000 → study-loan repayment 15c × ($100,000 − $67,000) = $4,950. Tax: $4,288 + 30c × $15,000 = $8,788. LITO: $700 − $375 − 1.5c × ($60,000 − $45,000) = $100. Medicare levy: 2% × $60,000 = $1,200. Liability ($8,788 − $100) + $1,200 + $4,950 = $14,838.",
    input: mk({
      income: { salaryWages: 100_000, netRentalResult: -40_000 },
      context: { holdsStudyLoan: true, privateHospitalCoverDays: 365 },
    }),
    expected: {
      taxableIncome: 60_000,
      repaymentIncome: 100_000,
      studyLoanRepayment: 4_950,
      lowIncomeTaxOffset: 100,
      medicareLevy: 1_200,
      taxOnTaxableIncome: 8_788,
      outcomeSigned: 14_838,
    },
  },
  {
    id: "G36",
    description:
      "negatively geared rental — full return with interest, franked dividends, HELP, PAYG, full cover",
    source:
      "Assessable: salary $95,000 + interest $300 + grossed-up dividends ($1,400 franked + $600 credits) $2,000 + net rental −$8,500 = $88,800. Taxable income $88,800. Tax: $4,288 + 30c × $43,800 = $17,428. LITO $0. Medicare levy: 2% × $88,800 = $1,776. Repayment income: $88,800 + $8,500 loss add-back = $97,300 → study-loan 15c × ($97,300 − $67,000) = $4,545. MLS $0 (full-year cover). Credits: franking $600 + PAYG $22,000 = $22,600. Liability $17,428 + $1,776 + $4,545 = $23,749. Net $23,749 − $22,600 = $1,149 payable.",
    input: mk({
      income: {
        salaryWages: 95_000,
        paygWithheld: 22_000,
        grossInterest: 300,
        dividends: { unfranked: 0, franked: 1_400, frankingCredits: 600 },
        netRentalResult: -8_500,
      },
      context: { holdsStudyLoan: true, privateHospitalCoverDays: 365 },
    }),
    expected: {
      assessableIncomeTotal: 88_800,
      netRental: -8_500,
      taxableIncome: 88_800,
      repaymentIncome: 97_300,
      studyLoanRepayment: 4_545,
      frankingCreditOffset: 600,
      paygWithheldCredit: 22_000,
      medicareLevy: 1_776,
      taxOnTaxableIncome: 17_428,
      totalTaxLiability: 23_749,
      totalCredits: 22_600,
      outcomeSigned: 1_149,
    },
  },
  {
    id: "G37",
    description:
      "positively geared rental — net rental profit adds to taxable income, no loss add-back",
    source:
      "Salary $80,000 + net rental +$12,000 = $92,000 taxable income. Tax: $4,288 + 30c × $47,000 = $18,388. Medicare levy: 2% × $92,000 = $1,840. LITO $0. Repayment income $92,000 (a rental profit is not added back — only a loss is). MLS $0 (full cover). Liability $18,388 + $1,840 = $20,228.",
    input: mk({
      income: { salaryWages: 80_000, netRentalResult: 12_000 },
      context: { privateHospitalCoverDays: 365 },
    }),
    expected: {
      assessableIncomeTotal: 92_000,
      netRental: 12_000,
      taxableIncome: 92_000,
      repaymentIncome: 92_000,
      medicareLevy: 1_840,
      taxOnTaxableIncome: 18_388,
      outcomeSigned: 20_228,
    },
  },
  {
    id: "G38",
    description:
      "rental — capital works + decline in value turn a small cash profit into a net loss",
    source:
      "Rental schedule: gross rent $27,300 − loan interest $19,400 − council rates $1,900 − management/letting fees $2,184 − landlord insurance $1,400 − water $900 = +$1,516 cash, then − capital works (Div 43) $6,100 − decline in value (Div 40) $2,300 = net rental result −$6,884. Salary $105,000 → taxable income $105,000 − $6,884 = $98,116. Tax: $4,288 + 30c × $53,116 = $20,222.80. Medicare levy: 2% × $98,116 = $1,962.32. Repayment income $98,116 + $6,884 = $105,000 → study-loan 15c × ($105,000 − $67,000) = $5,700. MLS $0 (full cover). Credits: PAYG $26,000. Liability $20,222.80 + $1,962.32 + $5,700 = $27,885.12. Net $27,885.12 − $26,000 = $1,885.12 payable.",
    input: mk({
      income: { salaryWages: 105_000, paygWithheld: 26_000, netRentalResult: -6_884 },
      context: { holdsStudyLoan: true, privateHospitalCoverDays: 365 },
    }),
    expected: {
      netRental: -6_884,
      taxableIncome: 98_116,
      repaymentIncome: 105_000,
      studyLoanRepayment: 5_700,
      medicareLevy: 1_962.32,
      taxOnTaxableIncome: 20_222.8,
      outcomeSigned: 1_885.12,
    },
  },
  {
    id: "G39",
    description:
      "MLS — net rental loss add-back lifts the surcharge tier, but the surcharge is levied on taxable income only",
    source:
      "Salary $120,000, net rental loss −$25,000 → taxable income $95,000. Income for MLS purposes adds the loss back: $95,000 + $25,000 = $120,000 → single tier 2 (1.25%). The surcharge itself is 1.25% of (taxable income $95,000 + RFB $0) = $1,187.50 (ATO M2: the surcharge base is taxable income + reportable fringe benefits, not the grossed-up MLS income). Tax: $4,288 + 30c × $50,000 = $19,288. Medicare levy: 2% × $95,000 = $1,900. Liability $19,288 + $1,900 + $1,187.50 = $22,375.50.",
    input: mk({
      income: { salaryWages: 120_000, netRentalResult: -25_000 },
      context: { privateHospitalCoverDays: 0 },
    }),
    expected: {
      mlsIncome: 120_000,
      medicareLevySurcharge: 1_187.5,
      taxableIncome: 95_000,
      taxOnTaxableIncome: 19_288,
      medicareLevy: 1_900,
      outcomeSigned: 22_375.5,
    },
    tolerance: { medicareLevySurcharge: 1, outcomeSigned: 1 },
  },

  // -------------------------------------------------------------------------
  // Franking-credit offset — excess vs partial — FR-11
  // -------------------------------------------------------------------------
  {
    id: "G40",
    description: "franking credits — partial offset (credits less than the tax liability)",
    source:
      "Salary $90,000 + grossed-up dividends ($7,000 franked + $3,000 credits) = $100,000 taxable income. Tax: $4,288 + 30c × $55,000 = $20,788. Medicare levy: 2% × $100,000 = $2,000. MLS $0 (full cover, and base tier anyway). Refundable franking offset $3,000. Liability $22,788 − $3,000 = $19,788 payable.",
    input: mk({
      income: {
        salaryWages: 90_000,
        dividends: { unfranked: 0, franked: 7_000, frankingCredits: 3_000 },
      },
      context: { privateHospitalCoverDays: 365 },
    }),
    expected: {
      assessableIncomeTotal: 100_000,
      frankingCreditOffset: 3_000,
      taxOnTaxableIncome: 20_788,
      medicareLevy: 2_000,
      totalCredits: 3_000,
      outcomeSigned: 19_788,
    },
  },
  {
    id: "G41",
    description: "franking credits — excess offset (refund exceeds the tax), no other income",
    source:
      "Only income is dividends: $1,000 franked + $30,000 credits = $31,000 taxable income. Tax: 16c × ($31,000 − $18,200) = $2,048. LITO $700 → tax after offsets $1,348. Medicare levy shade-in: 10c × ($31,000 − $28,011) = $298.90. Liability $1,348 + $298.90 = $1,646.90. Refundable franking credits $30,000 → refund $30,000 − $1,646.90 = $28,353.10.",
    input: mk({
      income: { dividends: { unfranked: 0, franked: 1_000, frankingCredits: 30_000 } },
    }),
    expected: {
      frankingCreditOffset: 30_000,
      lowIncomeTaxOffset: 700,
      taxOnTaxableIncome: 2_048,
      medicareLevy: 298.9,
      taxAfterNonRefundableOffsets: 1_348,
      totalTaxLiability: 1_646.9,
      outcomeSigned: -28_353.1,
    },
  },

  // -------------------------------------------------------------------------
  // Private health insurance rebate reconciliation — FR-11 (≤ $1 tolerance)
  // -------------------------------------------------------------------------
  {
    id: "G42",
    description: "PHI rebate — refundable top-up (rebate received is below the entitlement)",
    source:
      "Single, income for rebate purposes $80,000 → base tier; oldest person 42 → under-65 rates. Eligible premium $2,400 apportioned across the two adjustment periods by days in the income year: 274/365 → $1,801.64 at 24.288%, 91/365 → $598.36 at 24.118%. Entitlement = $437.58 + $144.31 = $581.89. Rebate received $300 → top-up $281.89 (refundable). Tax: $4,288 + 30c × $35,000 = $14,788. Medicare levy 2% × $80,000 = $1,600. Liability $16,388 − $281.89 = $16,106.11 payable. ≤ $1 tolerance (rebate percentages / day-apportionment).",
    input: mk({
      income: {
        salaryWages: 80_000,
        privateHealth: {
          premiumsEligibleForRebate: 2_400,
          rebateReceived: 300,
          oldestCoveredPersonAge: 42,
        },
      },
      context: { privateHospitalCoverDays: 365 },
    }),
    expected: {
      phiRebateEntitlement: 581.89,
      phiRebateAdjustment: 281.89,
      taxOnTaxableIncome: 14_788,
      medicareLevy: 1_600,
      outcomeSigned: 16_106.11,
    },
    tolerance: { phiRebateEntitlement: 1, phiRebateAdjustment: 1, outcomeSigned: 1 },
  },
  {
    id: "G43",
    description: "PHI rebate — excess-rebate recovery (rebate received exceeds the entitlement)",
    source:
      "Same policy and income as G42 → entitlement $581.89. Rebate received $2,000 → excess $581.89 − $2,000 = −$1,418.11, recovered as extra tax. Liability $16,388 − (−$1,418.11) = $17,806.11 payable. ≤ $1 tolerance.",
    input: mk({
      income: {
        salaryWages: 80_000,
        privateHealth: {
          premiumsEligibleForRebate: 2_400,
          rebateReceived: 2_000,
          oldestCoveredPersonAge: 42,
        },
      },
      context: { privateHospitalCoverDays: 365 },
    }),
    expected: { phiRebateAdjustment: -1_418.11, outcomeSigned: 17_806.11 },
    tolerance: { phiRebateAdjustment: 1, outcomeSigned: 1 },
  },

  // -------------------------------------------------------------------------
  // Medicare levy — family basis, no reduction above the family reduction range
  // -------------------------------------------------------------------------
  {
    id: "G44",
    description:
      "Medicare levy — partnered taxpayer, family income well above the threshold → full 2% levy",
    source:
      "Taxpayer taxable income $32,000, spouse $70,000 → family income $102,000. ATO 'Medicare levy reduction – family income' / Medicare Levy Act 1986 s8: the family reduction phases out just above the $47,238 family lower threshold and is nil by ~$50,100 of family income; a person with a spouse is assessed on the family basis and does not retain the single low-income shade-in. Medicare levy = full 2% × $32,000 = $640.00. Tax: 16c × ($32,000 − $18,200) = $2,208; LITO $700 → tax after offsets $1,508. Liability $1,508 + $640 = $2,148.00.",
    input: mk({
      income: { salaryWages: 32_000 },
      context: { spouseTaxableIncome: 70_000, privateHospitalCoverDays: 365 },
    }),
    expected: { medicareLevy: 640, outcomeSigned: 2_148 },
  },
];
