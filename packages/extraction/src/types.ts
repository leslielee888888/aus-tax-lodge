import type { DocumentType } from "@aus-tax-lodge/store";
import type { FieldConfidence } from "@aus-tax-lodge/model";

/**
 * One figure a Claude vision call read off a document (PRD FR-3). `modelPath`
 * is a dot-path into `ReturnModel` — see `model-paths.ts` for the closed set
 * every extractor may use. `snippet` must be verbatim text from the document,
 * near where the figure was found — it is what {@link import("./confidence")}
 * checks against the document's text layer.
 */
export interface ExtractedFigure {
  readonly modelPath: string;
  readonly value: number | string;
  /** 1-based page the figure was found on. */
  readonly page: number;
  /** Verbatim text quoted from the document, around the figure. */
  readonly snippet: string;
  /** Anything the model volunteered about its own confidence. Never used to set {@link FieldConfidence} — PRD FR-3. */
  readonly rawConfidenceHint?: string;
}

/** An {@link ExtractedFigure} with the app's deterministically-assigned confidence (PRD FR-3). */
export interface ScoredExtractedFigure extends ExtractedFigure {
  readonly confidence: FieldConfidence;
}

/** The figures read from one document, gated on `metadata.extractable`. */
export interface DocumentExtractionResult {
  readonly docId: string;
  readonly documentType: DocumentType;
  readonly figures: readonly ScoredExtractedFigure[];
}

/** One candidate value for a `modelPath` that two or more documents disagree on. */
export interface ReconciliationCandidate {
  readonly docId: string;
  readonly page: number;
  readonly snippet: string;
  readonly confidence: FieldConfidence;
  readonly value: number | string;
}

/**
 * A `modelPath` two or more extractions proposed different values for (PRD
 * FR-21). Never auto-resolved here — {@link import("./apply").applyExtractions}
 * leaves the field at whichever candidate landed first (pre-fill-report-first,
 * PRD FR-2) and surfaces every candidate for a later task to reconcile.
 */
export interface PendingReconciliation {
  readonly modelPath: string;
  readonly candidates: readonly ReconciliationCandidate[];
}
