/**
 * The document types the assistant recognises on ingest (PRD FR-2). The
 * classifier (`@aus-tax-lodge/ai`) maps every uploaded file to one of these;
 * `unrecognised` files are kept but flagged not to extract.
 */
export const DOCUMENT_TYPES = [
  "ato-prefill-report",
  "income-statement",
  "bank-interest-notice",
  "dividend-statement",
  "private-health-statement",
  "donation-receipt",
  "wfh-or-expense-record",
  "rental-agent-statement",
  "loan-interest-summary",
  "qs-depreciation-schedule",
  "unrecognised",
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export function isDocumentType(value: unknown): value is DocumentType {
  return typeof value === "string" && (DOCUMENT_TYPES as readonly string[]).includes(value);
}

/** MIME types accepted for upload (PRD FR-2 — PDF / PNG / JPG only). */
export const ACCEPTED_MIME_TYPES = ["application/pdf", "image/png", "image/jpeg"] as const;

export type AcceptedMimeType = (typeof ACCEPTED_MIME_TYPES)[number];

export function isAcceptedMimeType(value: string): value is AcceptedMimeType {
  return (ACCEPTED_MIME_TYPES as readonly string[]).includes(value);
}

/**
 * Metadata stored — encrypted — alongside each document blob. No plaintext
 * filename ever touches the disk (PRD FR-17).
 */
export interface DocumentMetadata {
  /** Opaque id; also the blob filename on disk. */
  readonly docId: string;
  /** Original client-supplied filename. */
  readonly filename: string;
  readonly mimeType: AcceptedMimeType;
  /** Plaintext byte length of the document. */
  readonly size: number;
  /** Classifier result, or a user correction (PRD FR-2). */
  readonly detectedType: DocumentType;
  /**
   * Whether figure extraction (T11) should run on this document. `false` for
   * `unrecognised` files and any the user has marked to skip.
   */
  readonly extractable: boolean;
  /** ISO-8601 timestamp of the upload. */
  readonly uploadedAt: string;
}

export interface PutDocumentInput {
  readonly filename: string;
  readonly mimeType: AcceptedMimeType;
  readonly bytes: Buffer;
  /** Classifier result. Defaults to `unrecognised` if omitted. */
  readonly detectedType?: DocumentType;
  /**
   * Override for the derived extractable flag. By default a document is
   * extractable iff its `detectedType` is not `unrecognised`.
   */
  readonly extractable?: boolean;
}

export interface StoredDocument {
  readonly metadata: DocumentMetadata;
  readonly bytes: Buffer;
}

export interface DocumentStoreOptions {
  /** Absolute path to the data root (`config.dataDir`). */
  readonly dataDir: string;
  /** 32-byte AES-256 key (`config.encryptionKey`). */
  readonly encryptionKey: Buffer;
}
