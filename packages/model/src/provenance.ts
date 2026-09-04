/**
 * Field-level provenance (PRD FR-3, FR-7, FR-22).
 *
 * Every figure that lands on the return is a {@link Provenanced} value: its
 * current value, how far through the review workflow it is, where it came from
 * (a document + page + snippet, a questionnaire answer, or a computed roll-up),
 * the value originally proposed, and the full edit trail. This is the lineage
 * FR-14's source index serialises and FR-22's "where did this come from?" trace
 * reads.
 *
 * The helpers ({@link propose}, {@link confirm}, {@link edit},
 * {@link markNotApplicable}, {@link answer}) never mutate — each returns a new
 * field. The extraction pipeline (T11) proposes; the review UI (T17) confirms,
 * edits or marks nil; the questionnaire (T18) answers; the rental schedule (T7)
 * and the estimate roll-ups compute.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * How far a figure has moved through the review workflow (PRD FR-7):
 * - `unset` — nothing proposed yet.
 * - `proposed` — a value is in from extraction or a roll-up, awaiting the user.
 * - `confirmed` — the user has accepted it (directly, by editing, or by
 *   answering a question). Only `confirmed` / `not-applicable` figures feed the
 *   engine (see {@link import("./to-engine-input").toEngineInput}).
 * - `not-applicable` — the user marked the label "nil / not applicable".
 */
export type FieldStatus = "unset" | "proposed" | "confirmed" | "not-applicable";

/**
 * Confidence the app assigns to an extracted figure — set by the app's
 * deterministic rules, never by the model (PRD FR-3). `unverified` means the
 * quoted snippet could not be located in the document and the figure cannot be
 * confirmed blind (FR-7).
 */
export type FieldConfidence = "high" | "medium" | "low" | "unverified";

/** A figure lifted from an uploaded document (PRD FR-3). */
export interface DocumentOrigin {
  readonly kind: "document";
  /** Id of the stored document (`@aus-tax-lodge/store` `docId`). */
  readonly docId: string;
  /** 1-based page the figure was found on. */
  readonly page: number;
  /** Verbatim snippet quoted from the document around the figure. */
  readonly snippet: string;
  /** App-assigned confidence (PRD FR-3). */
  readonly confidence: FieldConfidence;
}

/** A fact the user supplied through the structured gap questionnaire (PRD FR-6). */
export interface UserAnswerOrigin {
  readonly kind: "user-answer";
}

/** A figure the app rolled up from other confirmed figures (e.g. net rental result). */
export interface ComputedOrigin {
  readonly kind: "computed";
  /** Plain-English description of the inputs, e.g. `"gross rent + other income − rental deductions"`. */
  readonly from: string;
}

export type FieldOrigin = DocumentOrigin | UserAnswerOrigin | ComputedOrigin;

/** One recorded edit to a figure (PRD FR-7 — the edit trail is kept visible). */
export interface FieldEdit<T> {
  /** ISO-8601 timestamp of the edit. */
  readonly at: string;
  /** Value before the edit. */
  readonly from: T | null;
  /** Value after the edit. */
  readonly to: T | null;
}

/** A figure on the return together with its full lineage (PRD FR-22). */
export interface Provenanced<T> {
  /** Current value. `null` while `unset` or when marked `not-applicable`. */
  readonly value: T | null;
  readonly status: FieldStatus;
  /** Where the current value came from. `null` while `unset` / `not-applicable`. */
  readonly origin: FieldOrigin | null;
  /**
   * The value first proposed (by extraction or a roll-up). Kept unchanged when
   * the user edits, so the review UI can still show "proposed X, changed to Y".
   */
  readonly proposedValue: T | null;
  /** Every edit the user made, oldest first. */
  readonly edits: readonly FieldEdit<T>[];
}

// ---------------------------------------------------------------------------
// Constructors / helpers
// ---------------------------------------------------------------------------

/** A fresh, empty field. */
export function unsetField<T>(): Provenanced<T> {
  return { value: null, status: "unset", origin: null, proposedValue: null, edits: [] };
}

/** Build a {@link DocumentOrigin}. */
export function documentOrigin(
  docId: string,
  page: number,
  snippet: string,
  confidence: FieldConfidence,
): DocumentOrigin {
  return { kind: "document", docId, page, snippet, confidence };
}

/** Build a {@link ComputedOrigin}. */
export function computedOrigin(from: string): ComputedOrigin {
  return { kind: "computed", from };
}

/**
 * Propose a value for a field — from extraction (a {@link DocumentOrigin}) or a
 * roll-up (a {@link ComputedOrigin}). Sets `status` to `proposed` and records
 * the value as `proposedValue`. Existing edits are preserved.
 */
export function propose<T>(
  field: Provenanced<T>,
  value: T | null,
  origin: DocumentOrigin | ComputedOrigin,
): Provenanced<T> {
  return {
    value,
    status: "proposed",
    origin,
    proposedValue: value,
    edits: field.edits,
  };
}

/** Accept a field's current value unchanged (PRD FR-7 "accept"). */
export function confirm<T>(field: Provenanced<T>): Provenanced<T> {
  return { ...field, status: "confirmed" };
}

/**
 * Change a field's value (PRD FR-7 "edit"). Appends a {@link FieldEdit},
 * keeps `proposedValue` intact, and marks the field `confirmed` — an edited
 * value is the user's own.
 */
export function edit<T>(
  field: Provenanced<T>,
  newValue: T | null,
  at: string = new Date().toISOString(),
): Provenanced<T> {
  return {
    value: newValue,
    status: "confirmed",
    origin: field.origin,
    proposedValue: field.proposedValue,
    edits: [...field.edits, { at, from: field.value, to: newValue }],
  };
}

/** Mark a label "nil / not applicable" (PRD FR-7). Clears the value; keeps the history. */
export function markNotApplicable<T>(field: Provenanced<T>): Provenanced<T> {
  return { ...field, value: null, origin: null, status: "not-applicable" };
}

/**
 * Record a fact from the gap questionnaire (PRD FR-6). A submitted answer is the
 * user's own, so it lands `confirmed` with a {@link UserAnswerOrigin}; it can
 * still be {@link edit}ed later, keeping the answered value as `proposedValue`.
 */
export function answer<T>(field: Provenanced<T>, value: T | null): Provenanced<T> {
  return {
    value,
    status: "confirmed",
    origin: { kind: "user-answer" },
    proposedValue: value,
    edits: field.edits,
  };
}

/** `true` when a field is `confirmed` or `not-applicable` — i.e. ready to feed the engine. */
export function isSettled(field: Provenanced<unknown>): boolean {
  return field.status === "confirmed" || field.status === "not-applicable";
}

/** The field's value, or `fallback` when it is `null`. */
export function valueOr<T>(field: Provenanced<T>, fallback: T): T {
  return field.value ?? fallback;
}
