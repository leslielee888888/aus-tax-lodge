/**
 * FR-7 reconciliation, in the conversation (T6).
 *
 * When a document the user drops mid-interview reports a different value for a
 * figure the pre-fill report (or an earlier document) already seeded, that is a
 * genuine "which source is right?" question — the assistant must name both
 * values and let the user pick, never silently prefer one (PRD FR-7, FR-21).
 *
 * `@aus-tax-lodge/extraction` already owns the resolution mechanism
 * ({@link resolveReconciliation} + {@link PendingReconciliation}); its
 * `applyExtractions` only compares figures **within one call**, though, so it
 * never spots a new document disagreeing with a figure already on the model.
 * {@link detectDocumentReconciliation} fills that gap deterministically: it
 * compares each freshly-extracted figure against the value currently on the
 * model and, on a real mismatch against a document-sourced figure, produces the
 * same {@link PendingReconciliation} shape the review screen and
 * `resolveReconciliation` expect — built from the stored {@link DocumentOrigin}
 * (which already carries page, snippet and confidence), so no document is
 * re-read.
 *
 * These entries live in T16's `__t16Extraction` scratch
 * ({@link import("./extraction-scratch")}); {@link firstUnresolvedReconciliation}
 * is what `nextTurn`'s deterministic short-circuit and `interview-loop`'s
 * `reconcile` card payload read.
 */
import type {
  DocumentExtractionResult,
  PendingReconciliation,
  ReconciliationCandidate,
} from "@aus-tax-lodge/extraction";
import type { DocumentType } from "@aus-tax-lodge/store";
import type { Provenanced, ReturnModel } from "@aus-tax-lodge/model";

import type { ExtractionScratch } from "./extraction-scratch";

/** The first mismatch still awaiting the user's pick, or `null`. */
export function firstUnresolvedReconciliation(
  scratch: ExtractionScratch,
): PendingReconciliation | null {
  return scratch.pendingReconciliation[0] ?? null;
}

/** `true` when `scratch` carries at least one mismatch the user has not resolved. */
export function hasUnresolvedReconciliation(scratch: ExtractionScratch): boolean {
  return scratch.pendingReconciliation.length > 0;
}

// ---------------------------------------------------------------------------
// New-document vs. model comparison
// ---------------------------------------------------------------------------

function isProvenanced(value: unknown): value is Provenanced<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "status" in value &&
    "origin" in value &&
    Array.isArray((value as { edits?: unknown }).edits)
  );
}

/** Split `income.interestAccounts[0].grossInterest` into `["income","interestAccounts",0,"grossInterest"]`. */
function parsePath(path: string): (string | number)[] {
  const segments: (string | number)[] = [];
  for (const part of path.split(".")) {
    const match = /^([^[\]]+)((?:\[\d+\])*)$/.exec(part);
    if (!match) {
      segments.push(part);
      continue;
    }
    segments.push(match[1]!);
    for (const idx of match[2]!.matchAll(/\[(\d+)\]/g)) segments.push(Number(idx[1]));
  }
  return segments;
}

/** Read the {@link Provenanced} leaf at a dot/bracket `path`, or `null` when it does not resolve to one. */
function readProvenancedAtPath(model: ReturnModel, path: string): Provenanced<unknown> | null {
  let node: unknown = model;
  for (const segment of parsePath(path)) {
    if (node == null || typeof node !== "object") return null;
    node = Array.isArray(node)
      ? node[segment as number]
      : (node as Record<string, unknown>)[segment as string];
  }
  return isProvenanced(node) ? node : null;
}

/** Numbers within a cent of each other, or identical strings, count as agreement (mirrors `applyExtractions`). */
function valuesEqual(a: number | string, b: number | string): boolean {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 0.005;
  return a === b;
}

/**
 * Compare one document's extraction against the values already on `model` and
 * return a {@link PendingReconciliation} for every figure that genuinely
 * disagrees with a **document-sourced** value already there (a user-entered or
 * computed value is the user's own and is not treated as a rival source).
 *
 * `documentTypeByDocId` lets the model-side candidate carry its real
 * {@link DocumentType} so a picker (and `suggestDefaultChoice`) can still find
 * the ATO pre-fill report among the candidates (PRD FR-21).
 */
export function detectDocumentReconciliation(
  model: ReturnModel,
  extraction: DocumentExtractionResult,
  documentTypeByDocId: Readonly<Record<string, DocumentType>> = {},
): PendingReconciliation[] {
  const out: PendingReconciliation[] = [];

  for (const figure of extraction.figures) {
    const existing = readProvenancedAtPath(model, figure.modelPath);
    if (!existing || existing.origin?.kind !== "document") continue;

    const currentValue = existing.value;
    if (
      currentValue == null ||
      (typeof currentValue !== "number" && typeof currentValue !== "string")
    ) {
      continue;
    }
    if (valuesEqual(currentValue, figure.value)) continue;

    const fromModel: ReconciliationCandidate = {
      docId: existing.origin.docId,
      documentType: documentTypeByDocId[existing.origin.docId] ?? "unrecognised",
      page: existing.origin.page,
      snippet: existing.origin.snippet,
      confidence: existing.origin.confidence,
      value: currentValue,
    };
    const fromNewDoc: ReconciliationCandidate = {
      docId: extraction.docId,
      documentType: extraction.documentType,
      page: figure.page,
      snippet: figure.snippet,
      confidence: figure.confidence,
      value: figure.value,
    };

    out.push({ modelPath: figure.modelPath, candidates: [fromModel, fromNewDoc] });
  }

  return out;
}
