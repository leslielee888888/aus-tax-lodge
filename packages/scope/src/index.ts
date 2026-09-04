/**
 * `@aus-tax-lodge/scope` — out-of-scope detection and the hard-stop enforcement
 * points (PRD FR-20, Q12, §3 non-goals).
 *
 * - {@link detectOutOfScope} — pure detector over the return model, the uploaded
 *   documents and any Claude content-classification results.
 * - {@link checkDocumentForOutOfScopeContent} — the one Claude vision call, run
 *   by T11 over `dividend-statement` / `unrecognised` documents before detection.
 * - {@link assertInScope} / {@link isBlocked} / {@link OutOfScopeError} — the
 *   enforcement helpers T13's save and T20's export call. No override exists.
 *
 * The hard-stop *screen* is T17; this package only provides the detection and a
 * typed result for it to render.
 */

export {
  type FindingSource,
  type OutOfScopeFinding,
  type ScopeCode,
  type ScopeContentCategory,
  SCOPE_CODES,
  SCOPE_CONTENT_CATEGORIES,
  isScopeContentCategory,
  scopeFinding,
} from "./findings";

export {
  type DetectOutOfScopeInput,
  type DocumentContentClassification,
  type ScopeDocumentInfo,
  carMethodOutOfScope,
  detectOutOfScope,
  documentsNeedingContentCheck,
  wfhMethodOutOfScope,
} from "./detect";

export {
  type ScopeContentCheckInput,
  type ScopeVisionClient,
  type ScopeVisionPart,
  SCOPE_CONTENT_CHECK_PROMPT,
  SCOPE_CONTENT_CHECK_SYSTEM_PROMPT,
  checkDocumentForOutOfScopeContent,
  parseScopeContentReply,
} from "./content-check";

export { OutOfScopeError, assertInScope, isBlocked } from "./enforce";
