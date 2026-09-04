/**
 * 2025-26 Australian individual-tax parameter set (1 July 2025 – 30 June 2026).
 *
 * AI-researched from ato.gov.au on 2026-09-04. **Every figure must be verified
 * by a human against ato.gov.au and the ATO online tax estimator before the
 * golden set (T5) is trusted** — see `../../VERIFY-2025-26.md`.
 *
 * Figures flagged `unverified: true` could not be confirmed from an
 * authoritative, year-stamped ato.gov.au page and need particular attention.
 */
import type { TaxParams } from "../types";

const VERIFIED_ON = "2026-09-04";

// Canonical ato.gov.au source URLs, referenced by the figure groups below.
const SRC = {
  residentRates: "https://www.ato.gov.au/tax-rates-and-codes/tax-rates-australian-residents",
  medicareLevySingle:
    "https://www.ato.gov.au/individuals-and-families/medicare-and-private-health-insurance/medicare-levy/medicare-levy-reduction/medicare-levy-reduction-for-low-income-earners",
  medicareLevyFamily:
    "https://www.ato.gov.au/individuals-and-families/medicare-and-private-health-insurance/medicare-levy/medicare-levy-reduction/medicare-levy-reduction-family-income",
  medicareLevySurcharge:
    "https://www.ato.gov.au/individuals-and-families/medicare-and-private-health-insurance/medicare-levy-surcharge/medicare-levy-surcharge-income-thresholds-and-rates",
  privateHealthRebate:
    "https://www.ato.gov.au/individuals-and-families/medicare-and-private-health-insurance/private-health-insurance-rebate/income-thresholds-and-rates-for-the-private-health-insurance-rebate",
  lowIncomeTaxOffset:
    "https://www.ato.gov.au/individuals-and-families/income-deductions-offsets-and-records/tax-offsets/low-income-tax-offset",
  beneficiaryTaxOffset:
    "https://www.ato.gov.au/individuals-and-families/income-deductions-offsets-and-records/tax-offsets/beneficiary-tax-offset",
  studyLoan:
    "https://www.ato.gov.au/tax-rates-and-codes/study-and-training-support-loans-rates-and-repayment-thresholds",
  taxReturnInstructions:
    "https://www.ato.gov.au/forms-and-instructions/individual-tax-return-2026-instructions",
} as const;

