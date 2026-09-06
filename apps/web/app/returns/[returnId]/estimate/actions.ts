"use server";

import { redirect } from "next/navigation";

import {
  createEmptyReturnModel,
  isReadyForEstimate,
  RETURN_MODEL_VERSION,
  type ReturnModel,
} from "@aus-tax-lodge/model";

import { getReturnRepository } from "../../../../lib/returns";

export interface ContinueToExportResult {
  readonly ok: boolean;
  /** A whole-form problem — a save conflict, a read-only return, an unmet gate. */
  readonly error?: string;
  /** `true` when the save was refused because the return changed elsewhere (last-write-wins, PRD FR-16). */
  readonly conflict?: boolean;
}

const CONFLICT_ERROR =
  "This return changed in another tab. Reload the page to see the latest version, then try again.";

function isReturnModel(data: unknown): data is ReturnModel {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { modelVersion?: unknown }).modelVersion === RETURN_MODEL_VERSION
  );
}

/**
 * Advances a return from the estimate step to export (PRD §7). Mirrors
 * `review/actions.ts` `continueToQuestions` — a plain `(returnId, revision)`
 * call from a client button rather than a `<form>` action, so there is no
 * unused `FormData` parameter. Re-checks the gate server-side (a client can
 * always be bypassed), then saves `currentStep: "export"` with last-write-wins
 * conflict detection and redirects. T20 replaces the placeholder export page.
 */
export async function continueToExport(
  returnId: string,
  expectedRevision: number,
): Promise<ContinueToExportResult> {
  const repository = getReturnRepository();
  const { envelope, readOnly } = await repository.loadReturn(returnId);

  if (readOnly) {
    return {
      ok: false,
      error:
        "This return is read-only — it was built against a retired tax year and can't be edited.",
    };
  }

  const model = isReturnModel(envelope.data)
    ? envelope.data
    : createEmptyReturnModel(envelope.targetYear);

  if (!isReadyForEstimate(model)) {
    return { ok: false, error: "Finish the review and questions steps before continuing." };
  }

  const result = await repository.saveReturn(returnId, {
    data: model,
    currentStep: "export",
    expectedRevision,
  });

  if (result.conflict) {
    return { ok: false, conflict: true, error: CONFLICT_ERROR };
  }

  redirect(`/returns/${returnId}/export`);
}
