/**
 * Tax file number (TFN) format + checksum validation (PRD FR-1, FR-13).
 *
 * Not found on `apps/web` as of `feature/aus-tax-lodge` when T8 was built —
 * T15's details form is still a placeholder ("Identity, TFN, bank account,
 * residency, spouse and study-loan details — coming in T15"). This is
 * therefore the **canonical** implementation of the ATO TFN checksum; T15/T17
 * and any other task validating a TFN should import {@link isValidTfn} from
 * here rather than re-implementing it.
 *
 * TFNs are 8 or 9 digits. The ATO publishes a modulus-11 checksum: multiply
 * each digit by its weighting factor (position 1 first), sum the products,
 * and the TFN is valid only if that sum is exactly divisible by 11.
 */

const NINE_DIGIT_WEIGHTS = [1, 4, 3, 7, 5, 8, 6, 9, 10] as const;
const EIGHT_DIGIT_WEIGHTS = [10, 7, 8, 4, 6, 3, 5, 1] as const;

function checksumPasses(digits: readonly number[], weights: readonly number[]): boolean {
  const sum = digits.reduce((total, digit, i) => total + digit * (weights[i] ?? 0), 0);
  return sum % 11 === 0;
}

/**
 * `true` when `raw` is a well-formed Australian TFN: 8 or 9 digits (internal
 * whitespace is stripped before checking, so `"123 456 782"` is accepted the
 * same as `"123456782"`) that passes the ATO's modulus-11 checksum.
 */
export function isValidTfn(raw: string): boolean {
  const cleaned = raw.replace(/\s+/g, "");
  if (!/^\d{8,9}$/.test(cleaned)) return false;
  const digits = cleaned.split("").map(Number);
  return digits.length === 9
    ? checksumPasses(digits, NINE_DIGIT_WEIGHTS)
    : checksumPasses(digits, EIGHT_DIGIT_WEIGHTS);
}
