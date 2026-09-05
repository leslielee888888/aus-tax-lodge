/**
 * `applyExtractions` — folds one or more documents' extraction results into a
 * {@link ReturnModel} (PRD FR-2, FR-3, FR-21).
 *
 * Every figure lands via `propose()`, so nothing here ever produces a
 * `confirmed` field — that's the review workflow's job (FR-7). When two
 * extractions target the same `modelPath` with different values, the first
 * one (in pre-fill-report-first order — FR-2) is applied and every candidate
 * is recorded in `pendingReconciliation`; this module never picks a winner
 * on the user's behalf (FR-21) — see `./reconcile` for the resolution
 * mechanism the user's pick drives.
 */
import { documentOrigin, type ReturnModel } from "@aus-tax-lodge/model";

import { applyFigureToModel } from "./model-paths";
import type {
  DocumentExtractionResult,
  PendingReconciliation,
  ReconciliationCandidate,
} from "./types";

export interface ApplyExtractionsResult {
  readonly model: ReturnModel;
  /** Every `modelPath` two or more documents disagreed on, with every candidate value (PRD FR-21). */
  readonly pendingReconciliation: readonly PendingReconciliation[];
}

/** Numbers within a cent of each other, or identical strings, count as agreement. */
function valuesEqual(a: number | string, b: number | string): boolean {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 0.005;
  return a === b;
}

function toCandidate(
  extraction: DocumentExtractionResult,
  figure: DocumentExtractionResult["figures"][number],
): ReconciliationCandidate {
  return {
    docId: extraction.docId,
    documentType: extraction.documentType,
    page: figure.page,
    snippet: figure.snippet,
    confidence: figure.confidence,
    value: figure.value,
  };
}

/**
 * Orders extractions pre-fill-report-first (PRD FR-2): the ATO pre-fill
 * report's figures seed the income labels before any other document's
 * figures are compared against them. Stable otherwise.
 */
function preFillFirst(
  extractions: readonly DocumentExtractionResult[],
): DocumentExtractionResult[] {
  return [...extractions].sort((a, b) => {
    const rank = (e: DocumentExtractionResult): number =>
      e.documentType === "ato-prefill-report" ? 0 : 1;
    return rank(a) - rank(b);
  });
}

export function applyExtractions(
  model: ReturnModel,
  extractions: readonly DocumentExtractionResult[],
): ApplyExtractionsResult {
  let result = model;
  const winners = new Map<string, ReconciliationCandidate>();
  const pendingByPath = new Map<string, ReconciliationCandidate[]>();

  for (const extraction of preFillFirst(extractions)) {
    for (const figure of extraction.figures) {
      const candidate = toCandidate(extraction, figure);
      const winner = winners.get(figure.modelPath);

      if (winner === undefined) {
        winners.set(figure.modelPath, candidate);
        result = applyFigureToModel(
          result,
          figure.modelPath,
          figure.value,
          documentOrigin(extraction.docId, figure.page, figure.snippet, figure.confidence),
        );
        continue;
      }

      if (valuesEqual(winner.value, candidate.value)) continue; // another source agrees — nothing new to surface

      const existing = pendingByPath.get(figure.modelPath);
      if (existing) {
        const alreadyListed = existing.some(
          (c) => c.docId === candidate.docId && valuesEqual(c.value, candidate.value),
        );
        if (!alreadyListed) existing.push(candidate);
      } else {
        pendingByPath.set(figure.modelPath, [winner, candidate]);
      }
    }
  }

  const pendingReconciliation: PendingReconciliation[] = [...pendingByPath.entries()].map(
    ([modelPath, candidates]) => ({ modelPath, candidates }),
  );

  return { model: result, pendingReconciliation };
}
