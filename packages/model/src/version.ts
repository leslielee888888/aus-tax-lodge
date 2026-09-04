/**
 * Schema version of the return domain model (PRD FR-4, FR-5, FR-22, FR-24).
 *
 * Separate from `@aus-tax-lodge/store`'s `RETURN_SCHEMA_VERSION` (the persistence
 * envelope) and from the versioned tax-parameter config (`@aus-tax-lodge/params`,
 * PRD FR-15). The store persists a {@link import("./model").ReturnModel} verbatim
 * inside its opaque `data` payload; this constant lets a loader detect a model
 * written by an older build and migrate it.
 *
 * 1 — T6: taxpayer + context, income (per-employer / per-account / per-holding),
 * deductions (incl. WFH fixed-rate + car cents-per-km), the rental schedule
 * shape, private health, the gap-questionnaire answers, and field-level
 * provenance on every figure.
 */
export const RETURN_MODEL_VERSION = 1;
