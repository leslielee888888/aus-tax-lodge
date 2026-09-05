"use server";

import { redirect } from "next/navigation";

import {
  applyExtractions,
  extractDocument,
  type DocumentExtractionResult,
} from "@aus-tax-lodge/extraction";
import { createEmptyReturnModel, RETURN_MODEL_VERSION, type ReturnModel } from "@aus-tax-lodge/model";

import { getClaudeClient } from "../../../../lib/ai/client";
import {
  mergePendingReconciliation,
  readExtractionScratch,
  withExtractionScratch,
} from "../../../../lib/extraction-scratch";
import { getReturnRepository } from "../../../../lib/returns";
import { getDocumentStore } from "../../../../lib/store";

export interface FailedExtraction {
  readonly docId: string;
  readonly filename: string;
  readonly reason: string;
}

export interface ExtractFiguresState {
  readonly status: "idle" | "partial" | "error";
  /** Every document `extractFigures` could not read this run (PRD §7 step 4). */
  readonly failed?: readonly FailedExtraction[];
  /** `docId`s this run successfully extracted and applied — lets the client update optimistically without a reload. */
  readonly succeeded?: readonly { readonly docId: string; readonly figuresCount: number }[];
  readonly formError?: string;
  readonly conflict?: boolean;
}

export const INITIAL_EXTRACT_FIGURES_STATE: ExtractFiguresState = { status: "idle" };

function isReturnModel(data: unknown): data is ReturnModel {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { modelVersion?: unknown }).modelVersion === RETURN_MODEL_VERSION
  );
}

/**
 * Runs figure extraction (PRD FR-3) over every extractable document the
 * return hasn't already had extracted, folds the results into the model with
 * `applyExtractions` (PRD FR-2, FR-7, FR-21), and saves.
 *
 * A single document's extraction failure is caught and skipped — the rest of
 * the batch, and the save of whatever succeeded, still go ahead (PRD §7 step
 * 4, "extraction failed for a file"). Only once every currently-outstanding
 * extractable document has succeeded does this advance `currentStep` to
 * `"review"` and redirect there; otherwise it returns the failures for the
 * documents screen to show. From there the user can either re-click "Extract
 * figures" (retries every still-outstanding document, failed ones included —
 * `extracted` in the scratch bucket only ever grows on success) or correct a
 * failed file's type to "Unrecognised", which flips it `extractable: false`
 * and drops it out of every future run.
 */
export async function extractFigures(
  returnId: string,
  expectedRevision: number,
  _previous: ExtractFiguresState,
  _formData: FormData,
): Promise<ExtractFiguresState> {
  const repository = getReturnRepository();
  const { envelope, readOnly } = await repository.loadReturn(returnId);
  if (readOnly) {
    return {
      status: "error",
      formError:
        "This return is read-only — it was built against a retired tax year and can't be edited.",
    };
  }

  const documentStore = getDocumentStore();
  const documents = await documentStore.listDocuments(returnId);
  const client = getClaudeClient();

  const currentModel = isReturnModel(envelope.data)
    ? envelope.data
    : createEmptyReturnModel(envelope.targetYear);
  const scratch = readExtractionScratch(currentModel);
  const alreadyExtracted = new Set(scratch.extracted.map((entry) => entry.docId));

  const pending = documents.filter((doc) => doc.extractable && !alreadyExtracted.has(doc.docId));

  const extractions: DocumentExtractionResult[] = [];
  const failed: FailedExtraction[] = [];
  const succeeded: { docId: string; figuresCount: number }[] = [];
  for (const doc of pending) {
    try {
      const result = await extractDocument(returnId, doc.docId, { store: documentStore, client });
      extractions.push(result);
      succeeded.push({ docId: doc.docId, figuresCount: result.figures.length });
    } catch (err) {
      failed.push({
        docId: doc.docId,
        filename: doc.filename,
        reason: err instanceof Error ? err.message : "couldn't read this file",
      });
    }
  }

  const { model: modelWithFigures, pendingReconciliation } = applyExtractions(
    currentModel,
    extractions,
  );
  const nextModel = withExtractionScratch(modelWithFigures, {
    extracted: [...scratch.extracted, ...succeeded],
    pendingReconciliation: mergePendingReconciliation(
      scratch.pendingReconciliation,
      pendingReconciliation,
    ),
  });

  const allDone = failed.length === 0;
  const saveResult = await repository.saveReturn(returnId, {
    data: nextModel,
    currentStep: allDone ? "review" : envelope.currentStep,
    expectedRevision,
  });

  if (saveResult.conflict) {
    return {
      status: "error",
      conflict: true,
      formError:
        "This return changed in another tab. Reload the page to see the latest version.",
    };
  }

  if (!allDone) {
    return { status: "partial", failed, succeeded };
  }

  redirect(`/returns/${returnId}/review`);
}
