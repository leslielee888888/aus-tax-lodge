"use server";

import { redirect } from "next/navigation";

import { resolveReconciliation } from "@aus-tax-lodge/extraction";
import {
  answer,
  confirm,
  confirmRepairsAreDeductible,
  createEmptyReturnModel,
  edit,
  markNotApplicable,
  reclassifyRepairsAsCapital,
  RETURN_MODEL_VERSION,
  type InterestAccount,
  type ReturnModel,
} from "@aus-tax-lodge/model";

import {
  mergePendingReconciliation,
  readExtractionScratch,
  withExtractionScratch,
} from "../../../../lib/extraction-scratch";
import { buildReviewData } from "../../../../lib/review/build-sections";
import { getReviewField, setReviewField } from "../../../../lib/review/field-paths";
import { getReturnRepository } from "../../../../lib/returns";
import { getDocumentStore } from "../../../../lib/store";

/** Structural check that a decrypted envelope's opaque `data` is our model, not some other/earlier shape. */
function isReturnModel(data: unknown): data is ReturnModel {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { modelVersion?: unknown }).modelVersion === RETURN_MODEL_VERSION
  );
}

export interface ReviewActionResult {
  readonly ok: boolean;
  /** The fresh model on success — the caller replaces its local copy with this. */
  readonly model?: ReturnModel;
  readonly revision?: number;
  readonly error?: string;
  readonly conflict?: boolean;
}

const READ_ONLY_ERROR =
  "This return is read-only — it was built against a retired tax year and can't be edited.";
const CONFLICT_ERROR =
  "This return changed in another tab. Reload the page to see the latest version.";

type LoadResult =
  | { readonly ok: true; readonly model: ReturnModel }
  | { readonly ok: false; readonly result: ReviewActionResult };

async function loadEditableModel(returnId: string): Promise<LoadResult> {
  const { envelope, readOnly } = await getReturnRepository().loadReturn(returnId);
  if (readOnly) return { ok: false, result: { ok: false, error: READ_ONLY_ERROR } };
  const model = isReturnModel(envelope.data)
    ? envelope.data
    : createEmptyReturnModel(envelope.targetYear);
  return { ok: true, model };
}

async function saveModel(
  returnId: string,
  expectedRevision: number,
  nextModel: ReturnModel,
  currentStep?: string,
): Promise<ReviewActionResult> {
  const result = await getReturnRepository().saveReturn(returnId, {
    data: nextModel,
    currentStep,
    expectedRevision,
  });
  if (result.conflict) {
    return { ok: false, conflict: true, error: CONFLICT_ERROR };
  }
  return {
    ok: true,
    model: result.envelope.data as ReturnModel,
    revision: result.envelope.revision,
  };
}

