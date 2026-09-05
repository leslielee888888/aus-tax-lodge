import type { DocumentType } from "@aus-tax-lodge/store";

/**
 * Client-safe mirror of `@aus-tax-lodge/store`'s `DOCUMENT_TYPES` /
 * `ACCEPTED_MIME_TYPES` — human labels for the upload screen's type
 * correction `<select>` and expected-documents checklist.
 *
 * Deliberately does NOT `import { DOCUMENT_TYPES } from "@aus-tax-lodge/store"`:
 * that package's `exports["."]` resolves to one `index.ts` that also
 * re-exports `crypto.ts` (`node:crypto`) and `store.ts`/`returns.ts`
 * (`node:fs`), so pulling any runtime value from it into a Client Component
 * would drag Node-only code into the browser bundle. `DocumentType` above is a
 * type-only import — erased at compile time, so it's safe. Keep this array in
 * sync with `packages/store/src/types.ts`'s `DOCUMENT_TYPES` by hand; there's
 * no automated check, since `types.ts` is a clean, dependency-free module a
 * future task could re-export directly instead of duplicating.
 */
export const DOCUMENT_TYPE_OPTIONS: ReadonlyArray<{
  readonly value: DocumentType;
  readonly label: string;
}> = [
  { value: "ato-prefill-report", label: "ATO pre-fill report" },
  { value: "income-statement", label: "Income statement" },
  { value: "bank-interest-notice", label: "Bank interest notice" },
  { value: "dividend-statement", label: "Dividend statement" },
  { value: "private-health-statement", label: "Private health statement" },
  { value: "donation-receipt", label: "Donation receipt" },
  { value: "wfh-or-expense-record", label: "Work-from-home / expense record" },
  { value: "rental-agent-statement", label: "Rental agent statement" },
  { value: "loan-interest-summary", label: "Loan interest summary" },
  { value: "qs-depreciation-schedule", label: "QS depreciation schedule" },
  { value: "unrecognised", label: "Unrecognised" },
];

export function documentTypeLabel(type: DocumentType): string {
  return DOCUMENT_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type;
}

/** Mirrors `ACCEPTED_MIME_TYPES` — client-side pre-check only; the server re-checks (PRD FR-2). */
export const ACCEPTED_UPLOAD_MIME_TYPES: readonly string[] = [
  "application/pdf",
  "image/png",
  "image/jpeg",
];

/** Mirrors the extension fallback in `lib/documents.ts`'s `resolveUploadMime`. */
export const ACCEPTED_UPLOAD_EXTENSIONS: readonly string[] = ["pdf", "png", "jpg", "jpeg"];

export const ACCEPTED_UPLOAD_LABEL = "PDF, PNG or JPG";

/** Client-side pre-check only — mirrors the server's `resolveUploadMime` closely enough to give an instant reason. */
export function looksLikeAcceptedUpload(file: { name: string; type: string }): boolean {
  if (ACCEPTED_UPLOAD_MIME_TYPES.includes(file.type)) return true;
  const opaque = file.type === "" || file.type === "application/octet-stream";
  if (!opaque) return false;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return ACCEPTED_UPLOAD_EXTENSIONS.includes(ext);
}
