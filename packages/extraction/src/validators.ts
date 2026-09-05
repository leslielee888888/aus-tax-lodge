/**
 * The format/range check behind `medium`/`high` vs `low` confidence (PRD
 * FR-3 — "passes a format/range check for that field"). Keyed by the last
 * segment of a `modelPath` (the field name), since the same leaf name — e.g.
 * `amount`, `tfnAmountsWithheld` — is reused across sections with the same
 * shape and the same plausible range.
 */

/** `[min, max]` a numeric field must fall within (inclusive) to be plausible. */
const NUMERIC_RANGES: Readonly<Record<string, readonly [number, number]>> = {
  grossSalaryWages: [0, 5_000_000],
  paygWithheld: [0, 5_000_000],
  grossInterest: [0, 1_000_000],
  tfnAmountsWithheld: [0, 1_000_000],
  unfranked: [0, 1_000_000],
  franked: [0, 1_000_000],
  frankingCredits: [0, 1_000_000],
  governmentAllowances: [0, 1_000_000],
  reportableFringeBenefits: [0, 1_000_000],
  reportableEmployerSuper: [0, 1_000_000],
  premiumsEligibleForRebate: [0, 100_000],
  rebateReceived: [0, 100_000],
  oldestCoveredPersonAge: [0, 120],
  coverDays: [0, 366],
  amount: [0, 1_000_000],
  hours: [0, 8_784],
};

const ABN_PATTERN = /^\d{11}$/;

function lastSegment(modelPath: string): string {
  const field = modelPath.split(".").at(-1) ?? "";
  // Strip a trailing array index, e.g. "grossInterest" from ".../[0].grossInterest" — the
  // regex split already leaves just the leaf name here, kept defensive in case that changes.
  return field.replace(/\[\d+\]$/, "");
}

function isValidNumber(field: string, value: number): boolean {
  if (!Number.isFinite(value)) return false;
  const range = NUMERIC_RANGES[field];
  if (!range) return false; // unknown numeric field — fail closed rather than guess a range.
  const [min, max] = range;
  return value >= min && value <= max;
}

function isValidString(field: string, value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 200) return false;
  if (field === "payerAbn") return ABN_PATTERN.test(trimmed.replace(/\s+/g, ""));
  return true;
}

/**
 * `true` when `value` passes the format/range check for `modelPath`'s field
 * (PRD FR-3). A number outside its plausible range, an empty/oversized
 * string, or a malformed ABN all fail this — feeding straight into `low`
 * confidence regardless of anything else.
 */
export function isFormatValid(modelPath: string, value: number | string): boolean {
  const field = lastSegment(modelPath);
  return typeof value === "number" ? isValidNumber(field, value) : isValidString(field, value);
}
