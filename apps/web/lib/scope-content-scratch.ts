import type { DocumentContentClassification, ScopeContentCategory } from "@aus-tax-lodge/scope";
import type { ReturnModel } from "@aus-tax-lodge/model";

/**
 * T26's bookkeeping for the FR-20 document-*content* scope check, carried on
 * `envelope.data` alongside the real {@link ReturnModel} fields under the key
 * {@link SCOPE_CONTENT_SCRATCH_KEY} — the same ride-along trick T16's
 * {@link import("./extraction-scratch")} uses, and for the same reason: the
 * store round-trips `data` verbatim as opaque JSON and extending `ReturnModel`
 * itself is out of scope. Kept in its own module (not folded into the
 * extraction scratch) so the two concerns stay readable.
 *
 * `classifications` — every document `extractFigures`
 * (`app/returns/[returnId]/documents/actions.ts`) has run
 * `checkDocumentForOutOfScopeContent` over, by `docId`, with the categories the
 * check flagged (empty = looked in scope) and the `detectedType` it was checked
 * against. The review page reads these back with {@link scopeContentFindings}
 * and passes them to `detectOutOfScope` as `contentFindings` so a document whose
 * content implies an out-of-scope item hard-stops the return (PRD FR-20, Q12).
 *
 * Cache invalidation, applied on every `extractFigures` run:
 * - a document whose `detectedType` no longer needs a content check
 *   (`documentsNeedingContentCheck`), or that has been deleted, is pruned;
 * - a document that was re-typed (its `detectedType` changed) is re-checked;
 * - a document with a matching cached entry is left alone — no second Claude call.
 */
export const SCOPE_CONTENT_SCRATCH_KEY = "__t26ScopeContent" as const;

export interface ScopeContentClassificationEntry {
  readonly docId: string;
  readonly filename: string;
  /** The store `DocumentType` the check ran against — a change invalidates the entry. */
  readonly detectedType: string;
  readonly categories: readonly ScopeContentCategory[];
}

export interface ScopeContentScratch {
  readonly classifications: readonly ScopeContentClassificationEntry[];
}

export type ModelWithScopeContentScratch = ReturnModel & {
  readonly [SCOPE_CONTENT_SCRATCH_KEY]?: ScopeContentScratch;
};

const EMPTY_SCRATCH: ScopeContentScratch = { classifications: [] };

/** Reads T26's scratch bucket off a model, defaulting to empty for a return that predates it. */
export function readScopeContentScratch(model: ReturnModel): ScopeContentScratch {
  return (model as ModelWithScopeContentScratch)[SCOPE_CONTENT_SCRATCH_KEY] ?? EMPTY_SCRATCH;
}

/** Returns a copy of `model` with its scratch bucket replaced — every other field untouched. */
export function withScopeContentScratch(
  model: ReturnModel,
  scratch: ScopeContentScratch,
): ModelWithScopeContentScratch {
  return { ...model, [SCOPE_CONTENT_SCRATCH_KEY]: scratch };
}

/**
 * The cached classifications as `@aus-tax-lodge/scope`'s
 * {@link DocumentContentClassification}[] — the shape `detectOutOfScope`'s
 * `contentFindings` expects. Drops the `detectedType` bookkeeping field.
 */
export function scopeContentFindings(model: ReturnModel): DocumentContentClassification[] {
  return readScopeContentScratch(model).classifications.map((entry) => ({
    docId: entry.docId,
    filename: entry.filename,
    categories: entry.categories,
  }));
}
