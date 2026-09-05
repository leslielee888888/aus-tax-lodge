import type { PendingReconciliation } from "@aus-tax-lodge/extraction";
import type { ReturnModel } from "@aus-tax-lodge/model";

/**
 * T16's own bookkeeping, carried on `envelope.data` alongside the real
 * `ReturnModel` fields under the key {@link EXTRACTION_SCRATCH_KEY}. Neither
 * piece belongs in `ReturnModel` itself (extending that type is out of this
 * task's scope) — they ride along in the model's opaque JSON because that's
 * the only bucket the store already persists verbatim (`packages/store`'s
 * `ReturnEnvelope.data` is `unknown`, round-tripped as-is).
 *
 * `extracted` — every document `extractFigures` (`app/returns/[returnId]/documents/actions.ts`)
 * has already run and successfully applied, by `docId`, with how many figures
 * it produced. Re-read on every run so a re-click (including a retry after a
 * partial failure) only extracts what's left outstanding — never re-applies a
 * document's figures twice.
 *
 * `pendingReconciliation` — every FR-21 mismatch `applyExtractions` has
 * surfaced across every extraction run so far (deduped by `modelPath`, latest
 * run wins for a given path). T16 does not resolve or display these; it only
 * accumulates and persists them for T17 (the review screen) to read with
 * `readExtractionScratch(model).pendingReconciliation` and drive
 * `@aus-tax-lodge/extraction`'s `resolveReconciliation` /
 * `suggestDefaultChoice`.
 */
export const EXTRACTION_SCRATCH_KEY = "__t16Extraction" as const;

export interface ExtractedDocumentSummary {
  readonly docId: string;
  readonly figuresCount: number;
}

export interface ExtractionScratch {
  readonly extracted: readonly ExtractedDocumentSummary[];
  readonly pendingReconciliation: readonly PendingReconciliation[];
}

export type ModelWithExtractionScratch = ReturnModel & {
  readonly [EXTRACTION_SCRATCH_KEY]?: ExtractionScratch;
};

const EMPTY_SCRATCH: ExtractionScratch = { extracted: [], pendingReconciliation: [] };

/** Reads T16's scratch bucket off a model, defaulting to empty for a return that predates it. */
export function readExtractionScratch(model: ReturnModel): ExtractionScratch {
  return (model as ModelWithExtractionScratch)[EXTRACTION_SCRATCH_KEY] ?? EMPTY_SCRATCH;
}

/** Returns a copy of `model` with its scratch bucket replaced — every other field untouched. */
export function withExtractionScratch(
  model: ReturnModel,
  scratch: ExtractionScratch,
): ModelWithExtractionScratch {
  return { ...model, [EXTRACTION_SCRATCH_KEY]: scratch };
}

/** Merges a new extraction run's `PendingReconciliation[]` into the running set, latest wins per `modelPath`. */
export function mergePendingReconciliation(
  previous: readonly PendingReconciliation[],
  next: readonly PendingReconciliation[],
): PendingReconciliation[] {
  const byPath = new Map(previous.map((entry) => [entry.modelPath, entry] as const));
  for (const entry of next) byPath.set(entry.modelPath, entry);
  return [...byPath.values()];
}
