/**
 * BSB (Bank State Branch) format validation (PRD FR-1, FR-13).
 *
 * A BSB is 6 digits, conventionally written `NNN-NNN`. This is a format check
 * only — there is no public per-bank/branch checksum or registry lookup in
 * scope for v1.
 */

const BSB_PATTERN = /^\d{3}-?\d{3}$/;

/** `true` when `raw` matches the BSB format `\d{3}-?\d{3}` (e.g. `"062-000"` or `"062000"`). */
export function isValidBsb(raw: string): boolean {
  return BSB_PATTERN.test(raw.trim());
}
