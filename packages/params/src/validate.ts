/**
 * Runtime validator for a curated {@link YearDataset} — plain TypeScript, zero
 * dependencies. Catches transcription mistakes the type system can't: missing
 * figures, mis-ordered brackets, non-contiguous bands, a source URL that isn't
 * ato.gov.au, a malformed verification date, rebate periods that don't cover
 * the income year.
 *
 * It does **not** check that a figure matches the ATO — that is a human job
 * (`VERIFY-<year>.md`) and the golden set (T5).
 */
import type {
  LabelTaxonomy,
  MyTaxSection,
  Provenance,
  Sourced,
  TaxParams,
  YearDataset,
} from "./types";

export interface ValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
  /** Figure groups flagged `unverified` — not errors, but must be checked by a human. */
  readonly unverified: readonly string[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const YEAR_RE = /^\d{4}-\d{2}$/;

const EXPECTED_SECTION_ORDER: readonly MyTaxSection[] = [
  "personalise",
  "income",
  "deductions",
  "tax-losses",
  "tax-offsets",
  "adjustments",
  "medicare-and-phi",
  "spouse-and-income-tests",
  "estimate",
];

/** Label codes the return model (T6) and the engine (T3/T4) rely on existing. */
const REQUIRED_LABEL_CODES: readonly string[] = [
  "1",
  "5",
  "10L",
  "11S",
  "11T",
  "11U",
  "D1",
  "D5",
  "D9",
  "D10",
  "21",
  "M1",
  "M2",
  "IT1",
  "IT2",
  "IT6",
];

class Checker {
  readonly errors: string[] = [];
  readonly unverified: string[] = [];

  check(condition: boolean, message: string): void {
    if (!condition) this.errors.push(message);
  }

  provenance(label: string, p: Provenance): void {
    this.check(
      typeof p.source === "string" && p.source.includes("ato.gov.au"),
      `${label}: source must be an ato.gov.au URL (got ${JSON.stringify(p.source)})`,
    );
    this.check(
      typeof p.verifiedOn === "string" && DATE_RE.test(p.verifiedOn),
      `${label}: verifiedOn must be a YYYY-MM-DD date (got ${JSON.stringify(p.verifiedOn)})`,
    );
    if (p.unverified) this.unverified.push(`${label}${p.note ? ` — ${p.note}` : ""}`);
  }

  sourced<T>(label: string, s: Sourced<T> | undefined): s is Sourced<T> {
    if (s === undefined || s === null) {
      this.errors.push(`${label}: missing`);
      return false;
    }
    this.provenance(label, s);
    if (s.value === undefined || s.value === null) {
      this.errors.push(`${label}.value: missing`);
      return false;
    }
    return true;
  }
}

function validateParams(c: Checker, params: TaxParams): void {
  const m = params.meta;
  c.check(!!m && YEAR_RE.test(m.targetYear), "meta.targetYear must look like 2025-26");
  if (m) {
    c.check(DATE_RE.test(m.incomeYearStart), "meta.incomeYearStart must be YYYY-MM-DD");
    c.check(DATE_RE.test(m.incomeYearEnd), "meta.incomeYearEnd must be YYYY-MM-DD");
    c.check(
      typeof m.paramsVersion === "string" && m.paramsVersion.startsWith(m.targetYear),
      "meta.paramsVersion must start with the target year",
    );
    c.check(DATE_RE.test(m.researchedOn), "meta.researchedOn must be YYYY-MM-DD");
    c.check(!!m.disclaimer && m.disclaimer.length > 0, "meta.disclaimer must be set");
  }

  // --- resident income tax scale ---
  if (c.sourced("residentRates", params.residentRates)) {
    const b = params.residentRates.value;
    c.check(b.length >= 2, "residentRates: expected at least 2 bands");
    c.check(b[0]?.incomeOver === 0, "residentRates: first band must start at incomeOver 0");
    c.check(b[0]?.rate === 0, "residentRates: first band (tax-free) must have rate 0");
    for (let i = 0; i < b.length; i++) {
      const band = b[i]!;
      c.check(
        band.rate >= 0 && band.rate < 1,
        `residentRates[${i}].rate must be a fraction in [0, 1)`,
      );
      c.check(band.baseTax >= 0, `residentRates[${i}].baseTax must be >= 0`);
      const next = b[i + 1];
      if (next) {
        c.check(
          next.incomeOver > band.incomeOver,
          `residentRates[${i + 1}].incomeOver must exceed the previous band`,
        );
        c.check(
          band.upTo === next.incomeOver,
          `residentRates[${i}].upTo (${band.upTo}) must equal the next band's incomeOver (${next.incomeOver})`,
        );
        c.check(
          next.baseTax >= band.baseTax,
          `residentRates[${i + 1}].baseTax must be >= the previous band`,
        );
      } else {
        c.check(band.upTo === null, "residentRates: the top band must have upTo === null");
      }
    }
  }

  // --- Medicare levy ---
  if (c.sourced("medicareLevy", params.medicareLevy)) {
    const ml = params.medicareLevy.value;
    c.check(ml.rate > 0 && ml.rate < 1, "medicareLevy.rate must be a fraction in (0, 1)");
    c.check(
      ml.shadeInRate > 0 && ml.shadeInRate < 1,
      "medicareLevy.shadeInRate must be a fraction in (0, 1)",
    );
    for (const key of [
      "single",
      "singleSeniorPensioner",
      "family",
      "familySeniorPensioner",
      "familyChildIncrement",
    ] as const) {
      const band = ml[key];
      c.check(!!band, `medicareLevy.${key} must be set`);
      if (band) {
        c.check(band.lower >= 0, `medicareLevy.${key}.lower must be >= 0`);
        c.check(band.upper > band.lower, `medicareLevy.${key}.upper must exceed lower`);
      }
    }
  }

  // --- Medicare levy surcharge ---
  if (c.sourced("medicareLevySurcharge", params.medicareLevySurcharge)) {
    const mls = params.medicareLevySurcharge.value;
    c.check(mls.familyChildIncrement > 0, "medicareLevySurcharge.familyChildIncrement must be > 0");
    const tiers = mls.tiers;
    c.check(tiers.length === 4, "medicareLevySurcharge: expected 4 tiers (base + 3)");
    const names = ["base", "tier1", "tier2", "tier3"];
    for (let i = 0; i < tiers.length; i++) {
      const t = tiers[i]!;
      c.check(t.tier === names[i], `medicareLevySurcharge.tiers[${i}].tier must be ${names[i]}`);
      c.check(t.rate >= 0 && t.rate < 0.1, `medicareLevySurcharge.tiers[${i}].rate out of range`);
      const prev = tiers[i - 1];
      if (prev) {
        c.check(t.rate >= prev.rate, `medicareLevySurcharge.tiers[${i}].rate must not decrease`);
        c.check(
          prev.singleTo !== null && t.singleFrom === prev.singleTo + 1,
          `medicareLevySurcharge.tiers[${i}]: single range must be contiguous with the previous tier`,
        );
        c.check(
          prev.familyTo !== null && t.familyFrom === prev.familyTo + 1,
          `medicareLevySurcharge.tiers[${i}]: family range must be contiguous with the previous tier`,
        );
      }
      if (i === tiers.length - 1) {
        c.check(
          t.singleTo === null && t.familyTo === null,
          "medicareLevySurcharge: the top tier must be open-ended (singleTo/familyTo null)",
        );
      }
    }
    c.check(tiers[0]?.rate === 0, "medicareLevySurcharge: the base tier rate must be 0");
  }

  // --- private health insurance rebate ---
  if (c.sourced("privateHealthRebate", params.privateHealthRebate)) {
    const phi = params.privateHealthRebate.value;
    c.check(phi.familyChildIncrement > 0, "privateHealthRebate.familyChildIncrement must be > 0");
    c.check(phi.incomeTiers.length === 4, "privateHealthRebate: expected 4 income tiers");
    c.check(phi.periods.length === 2, "privateHealthRebate: expected 2 rebate-adjustment periods");
    const ages = ["under65", "65to69", "70plus"] as const;
    const tierKeys = ["base", "tier1", "tier2", "tier3"] as const;
    for (let i = 0; i < phi.periods.length; i++) {
      const p = phi.periods[i]!;
      c.check(
        DATE_RE.test(p.startDate),
        `privateHealthRebate.periods[${i}].startDate must be YYYY-MM-DD`,
      );
      c.check(
        DATE_RE.test(p.endDate),
        `privateHealthRebate.periods[${i}].endDate must be YYYY-MM-DD`,
      );
      c.check(
        p.startDate < p.endDate,
        `privateHealthRebate.periods[${i}]: startDate must precede endDate`,
      );
      for (const age of ages) {
        const row = p.rebatePercent[age];
        c.check(!!row, `privateHealthRebate.periods[${i}].rebatePercent.${age} must be set`);
        if (row) {
          for (const tk of tierKeys) {
            const v = row[tk];
            c.check(
              typeof v === "number" && v >= 0 && v <= 100,
              `privateHealthRebate.periods[${i}].rebatePercent.${age}.${tk} must be a percentage 0..100`,
            );
          }
          c.check(
            row.tier3 === 0,
            `privateHealthRebate.periods[${i}].rebatePercent.${age}.tier3 must be 0 (no rebate above the top threshold)`,
          );
        }
      }
    }
    const [first, second] = phi.periods;
    if (first && second) {
      c.check(
        first.endDate < second.startDate,
        "privateHealthRebate: the two periods must not overlap",
      );
      c.check(
        first.startDate === params.meta.incomeYearStart &&
          second.endDate === params.meta.incomeYearEnd,
        "privateHealthRebate: the periods must span the whole income year",
      );
    }
  }

  // --- low income tax offset ---
  if (c.sourced("lowIncomeTaxOffset", params.lowIncomeTaxOffset)) {
    const lito = params.lowIncomeTaxOffset.value;
    c.check(lito.maxOffset > 0, "lowIncomeTaxOffset.maxOffset must be > 0");
    c.check(
      lito.fullOffsetUpTo > 0 && lito.fullOffsetUpTo < lito.cutOut,
      "lowIncomeTaxOffset.fullOffsetUpTo must be > 0 and < cutOut",
    );
    c.check(lito.tapers.length >= 1, "lowIncomeTaxOffset: expected at least one taper");
    let prevEnd = lito.fullOffsetUpTo;
    for (let i = 0; i < lito.tapers.length; i++) {
      const t = lito.tapers[i]!;
      c.check(t.rate > 0 && t.rate < 1, `lowIncomeTaxOffset.tapers[${i}].rate must be in (0, 1)`);
      c.check(
        t.incomeOver === prevEnd,
        `lowIncomeTaxOffset.tapers[${i}].incomeOver must be contiguous with the previous band (${prevEnd})`,
      );
      c.check(
        t.incomeUpTo > t.incomeOver,
        `lowIncomeTaxOffset.tapers[${i}].incomeUpTo must exceed incomeOver`,
      );
      prevEnd = t.incomeUpTo;
    }
    c.check(
      prevEnd === lito.cutOut,
      `lowIncomeTaxOffset: the last taper must end at the cut-out (${lito.cutOut})`,
    );
    const totalTaper = lito.tapers.reduce(
      (acc, t) => acc + (t.incomeUpTo - t.incomeOver) * t.rate,
      0,
    );
    c.check(
      Math.abs(totalTaper - lito.maxOffset) <= 1,
      `lowIncomeTaxOffset: taper amounts (${totalTaper.toFixed(2)}) should reduce the max offset (${lito.maxOffset}) to ~0`,
    );
  }

  // --- beneficiary tax offset ---
  if (c.sourced("beneficiaryTaxOffset", params.beneficiaryTaxOffset)) {
    const b = params.beneficiaryTaxOffset.value;
    c.check(b.taxFreeAmount >= 0, "beneficiaryTaxOffset.taxFreeAmount must be >= 0");
    c.check(
      b.secondComponentThreshold > b.taxFreeAmount,
      "beneficiaryTaxOffset.secondComponentThreshold must exceed taxFreeAmount",
    );
    c.check(
      b.firstComponentRate > 0 && b.firstComponentRate < 1,
      "beneficiaryTaxOffset.firstComponentRate must be in (0, 1)",
    );
    c.check(
      b.secondComponentRate > 0 && b.secondComponentRate < 1,
      "beneficiaryTaxOffset.secondComponentRate must be in (0, 1)",
    );
  }

  // --- study and training loan ---
  if (c.sourced("studyLoan", params.studyLoan)) {
    const sl = params.studyLoan.value;
    c.check(
      sl.system === "marginal" || sl.system === "flat-rate",
      "studyLoan.system must be 'marginal' or 'flat-rate'",
    );
    c.check(sl.minRepaymentThreshold > 0, "studyLoan.minRepaymentThreshold must be > 0");
    c.check(sl.bands.length >= 2, "studyLoan: expected at least 2 bands");
    c.check(sl.bands[0]?.incomeFrom === 0, "studyLoan: first band must start at incomeFrom 0");
    c.check(
      sl.bands[0]?.baseRepayment === 0 && sl.bands[0]?.marginalRate === 0,
      "studyLoan: first band (below the minimum threshold) must be nil",
    );
    let flatBands = 0;
    for (let i = 0; i < sl.bands.length; i++) {
      const band = sl.bands[i]!;
      c.check(
        band.marginalRate >= 0 && band.marginalRate < 1,
        `studyLoan.bands[${i}].marginalRate must be in [0, 1)`,
      );
      if (band.flatRateOnTotal !== null) {
        flatBands++;
        c.check(
          band.flatRateOnTotal > 0 && band.flatRateOnTotal < 1,
          `studyLoan.bands[${i}].flatRateOnTotal must be in (0, 1)`,
        );
      }
      const next = sl.bands[i + 1];
      if (next) {
        c.check(
          band.incomeTo !== null && next.incomeFrom === band.incomeTo + 1,
          `studyLoan.bands[${i}]: income range must be contiguous with the next band`,
        );
      } else {
        c.check(band.incomeTo === null, "studyLoan: the top band must have incomeTo === null");
      }
    }
    c.check(flatBands <= 1, "studyLoan: at most one band may set flatRateOnTotal");
    c.check(
      sl.bands[1]?.incomeFrom === sl.minRepaymentThreshold + 1,
      "studyLoan: the second band must begin one dollar above the minimum repayment threshold",
    );
  }

  // --- rounding ---
  if (c.sourced("rounding", params.rounding)) {
    const r = params.rounding.value;
    c.check(
      r.taxableIncome === "floor-to-whole-dollar",
      "rounding.taxableIncome is not as expected",
    );
    c.check(
      r.taxLeviesAndOffsets === "computed-on-whole-dollar-taxable-income",
      "rounding.taxLeviesAndOffsets is not as expected",
    );
    c.check(
      r.frankingCreditsAndWithholding === "keep-cents",
      "rounding.frankingCreditsAndWithholding is not as expected",
    );
    c.check(r.finalResult === "keep-cents", "rounding.finalResult is not as expected");
    c.check(
      r.studyLoanRepaymentIncome === "floor-to-whole-dollar",
      "rounding.studyLoanRepaymentIncome is not as expected",
    );
    c.check(r.notes.length > 0, "rounding.notes must not be empty");
  }
}

function validateTaxonomy(c: Checker, taxonomy: LabelTaxonomy): void {
  c.provenance("taxonomy", taxonomy);

  const order = taxonomy.myTaxSectionOrder;
  c.check(
    order.length === EXPECTED_SECTION_ORDER.length &&
      order.every((s, i) => s === EXPECTED_SECTION_ORDER[i]),
    `taxonomy.myTaxSectionOrder must be the canonical myTax order: ${EXPECTED_SECTION_ORDER.join(" > ")}`,
  );

  c.check(taxonomy.labels.length > 0, "taxonomy.labels must not be empty");
  const seen = new Set<string>();
  const validSections = new Set<string>(EXPECTED_SECTION_ORDER);
  for (const l of taxonomy.labels) {
    c.check(!seen.has(l.code), `taxonomy.labels: duplicate code ${l.code}`);
    seen.add(l.code);
    c.check(!!l.name, `taxonomy.labels[${l.code}].name must be set`);
    c.check(
      validSections.has(l.section),
      `taxonomy.labels[${l.code}].section '${l.section}' is not a myTax section`,
    );
    c.check(
      l.form === "main" || l.form === "supplement",
      `taxonomy.labels[${l.code}].form must be 'main' or 'supplement'`,
    );
  }
  for (const code of REQUIRED_LABEL_CODES) {
    c.check(seen.has(code), `taxonomy.labels: required label '${code}' is missing`);
  }

  // --- rental property schedule (item 21) ---
  const rs = taxonomy.rentalSchedule;
  c.check(rs.length > 0, "taxonomy.rentalSchedule must not be empty");
  const rsKeys = new Set<string>();
  const validPaper = new Set(["P", "Q", "F", "U", "net"]);
  for (const line of rs) {
    c.check(!rsKeys.has(line.key), `taxonomy.rentalSchedule: duplicate key ${line.key}`);
    rsKeys.add(line.key);
    c.check(!!line.name, `taxonomy.rentalSchedule[${line.key}].name must be set`);
    c.check(
      validPaper.has(line.paperLabel),
      `taxonomy.rentalSchedule[${line.key}].paperLabel '${line.paperLabel}' invalid`,
    );
    c.check(
      line.kind === "income" || line.kind === "deduction" || line.kind === "computed",
      `taxonomy.rentalSchedule[${line.key}].kind invalid`,
    );
  }
  c.check(
    rs.some((l) => l.kind === "income" && l.paperLabel === "P"),
    "taxonomy.rentalSchedule: a gross-rent income line (label P) is required",
  );
  c.check(
    rs.some((l) => l.paperLabel === "Q"),
    "taxonomy.rentalSchedule: an interest-deductions line (label Q) is required",
  );
  c.check(
    rs.some((l) => l.paperLabel === "F"),
    "taxonomy.rentalSchedule: a capital-works line (label F) is required",
  );
  c.check(
    rs.some((l) => l.paperLabel === "U"),
    "taxonomy.rentalSchedule: an other-rental-deductions line (label U) is required",
  );
  c.check(
    rs.some((l) => l.key === "declineInValue"),
    "taxonomy.rentalSchedule: a decline-in-value (Division 40) line is required",
  );
  c.check(
    rs.some((l) => l.key === "repairsAndMaintenance"),
    "taxonomy.rentalSchedule: a repairs-and-maintenance line is required",
  );
  const computed = rs.filter((l) => l.kind === "computed" && l.paperLabel === "net");
  c.check(
    computed.length === 1,
    "taxonomy.rentalSchedule: exactly one computed 'net rent' line is required",
  );
}

/** Validate a full dataset. Never throws — inspect {@link ValidationResult}. */
export function validateDataset(dataset: YearDataset): ValidationResult {
  const c = new Checker();
  if (!dataset || !dataset.params || !dataset.taxonomy) {
    return { ok: false, errors: ["dataset must have { params, taxonomy }"], unverified: [] };
  }
  validateParams(c, dataset.params);
  validateTaxonomy(c, dataset.taxonomy);
  return { ok: c.errors.length === 0, errors: c.errors, unverified: c.unverified };
}

/** Validate a dataset and throw an {@link Error} listing every problem if invalid. */
export function assertValidDataset(dataset: YearDataset): void {
  const result = validateDataset(dataset);
  if (!result.ok) {
    throw new Error(
      `Invalid tax-parameter dataset (${dataset?.params?.meta?.targetYear ?? "unknown year"}):\n` +
        result.errors.map((e) => `  - ${e}`).join("\n"),
    );
  }
}
