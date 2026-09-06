import { assess, getTaxonomy, PARAMS_VERSION, type FullAssessment } from "@aus-tax-lodge/engine";
import type { ExportPackageInput } from "@aus-tax-lodge/export";
import {
  isReadyForEstimate,
  MissingFiguresError,
  toEngineInput,
  type ReturnModel,
} from "@aus-tax-lodge/model";
import type { ReturnEnvelope } from "@aus-tax-lodge/store";

import { loadReturnModel } from "../returns";
import { getDocumentStore } from "../store";
import { deriveStatedAssumptions } from "./assumptions";

/**
 * Everything the export step needs about one return, loaded server-side
 * (PRD FR-14). The estimate assessment is computed here exactly as the
 * estimate screen does — `assess(toEngineInput(model))` — so the export
 * figures can never drift from the estimate (FR-14 "figures must match").
 */
export interface ExportContext {
  readonly returnId: string;
  readonly envelope: ReturnEnvelope;
  readonly readOnly: boolean;
  readonly model: ReturnModel;
  readonly documents: readonly { readonly docId: string; readonly filename: string }[];
  /** The engine assessment, or `null` when a required figure is still missing. */
  readonly assessment: FullAssessment | null;
  /** Dot-paths of the still-unconfirmed figures, when `assessment` is `null`. */
  readonly missingFigures: readonly string[] | null;
  /** `true` when every in-scope figure is confirmed and the questionnaire is answered. */
  readonly ready: boolean;
  readonly statedAssumptions: readonly string[];
}

/** Load the model + documents + assessment for the export step. Throws only if the return does not exist. */
export async function loadExportContext(returnId: string): Promise<ExportContext> {
  const { envelope, readOnly, model } = await loadReturnModel(returnId);
  const documentMetadata = await getDocumentStore().listDocuments(returnId);
  const documents = documentMetadata.map((d) => ({ docId: d.docId, filename: d.filename }));

  let assessment: FullAssessment | null = null;
  let missingFigures: readonly string[] | null = null;
  try {
    assessment = assess(toEngineInput(model));
  } catch (err) {
    if (err instanceof MissingFiguresError) {
      missingFigures = err.fields;
    } else {
      throw err;
    }
  }

  return {
    returnId,
    envelope,
    readOnly,
    model,
    documents,
    assessment,
    missingFigures,
    ready: isReadyForEstimate(model),
    statedAssumptions: assessment ? deriveStatedAssumptions(model, assessment) : [],
  };
}

/**
 * Build the fully-resolved {@link ExportPackageInput} for the builders in
 * `@aus-tax-lodge/export`. `context.assessment` must be non-null (the caller
 * has checked, or the export is blocked).
 */
export function buildExportInput(
  context: ExportContext,
  acknowledgedWarningIds: readonly string[],
  generatedAt: string,
): ExportPackageInput {
  if (!context.assessment) {
    throw new Error("cannot build the export package: the assessment could not be computed");
  }
  return {
    model: context.model,
    assessment: context.assessment,
    taxonomy: getTaxonomy(context.envelope.targetYear),
    paramsVersion: context.envelope.paramsVersion || PARAMS_VERSION,
    targetYear: context.envelope.targetYear,
    documents: context.documents,
    acknowledgedWarningIds,
    statedAssumptions: context.statedAssumptions,
    generatedAt,
  };
}