function parseNumber(raw: string): number | null {
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

// ---------------------------------------------------------------------------
// Generic single-field rows (PRD FR-7)
// ---------------------------------------------------------------------------

/** Accept a proposed figure unchanged. */
export async function confirmField(
  returnId: string,
  expectedRevision: number,
  path: string,
): Promise<ReviewActionResult> {
  const loaded = await loadEditableModel(returnId);
  if (!loaded.ok) return loaded.result;
  const field = getReviewField(loaded.model, path);
  const nextModel = setReviewField(loaded.model, path, confirm(field));
  return saveModel(returnId, expectedRevision, nextModel);
}

/** Change a figure's value — records the edit and marks it confirmed (PRD FR-7). */
export async function editField(
  returnId: string,
  expectedRevision: number,
  path: string,
  rawValue: string,
): Promise<ReviewActionResult> {
  const value = parseNumber(rawValue);
  if (value === null) return { ok: false, error: "Enter a valid number." };
  const loaded = await loadEditableModel(returnId);
  if (!loaded.ok) return loaded.result;
  const field = getReviewField(loaded.model, path);
  const nextModel = setReviewField(loaded.model, path, edit(field, value));
  return saveModel(returnId, expectedRevision, nextModel);
}

/** Mark a label "nil / not applicable" (PRD FR-7). */
export async function markFieldNotApplicable(
  returnId: string,
  expectedRevision: number,
  path: string,
): Promise<ReviewActionResult> {
  const loaded = await loadEditableModel(returnId);
  if (!loaded.ok) return loaded.result;
  const field = getReviewField(loaded.model, path);
  const nextModel = setReviewField(loaded.model, path, markNotApplicable(field));
  return saveModel(returnId, expectedRevision, nextModel);
}

// ---------------------------------------------------------------------------
// Interest accounts — gross interest + ownership share confirmed together
// ---------------------------------------------------------------------------

function findInterestAccount(model: ReturnModel, accountId: string): InterestAccount {
  const account = model.income.interestAccounts.find((a) => a.id === accountId);
  if (!account) throw new Error(`review: no interest account "${accountId}"`);
  return account;
}

function replaceInterestAccount(
  model: ReturnModel,
  accountId: string,
  update: (account: InterestAccount) => InterestAccount,
): ReturnModel {
  const interestAccounts = model.income.interestAccounts.map((a) =>
    a.id === accountId ? update(a) : a,
  );
  return { ...model, income: { ...model.income, interestAccounts } };
}

export async function confirmInterestAccount(
  returnId: string,
  expectedRevision: number,
  accountId: string,
): Promise<ReviewActionResult> {
  const loaded = await loadEditableModel(returnId);
  if (!loaded.ok) return loaded.result;
  findInterestAccount(loaded.model, accountId); // throws if stale
  const nextModel = replaceInterestAccount(loaded.model, accountId, (a) => ({
    ...a,
    grossInterest: confirm(a.grossInterest),
    ownershipSharePercent: confirm(a.ownershipSharePercent),
  }));
  return saveModel(returnId, expectedRevision, nextModel);
}

export async function editInterestAccount(
  returnId: string,
  expectedRevision: number,
  accountId: string,
  grossInterestRaw: string,
  ownershipSharePercentRaw: string,
): Promise<ReviewActionResult> {
  const grossInterest = parseNumber(grossInterestRaw);
  const share = parseNumber(ownershipSharePercentRaw);
  if (grossInterest === null || share === null) return { ok: false, error: "Enter valid numbers." };
  if (share < 0 || share > 100)
    return { ok: false, error: "Ownership share must be between 0 and 100." };
  const loaded = await loadEditableModel(returnId);
  if (!loaded.ok) return loaded.result;
  findInterestAccount(loaded.model, accountId);
  const nextModel = replaceInterestAccount(loaded.model, accountId, (a) => ({
    ...a,
    grossInterest: edit(a.grossInterest, grossInterest),
    ownershipSharePercent: edit(a.ownershipSharePercent, share),
  }));
  return saveModel(returnId, expectedRevision, nextModel);
}

export async function markInterestAccountNotApplicable(
  returnId: string,
  expectedRevision: number,
  accountId: string,
): Promise<ReviewActionResult> {
  const loaded = await loadEditableModel(returnId);
  if (!loaded.ok) return loaded.result;
  findInterestAccount(loaded.model, accountId);
  const nextModel = replaceInterestAccount(loaded.model, accountId, (a) => ({
    ...a,
    grossInterest: markNotApplicable(a.grossInterest),
    ownershipSharePercent: markNotApplicable(a.ownershipSharePercent),
  }));
  return saveModel(returnId, expectedRevision, nextModel);
}

// ---------------------------------------------------------------------------
// Private health — "did you hold cover?" (feeds `toEngineInput`'s required `held`)
// ---------------------------------------------------------------------------

export async function setPrivateHealthHeld(
  returnId: string,
  expectedRevision: number,
  held: boolean,
): Promise<ReviewActionResult> {
  const loaded = await loadEditableModel(returnId);
  if (!loaded.ok) return loaded.result;
  const nextModel: ReturnModel = {
    ...loaded.model,
    privateHealth: {
      ...loaded.model.privateHealth,
      held: answer(loaded.model.privateHealth.held, held),
    },
  };
  return saveModel(returnId, expectedRevision, nextModel);
}

// ---------------------------------------------------------------------------
// Rental repairs-vs-capital gate (PRD Q25, FR-13, FR-24)
// ---------------------------------------------------------------------------

/** "It's a repair" — confirms the repairs line is a genuine repair AND settles its amount. */
export async function confirmRepairs(
  returnId: string,
  expectedRevision: number,
): Promise<ReviewActionResult> {
  const loaded = await loadEditableModel(returnId);
  if (!loaded.ok) return loaded.result;
  let rental = confirmRepairsAreDeductible(loaded.model.rental);
  rental = {
    ...rental,
    expenses: {
      ...rental.expenses,
      repairsAndMaintenance: {
        ...rental.expenses.repairsAndMaintenance,
        amount: confirm(rental.expenses.repairsAndMaintenance.amount),
      },
    },
  };
  const nextModel: ReturnModel = { ...loaded.model, rental };
  return saveModel(returnId, expectedRevision, nextModel);
}

/** "Capital" — moves the amount into capital works; both lines return to `proposed` for a fresh accept. */
export async function reclassifyRepairs(
  returnId: string,
  expectedRevision: number,
): Promise<ReviewActionResult> {
  const loaded = await loadEditableModel(returnId);
  if (!loaded.ok) return loaded.result;
  const rental = reclassifyRepairsAsCapital(loaded.model.rental);
  const nextModel: ReturnModel = { ...loaded.model, rental };
  return saveModel(returnId, expectedRevision, nextModel);
}

// ---------------------------------------------------------------------------
// Multi-document reconciliation (PRD FR-21)
// ---------------------------------------------------------------------------

export async function resolveMismatch(
  returnId: string,
  expectedRevision: number,
  modelPath: string,
  chosenIndex: number,
): Promise<ReviewActionResult> {
  const loaded = await loadEditableModel(returnId);
  if (!loaded.ok) return loaded.result;
  const scratch = readExtractionScratch(loaded.model);
  const { model: resolvedModel, unresolved } = resolveReconciliation(
    loaded.model,
    scratch.pendingReconciliation,
    [{ modelPath, chosenIndex }],
  );
  const nextModel = withExtractionScratch(resolvedModel, {
    ...scratch,
    pendingReconciliation: mergePendingReconciliation([], unresolved),
  });
  return saveModel(returnId, expectedRevision, nextModel);
}

// ---------------------------------------------------------------------------
// Continue / delete
// ---------------------------------------------------------------------------

/**
 * Re-checks every gate server-side (a client can always be bypassed) before
 * advancing `currentStep` to `questions` and redirecting there (PRD FR-7).
 */
export async function continueToQuestions(
  returnId: string,
  expectedRevision: number,
): Promise<ReviewActionResult> {
  const loaded = await loadEditableModel(returnId);
  if (!loaded.ok) return loaded.result;

  const documents = await getDocumentStore().listDocuments(returnId);
  const documentsByDocId = Object.fromEntries(documents.map((d) => [d.docId, d.filename]));
  const scratch = readExtractionScratch(loaded.model);
  const { canContinue } = buildReviewData(
    loaded.model,
    scratch.pendingReconciliation,
    documentsByDocId,
  );
  if (!canContinue) {
    return { ok: false, error: "Resolve every item above before continuing." };
  }

  const result = await getReturnRepository().saveReturn(returnId, {
    data: loaded.model,
    currentStep: "questions",
    expectedRevision,
  });
  if (result.conflict) {
    return { ok: false, conflict: true, error: CONFLICT_ERROR };
  }

  redirect(`/returns/${returnId}/questions`);
}

/** Deletes the whole return (PRD FR-20 hard-stop screen — the only ways out are this or an agent/myTax). */
export async function deleteReturnAction(returnId: string): Promise<void> {
  await getReturnRepository().deleteReturn(returnId);
  redirect("/");
}
