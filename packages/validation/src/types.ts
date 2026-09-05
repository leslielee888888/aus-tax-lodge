/**
 * The pre-export validation result type (PRD FR-13).
 *
 * {@link import("./validate").validateReturn} returns a flat list of these.
 * `error` blocks export ({@link import("./validate").isExportBlocked});
 * `warning` is surfaced to the user and can be acknowledged — recording that
 * acknowledgement is the caller's job (T20's export builder / the T17 review
 * UI), not this package's.
 */

export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
  /** Stable machine code, e.g. `"tfn-invalid"`, `"franking-credit-implausible"`. */
  readonly code: string;
  readonly severity: ValidationSeverity;
  /** Plain-English explanation shown to the user (PRD FR-13, the validation report). */
  readonly message: string;
  /** Dot-path into the {@link import("@aus-tax-lodge/model").ReturnModel}, when the issue is about one field. */
  readonly path?: string;
}
