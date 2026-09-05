/**
 * Pure field validators for the T15 details form (PRD FR-1). No React, no
 * Next, no filesystem — shared verbatim between the client (immediate,
 * on-blur / on-submit feedback) and the server action (the authoritative
 * re-check, since a client can always be bypassed).
 */

// ---------------------------------------------------------------------------
// Small parsing helpers
// ---------------------------------------------------------------------------

/** Strip everything but digits. */
export function digitsOnly(raw: string): string {
  return raw.replace(/\D/g, "");
}

/** `"14/03/1990"` → `{ day: 14, month: 3, year: 1990 }`, or `null` if not that shape. */
function splitDdMmYyyy(raw: string): { day: number; month: number; year: number } | null {
  const match = /^\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})\s*$/.exec(raw);
  if (!match) return null;
  return { day: Number(match[1]), month: Number(match[2]), year: Number(match[3]) };
}

/**
 * Parse a `DD/MM/YYYY` string to an ISO `YYYY-MM-DD` date, verifying it is a
 * real calendar date (rejects `31/02/2020`) — or `null` if the string is not a
 * valid date in that format.
 */
export function parseDdMmYyyyToIso(raw: string): string | null {
  const parts = splitDdMmYyyy(raw);
  if (!parts) return null;
  const { day, month, year } = parts;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(Date.UTC(year, month - 1, day));
  // `Date` normalises an out-of-range day (e.g. 31 Feb) by rolling into the
  // next month — round-tripping the parts back out catches that.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

/** ISO `YYYY-MM-DD` → `DD/MM/YYYY`, for pre-filling the form from a saved model. */
export function isoToDdMmYyyy(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return "";
  return `${match[3]}/${match[2]}/${match[1]}`;
}

// ---------------------------------------------------------------------------
// Field validators — each returns an error message, or `null` when valid
// ---------------------------------------------------------------------------

export function validateRequired(value: string, label: string): string | null {
  return value.trim() ? null : `${label} is required`;
}

/**
 * A real, past `DD/MM/YYYY` date. Used for both the taxpayer's and the
 * spouse's date of birth.
 */
export function validateDob(raw: string, label = "Date of birth"): string | null {
  if (!raw.trim()) return `${label} is required`;
  const iso = parseDdMmYyyyToIso(raw);
  if (!iso) return `${label} must be a real date, as DD/MM/YYYY`;
  if (iso >= new Date().toISOString().slice(0, 10)) return `${label} must be in the past`;
  return null;
}

export function validatePostcode(raw: string): string | null {
  if (!raw.trim()) return "Postcode is required";
  return /^\d{4}$/.test(raw.trim()) ? null : "Postcode must be 4 digits";
}

/**
 * The ATO tax file number checksum: each of the 9 digits is weighted
 * `1,4,3,7,5,8,6,9,10` and the weighted sum must be divisible by 11.
 */
export function isValidTfnChecksum(nineDigits: string): boolean {
  if (!/^\d{9}$/.test(nineDigits)) return false;
  const weights = [1, 4, 3, 7, 5, 8, 6, 9, 10];
  const sum = nineDigits
    .split("")
    .reduce((total, digit, i) => total + Number(digit) * weights[i]!, 0);
  return sum % 11 === 0;
}

export function validateTfn(raw: string): string | null {
  const digits = digitsOnly(raw);
  if (!digits) return "Tax file number is required";
  if (digits.length !== 9) return "Tax file number must be 9 digits";
  if (!isValidTfnChecksum(digits))
    return "That tax file number doesn’t check out — check the digits";
  return null;
}

/** `"063018"` → `"063-018"`. Leaves an already-hyphenated or malformed value alone. */
export function normalizeBsb(raw: string): string {
  const digits = digitsOnly(raw);
  return digits.length === 6 ? `${digits.slice(0, 3)}-${digits.slice(3)}` : raw.trim();
}

export function validateBsb(raw: string): string | null {
  if (!raw.trim()) return "BSB is required";
  return /^\d{3}-?\d{3}$/.test(raw.trim()) ? null : "BSB must be 6 digits, as NNN-NNN";
}

export function validateAccountNumber(raw: string): string | null {
  const digits = digitsOnly(raw);
  if (!digits) return "Account number is required";
  return digits.length >= 5 && digits.length <= 10 ? null : "Account number must be 5–10 digits";
}

/** A whole number of days in an income year, 0–366 inclusive. */
export function validateDayCount(raw: string, label: string): string | null {
  if (!raw.trim()) return `${label} is required`;
  if (!/^\d+$/.test(raw.trim())) return `${label} must be a whole number of days`;
  const n = Number(raw);
  return n >= 0 && n <= 366 ? null : `${label} must be between 0 and 366`;
}

/** A non-negative dollar amount (spouse's estimated taxable income). */
export function validateNonNegativeAmount(raw: string, label: string): string | null {
  if (!raw.trim()) return `${label} is required`;
  const n = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(n)) return `${label} must be a number`;
  return n >= 0 ? null : `${label} can’t be negative`;
}

/** A non-negative whole count (dependent children). */
export function validateNonNegativeInteger(raw: string, label: string): string | null {
  if (!raw.trim()) return `${label} is required`;
  return /^\d+$/.test(raw.trim()) ? null : `${label} must be a whole number, 0 or more`;
}
