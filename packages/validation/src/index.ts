/**
 * `@aus-tax-lodge/validation` — the FR-13 pre-export validation gate.
 *
 * {@link validateReturn} runs every mandatory-label, correctness and
 * plausibility check the PRD requires over a {@link ReturnModel} (and,
 * optionally, its {@link FullAssessment}) before the return may be exported;
 * {@link isExportBlocked} tells a caller whether the result contains an
 * export-blocking `error`. T20's export builder is the intended caller;
 * T17's review UI can call it too to show pass/warn state as the user works
 * through the return.
 *
 * Also exports the canonical ATO TFN checksum ({@link isValidTfn}) and BSB
 * format ({@link isValidBsb}) validators — no other implementation existed on
 * `feature/aus-tax-lodge` when this package was built, so this is the single
 * source other tasks (T15/T17) should import them from.
 */

export { type ValidationSeverity, type ValidationIssue } from "./types";
export { isValidTfn } from "./tfn";
export { isValidBsb } from "./bsb";
export { type InScopeField, collectInScopeFields } from "./fields";
export { walkProvenancedFields } from "./walk";
export { validateReturn, isExportBlocked } from "./validate";
