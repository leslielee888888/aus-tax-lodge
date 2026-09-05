/**
 * `@aus-tax-lodge/extraction` — Claude multimodal figure extraction with
 * deterministic, app-assigned confidence (PRD FR-3).
 *
 * `extractDocument` reads one stored document and returns candidate figures
 * for the return model, each with its source, a verbatim snippet, and a
 * confidence this package computes itself — never the model.
 * `applyExtractions` folds one or more documents' figures into a
 * `ReturnModel`, always as `proposed` values (PRD FR-7) and surfacing, never
 * resolving, any disagreement between sources (PRD FR-21).
 *
 * Out of scope here: rental agent statements and QS depreciation schedules
 * (a separate task, FR-24), the reconcile *decision* (T12), and the review
 * UI (T17).
 */
export type { ApplyExtractionsResult } from "./apply";
export { applyExtractions } from "./apply";

export {
  assignConfidence,
  frankingCreditCrossCheck,
  type ConfidenceDocInfo,
  type CrossCheckResult,
} from "./confidence";

export type { ExtractDocumentDeps, ExtractDocumentResult } from "./extract-document";
export { extractDocument } from "./extract-document";

export { applyFigureToModel, expectedValueKind, isKnownModelPath } from "./model-paths";

export { parseExtractedFigures } from "./parse";

export { EXTRACTABLE_DOCUMENT_PROMPTS, type DocumentPrompt } from "./prompts";

export { extractTextLayer, locateSnippet, type TextLayer } from "./text-layer";

export type {
  DocumentExtractionResult,
  ExtractedFigure,
  PendingReconciliation,
  ReconciliationCandidate,
  ScoredExtractedFigure,
} from "./types";

export { isFormatValid } from "./validators";