export const params202526: TaxParams = {
  meta: {
    targetYear: "2025-26",
    incomeYearStart: "2025-07-01",
    incomeYearEnd: "2026-06-30",
    paramsVersion: "2025-26.1",
    researchedOn: VERIFIED_ON,
    disclaimer:
      "AI-researched from ato.gov.au and pending human verification (see VERIFY-2025-26.md). Not tax advice.",
  },

  // -------------------------------------------------------------------------
  // Resident individual income tax rates 2025-26 (unchanged from 2024-25).
  // ato.gov.au "Tax rates – Australian resident", table "Resident tax rates
  // 2025-26" (page last updated 13 August 2026).
  // -------------------------------------------------------------------------
  residentRates: {
    source: SRC.residentRates,
    verifiedOn: VERIFIED_ON,
    note: "Same scale as 2024-25. The 16% band drops to 15% for 2026-27 and 14% for 2027-28 (legislated) — a future dataset, not this one.",
    value: [
      { incomeOver: 0, baseTax: 0, rate: 0, upTo: 18200 },
      { incomeOver: 18200, baseTax: 0, rate: 0.16, upTo: 45000 },
      { incomeOver: 45000, baseTax: 4288, rate: 0.3, upTo: 135000 },
      { incomeOver: 135000, baseTax: 31288, rate: 0.37, upTo: 190000 },
      { incomeOver: 190000, baseTax: 51638, rate: 0.45, upTo: null },
    ],
  },

  // -------------------------------------------------------------------------
  // Medicare levy 2025-26. Rate and thresholds from the "Medicare levy
  // reduction" pages (single + family). The shade-in rate is not quoted
  // verbatim by the ATO; it is 0.10 — each upper threshold is exactly 1.25x
  // its lower threshold, which only holds when 0.10*(upper-lower) == 0.02*upper.
  // -------------------------------------------------------------------------
  medicareLevy: {
    source: SRC.medicareLevySingle,
    verifiedOn: VERIFIED_ON,
    note: `Family thresholds and per-child increments from ${SRC.medicareLevyFamily}. shadeInRate (0.10) is derived from the ATO thresholds, not quoted — verify against the ATO Medicare levy calculator.`,
    value: {
      rate: 0.02,
      shadeInRate: 0.1,
      single: { lower: 28011, upper: 35013 },
      singleSeniorPensioner: { lower: 44268, upper: 55335 },
      family: { lower: 47238, upper: 59047 },
      familySeniorPensioner: { lower: 61623, upper: 77028 },
      familyChildIncrement: { lower: 4338, upper: 5423 },
    },
  },

  // -------------------------------------------------------------------------
  // Medicare levy surcharge 2025-26. ato.gov.au "Medicare levy surcharge
  // income, thresholds and rates", table "MLS income thresholds and rates for
  // 2025-26". Tested against "income for MLS purposes" (FR-23), not bare
  // taxable income.
  // -------------------------------------------------------------------------
  medicareLevySurcharge: {
    source: SRC.medicareLevySurcharge,
    verifiedOn: VERIFIED_ON,
    value: {
      familyChildIncrement: 1500,
      tiers: [
        {
          tier: "base",
          singleFrom: 0,
          singleTo: 101000,
          familyFrom: 0,
          familyTo: 202000,
          rate: 0,
        },
        {
          tier: "tier1",
          singleFrom: 101001,
          singleTo: 118000,
          familyFrom: 202001,
          familyTo: 236000,
          rate: 0.01,
        },
        {
          tier: "tier2",
          singleFrom: 118001,
          singleTo: 158000,
          familyFrom: 236001,
          familyTo: 316000,
          rate: 0.0125,
        },
        {
          tier: "tier3",
          singleFrom: 158001,
          singleTo: null,
          familyFrom: 316001,
          familyTo: null,
          rate: 0.015,
        },
      ],
    },
  },

  // -------------------------------------------------------------------------
  // Private health insurance rebate 2025-26. ato.gov.au "Income thresholds and
  // rates for the private health insurance rebate", "2025-26 income thresholds
  // and rebate rates". Two rebate-adjustment periods — the percentage is
  // re-indexed on 1 April 2026. Income thresholds match the MLS thresholds.
  // Percentages are stored exactly as the ATO states them (e.g. 24.288).
  // -------------------------------------------------------------------------
  privateHealthRebate: {
    source: SRC.privateHealthRebate,
    verifiedOn: VERIFIED_ON,
    value: {
      familyChildIncrement: 1500,
      incomeTiers: [
        {
          tier: "base",
          singleFrom: 0,
          singleTo: 101000,
          familyFrom: 0,
          familyTo: 202000,
        },
        {
          tier: "tier1",
          singleFrom: 101001,
          singleTo: 118000,
          familyFrom: 202001,
          familyTo: 236000,
        },
        {
          tier: "tier2",
          singleFrom: 118001,
          singleTo: 158000,
          familyFrom: 236001,
          familyTo: 316000,
        },
        {
          tier: "tier3",
          singleFrom: 158001,
          singleTo: null,
          familyFrom: 316001,
          familyTo: null,
        },
      ],
      periods: [
        {
          label: "1 July 2025 to 31 March 2026",
          startDate: "2025-07-01",
          endDate: "2026-03-31",
          rebatePercent: {
            under65: { base: 24.288, tier1: 16.192, tier2: 8.095, tier3: 0 },
            "65to69": { base: 28.337, tier1: 20.24, tier2: 12.143, tier3: 0 },
            "70plus": { base: 32.385, tier1: 24.288, tier2: 16.192, tier3: 0 },
          },
        },
        {
          label: "1 April 2026 to 30 June 2026",
          startDate: "2026-04-01",
          endDate: "2026-06-30",
          rebatePercent: {
            under65: { base: 24.118, tier1: 16.079, tier2: 8.038, tier3: 0 },
            "65to69": { base: 28.139, tier1: 20.098, tier2: 12.058, tier3: 0 },
            "70plus": { base: 32.158, tier1: 24.118, tier2: 16.079, tier3: 0 },
          },
        },
      ],
    },
  },

  // -------------------------------------------------------------------------
  // Low Income Tax Offset. ato.gov.au "Low income tax offset". The page is not
  // year-stamped, but these figures have applied unchanged since 2022-23.
  // -------------------------------------------------------------------------
  lowIncomeTaxOffset: {
    source: SRC.lowIncomeTaxOffset,
    verifiedOn: VERIFIED_ON,
    note: "The ATO LITO page is not stamped with an income year. Figures unchanged since 2022-23. Confirm they still apply for 2025-26.",
    value: {
      maxOffset: 700,
      fullOffsetUpTo: 37500,
      tapers: [
        { incomeOver: 37500, incomeUpTo: 45000, rate: 0.05 },
        { incomeOver: 45000, incomeUpTo: 66667, rate: 0.015 },
      ],
      cutOut: 66667,
    },
  },

  // -------------------------------------------------------------------------
  // Beneficiary tax offset. The ATO no longer publishes the formula on a
  // content page — it is embedded in the ATO beneficiary/SAPTO calculator and
  // the Income Tax Regulations 1936 reg 13. The formula below (rates 0.15 /
  // 0.15, $6,000 tax-free amount, $45,000 second-component threshold) is the
  // long-standing form used since 2020-21, when the second threshold moved
  // from $37,000 to $45,000 with the lowest marginal band.
  // -------------------------------------------------------------------------
  beneficiaryTaxOffset: {
    source: SRC.beneficiaryTaxOffset,
    verifiedOn: VERIFIED_ON,
    unverified: true,
    note: "Formula NOT stated on a year-stamped ato.gov.au page. Verify every parameter against the ATO 'Beneficiary tax offset and seniors and pensioners tax offset calculator' for 2025-26 (esp. that the second-component rate is still 0.15 after the 16% rate change).",
    value: {
      taxFreeAmount: 6000,
      firstComponentRate: 0.15,
      secondComponentThreshold: 45000,
      secondComponentRate: 0.15,
    },
  },

  // -------------------------------------------------------------------------
  // Study and training support loan (HELP, VSL, SFSS, SSL, ABSTUDY SSL, AASL)
  // compulsory repayment 2025-26. ato.gov.au "Study and training loan
  // repayment thresholds and rates", "Table 2: 2025-26 repayment thresholds
  // and rates" (page last updated 30 June 2026).
  //
  // NEW for 2025-26: repayments are MARGINAL (charged only on repayment income
  // above the minimum threshold), and the minimum threshold rose to $67,000
  // (from $54,435 in 2024-25). 2024-25 and earlier used a flat rate on the
  // whole repayment income.
  // -------------------------------------------------------------------------
  studyLoan: {
    source: SRC.studyLoan,
    verifiedOn: VERIFIED_ON,
    note: "System changed for 2025-26: marginal repayment + raised $67,000 minimum threshold. Applied to FR-23 repayment income (whole dollars), not bare taxable income.",
    value: {
      system: "marginal",
      minRepaymentThreshold: 67000,
      bands: [
        {
          incomeFrom: 0,
          incomeTo: 67000,
          baseRepayment: 0,
          marginalRate: 0,
          marginalOver: 0,
          flatRateOnTotal: null,
        },
        {
          incomeFrom: 67001,
          incomeTo: 125000,
          baseRepayment: 0,
          marginalRate: 0.15,
          marginalOver: 67000,
          flatRateOnTotal: null,
        },
        {
          incomeFrom: 125001,
          incomeTo: 179285,
          baseRepayment: 8700,
          marginalRate: 0.17,
          marginalOver: 125000,
          flatRateOnTotal: null,
        },
        {
          incomeFrom: 179286,
          incomeTo: null,
          baseRepayment: 0,
          marginalRate: 0,
          marginalOver: 0,
          flatRateOnTotal: 0.1,
        },
      ],
    },
  },

  // -------------------------------------------------------------------------
  // Rounding rules (PRD FR-15 / FR-13). The whole-dollar taxable income rule is
  // standard ATO practice ("Amounts you show on your tax return … do not show
  // cents"); the split of which amounts keep cents is set by the PRD.
  // -------------------------------------------------------------------------
  rounding: {
    source: SRC.taxReturnInstructions,
    verifiedOn: VERIFIED_ON,
    note: "Encodes PRD FR-15. The whole-dollar taxable income rule is ATO practice; confirm the cents/whole-dollar split against a worked ATO notice of assessment.",
    value: {
      taxableIncome: "floor-to-whole-dollar",
      taxLeviesAndOffsets: "computed-on-whole-dollar-taxable-income",
      frankingCreditsAndWithholding: "keep-cents",
      finalResult: "keep-cents",
      studyLoanRepaymentIncome: "floor-to-whole-dollar",
      notes: [
        "Taxable income = assessable income − deductions, then rounded DOWN to a whole dollar before any tax, levy, surcharge or offset is worked out.",
        "Income tax, Medicare levy, Medicare levy surcharge, LITO and the beneficiary tax offset are all computed on that whole-dollar taxable income.",
        "Franking credits (item 11 label U) and PAYG amounts withheld are carried to the cent.",
        "The final assessed result (refund or amount owing) is expressed to the cent.",
        "The compulsory study/training-loan repayment is worked out on whole-dollar repayment income (FR-23).",
      ],
    },
  },
};
