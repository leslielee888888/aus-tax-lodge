"use server";

import { redirect } from "next/navigation";

import {
  applyExtractions,
  extractDocument,
  type DocumentExtractionResult,
} from "@aus-tax-lodge/extraction";
import {
  answer,
  assembleRentalSchedule,
  createEmptyReturnModel,
  recomputeNetRentalResult,
  RENTAL_EXPENSE_KEYS,
  RETURN_MODEL_VERSION,
  type OwnerPaidRentalExpenses,
  type RentalExpenseSource,
  type RentalSchedule,
  type RentalSourceDocument,
  type RentalSourceDocuments,
  type ReturnModel,
} from "@aus-tax-lodge/model";

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

// ---------------------------------------------------------------------------
// Rental documents (PRD FR-24) — these do not go through the generic
// `extractDocument` prompt table; they are folded in via `assembleRentalSchedule`.
// ---------------------------------------------------------------------------

const RENTAL_DOC_SLOT = {
  "rental-agent-statement": "agentStatement",
  "loan-interest-summary": "loanSummary",
  "qs-depreciation-schedule": "qsSchedule",
} as const;

type RentalDocType = keyof typeof RENTAL_DOC_SLOT;
type RentalDocSlot = (typeof RENTAL_DOC_SLOT)[RentalDocType];

function isRentalDocType(type: string): type is RentalDocType {
  return type in RENTAL_DOC_SLOT;
}

/** A blank / invalid entry → `undefined`, so `assembleRentalSchedule` leaves that line alone. */
function parseCurrency(raw: FormDataEntryValue | null): number | undefined {
  if (raw == null) return undefined;
  const trimmed = raw
    .toString()
    .trim()
    .replace(/[$,\s]/g, "");
  if (!trimmed) return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Hand-entered Div 43 / Div 40 totals (PRD FR-24 / Q23) — recorded as the user's own answer. */
function applyManualDepreciation(
  schedule: RentalSchedule,
  capitalWorks: number | undefined,
  declineInValue: number | undefined,
): RentalSchedule {
  if (capitalWorks === undefined && declineInValue === undefined) return schedule;
  const expenses = { ...schedule.expenses };
  if (capitalWorks !== undefined) {
    expenses.capitalWorks = {
      amount: answer(expenses.capitalWorks.amount, capitalWorks),
      source: "owner-paid",
    };
  }
  if (declineInValue !== undefined) {
    expenses.declineInValue = {
      amount: answer(expenses.declineInValue.amount, declineInValue),
      source: "owner-paid",
    };
  }
  return recomputeNetRentalResult({ ...schedule, expenses });
}

function slotSourceType(slot: RentalDocSlot): RentalExpenseSource {
  return slot === "agentStatement"
    ? "agent-statement"
    : slot === "loanSummary"
      ? "loan-summary"
      : "qs-schedule";
}

/** A rough count of figures the given document contributed to the assembled schedule, for the panel badge. */
function countFiguresForSlot(schedule: RentalSchedule, slot: RentalDocSlot): number {
  const sourceType = slotSourceType(slot);
  let count = RENTAL_EXPENSE_KEYS.filter(
    (key) =>
      schedule.expenses[key].source === sourceType &&
      schedule.expenses[key].amount.status !== "unset",
  ).length;
  if (slot === "agentStatement") {
    if (schedule.grossRent.origin?.kind === "document") count += 1;
    if (schedule.otherRentalIncome.origin?.kind === "document") count += 1;
  }
  return count;
}

/**
 * Runs figure extraction (PRD FR-3) over every extractable document the
 * return hasn't already had extracted, folds the results into the model with
 * `applyExtractions` (PRD FR-2, FR-7, FR-21), and saves.
 *
 * The three rental document types (agent statement, loan-interest summary, QS
 * depreciation schedule) have no generic prompt — they are folded in through
 * `assembleRentalSchedule` (PRD FR-24), together with any owner-paid expenses
 * and hand-entered Div 43 / Div 40 totals posted from the documents form.
 *
 * A single document's failure is caught and skipped — the rest of the batch,
 * and the save of whatever succeeded, still go ahead (PRD §7 step 4). Only
 * once every currently-outstanding document (rental included) has been
 * processed does this advance `currentStep` to `"review"` and redirect there.
 */
export async function extractFigures(
  returnId: string,
  expectedRevision: number,
  _previous: ExtractFiguresState,
  formData: FormData,
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
  const rentalPending = pending.filter((doc) => isRentalDocType(doc.detectedType));
  const genericPending = pending.filter((doc) => !isRentalDocType(doc.detectedType));

  const extractions: DocumentExtractionResult[] = [];
  const failed: FailedExtraction[] = [];
  const succeeded: { docId: string; figuresCount: number }[] = [];

  for (const doc of genericPending) {
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

  const ownerPaid: OwnerPaidRentalExpenses = {
    insurance: parseCurrency(formData.get("ownerPaidInsurance")),
    landTax: parseCurrency(formData.get("ownerPaidLandTax")),
    bodyCorporate: parseCurrency(formData.get("ownerPaidBodyCorporate")),
  };
  const manualCapitalWorks = parseCurrency(formData.get("manualCapitalWorks"));
  const manualDeclineInValue = parseCurrency(formData.get("manualDeclineInValue"));

  let nextModelBase = modelWithFigures;

  if (currentModel.rental.present) {
    const sourceDocuments: {
      -readonly [K in keyof RentalSourceDocuments]: RentalSourceDocument;
    } = {};
    const included: { docId: string; slot: RentalDocSlot }[] = [];

    for (const doc of rentalPending) {
      const slot = RENTAL_DOC_SLOT[doc.detectedType as RentalDocType];
      try {
        const stored = await documentStore.getDocument(returnId, doc.docId);
        sourceDocuments[slot] = {
          docId: doc.docId,
          bytes: stored.bytes,
          mimeType: stored.metadata.mimeType,
        };
        included.push({ docId: doc.docId, slot });
      } catch (err) {
        failed.push({
          docId: doc.docId,
          filename: doc.filename,
          reason: err instanceof Error ? err.message : "couldn't read this file",
        });
      }
    }

    const hasOwnerPaid = Object.values(ownerPaid).some((v) => v !== undefined);
    const hasManualDepreciation =
      manualCapitalWorks !== undefined || manualDeclineInValue !== undefined;
    const qsDocPresent = documents.some((d) => d.detectedType === "qs-depreciation-schedule");

    if (included.length > 0 || hasOwnerPaid || hasManualDepreciation) {
      let schedule = await assembleRentalSchedule(currentModel, sourceDocuments, client, ownerPaid);
      // Only accept hand-entered Div 43 / Div 40 when there is no QS schedule
      // to read them from (PRD FR-24 / Q23).
      if (!qsDocPresent) {
        schedule = applyManualDepreciation(schedule, manualCapitalWorks, manualDeclineInValue);
      }
      nextModelBase = { ...modelWithFigures, rental: schedule };
      for (const { docId, slot } of included) {
        succeeded.push({ docId, figuresCount: countFiguresForSlot(schedule, slot) });
      }
    }
  }

  const nextModel = withExtractionScratch(nextModelBase, {
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
      formError: "This return changed in another tab. Reload the page to see the latest version.",
    };
  }

  if (!allDone) {
    return { status: "partial", failed, succeeded };
  }

  redirect(`/returns/${returnId}/review`);
}
