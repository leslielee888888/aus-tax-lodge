/**
 * Shared TFN / refund-bank-account validation and masking helpers for the
 * secure `identity` card (PRD FR-1, FR-17, #88 / T15).
 *
 * Pure — no React, no Next, no filesystem — so `IdentityCard.tsx` (client-side,
 * immediate feedback) and the `provideIdentity` server action (the
 * authoritative re-check, since a client can always be bypassed) share exactly
 * one implementation. Mirrors the deleted v1 `apps/web/lib/details/validation.ts`
 * (recovered from commit `515fa95^` for T15), which wrapped the same
 * `@aus-tax-lodge/validation` checksum/format checks with label + error-message
 * conventions.
 *
 * Nothing here ever logs, renders or otherwise surfaces the raw TFN / account
 * number beyond {@link maskTfn} / {@link maskAccountNumber}'s last-3-digits
 * masks (PRD FR-17 — "TFN masked in any UI").
 */
import { isValidBsb, isValidTfn } from "@aus-tax-lodge/validation";

/** Strip everything but digits. */
export function digitsOnly(raw: string): string {
  return raw.replace(/\D/g, "");
}

/** `"063018"` → `"063-018"`. Leaves an already-hyphenated or malformed value alone. */
export function normalizeBsb(raw: string): string {
  const digits = digitsOnly(raw);
  return digits.length === 6 ? `${digits.slice(0, 3)}-${digits.slice(3)}` : raw.trim();
}

/** `"123456782"` → `"•••••782"` (last 3 digits only) — never the full TFN (PRD FR-17). */
export function maskTfn(raw: string): string {
  const digits = digitsOnly(raw);
  return digits.length >= 3 ? `•••••${digits.slice(-3)}` : "•••••";
}

/** `"12345678"` → `"•••••678"` (last 3 digits only). */
export function maskAccountNumber(raw: string): string {
  const digits = digitsOnly(raw);
  return digits.length >= 3 ? `•••••${digits.slice(-3)}` : "•••••";
}

export function validateTfn(raw: string): string | null {
  const digits = digitsOnly(raw);
  if (!digits) return "Tax file number is required";
  if (digits.length !== 8 && digits.length !== 9) return "Tax file number must be 8 or 9 digits";
  if (!isValidTfn(digits)) return "That tax file number doesn’t check out — check the digits";
  return null;
}

export function validateBsb(raw: string): string | null {
  if (!raw.trim()) return "BSB is required";
  return isValidBsb(raw) ? null : "BSB must be 6 digits, as NNN-NNN";
}

export function validateAccountNumber(raw: string): string | null {
  const digits = digitsOnly(raw);
  if (!digits) return "Account number is required";
  return digits.length >= 5 && digits.length <= 10 ? null : "Account number must be 5–10 digits";
}

export function validateAccountName(raw: string): string | null {
  return raw.trim() ? null : "Account name is required";
}

export interface IdentityValues {
  readonly tfn: string;
  readonly bsb: string;
  readonly accountNumber: string;
  readonly accountName: string;
}

export interface IdentityFieldErrors {
  readonly tfn?: string;
  readonly bsb?: string;
  readonly accountNumber?: string;
  readonly accountName?: string;
}

/** Validate the whole identity card (PRD FR-1). Run on the client (blur/submit) and again server-side. */
export function validateIdentity(values: IdentityValues): IdentityFieldErrors {
  const errors: { -readonly [K in keyof IdentityFieldErrors]?: string } = {};
  const tfnError = validateTfn(values.tfn);
  if (tfnError) errors.tfn = tfnError;
  const bsbError = validateBsb(values.bsb);
  if (bsbError) errors.bsb = bsbError;
  const accountNumberError = validateAccountNumber(values.accountNumber);
  if (accountNumberError) errors.accountNumber = accountNumberError;
  const accountNameError = validateAccountName(values.accountName);
  if (accountNameError) errors.accountName = accountNameError;
  return errors;
}

export function isIdentityValid(values: IdentityValues): boolean {
  return Object.keys(validateIdentity(values)).length === 0;
}
