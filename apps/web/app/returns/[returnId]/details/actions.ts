"use server";

import { redirect } from "next/navigation";

import { createEmptyReturnModel, RETURN_MODEL_VERSION, type ReturnModel } from "@aus-tax-lodge/model";

import {
  applyDetailsToModel,
  parseDetailsFormData,
  validateDetailsForm,
  type DetailsFieldErrors,
  type DetailsFormValues,
} from "../../../../lib/details/form";
import { getReturnRepository } from "../../../../lib/returns";

export interface DetailsFormState {
  readonly values: DetailsFormValues;
  readonly errors: DetailsFieldErrors;
  /** A whole-form problem, not tied to one field (a save conflict, a lookup failure). */
  readonly formError?: string;
  /** `true` when the save was refused because the return changed elsewhere (last-write-wins). */
  readonly conflict?: boolean;
}

function isReturnModel(data: unknown): data is ReturnModel {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { modelVersion?: unknown }).modelVersion === RETURN_MODEL_VERSION
  );
}

/**
 * Save the details form (PRD FR-1, §7 step 3). Bound with `returnId` and the
 * `expectedRevision` the page loaded (Next's "extra arguments" pattern for
 * server actions), so the form itself only ever posts its fields.
 *
 * Re-validates everything the client already checked — a client can always be
 * bypassed — then folds the values into the return's model with
 * {@link applyDetailsToModel} and saves with last-write-wins conflict
 * detection (PRD FR-16). On success, advances to the documents step.
 */
export async function saveDetails(
  returnId: string,
  expectedRevision: number,
  _previous: DetailsFormState,
  formData: FormData,
): Promise<DetailsFormState> {
  const values = parseDetailsFormData(formData);
  const errors = validateDetailsForm(values);
  if (Object.keys(errors).length > 0) {
    return { values, errors };
  }

  const repository = getReturnRepository();
  const { envelope, readOnly } = await repository.loadReturn(returnId);
  if (readOnly) {
    return {
      values,
      errors: {},
      formError: "This return is read-only — it was built against a retired tax year and can't be edited.",
    };
  }

  const currentModel = isReturnModel(envelope.data)
    ? envelope.data
    : createEmptyReturnModel(envelope.targetYear);
  const nextModel = applyDetailsToModel(currentModel, values);

  const result = await repository.saveReturn(returnId, {
    data: nextModel,
    currentStep: "documents",
    expectedRevision,
  });

  if (result.conflict) {
    return {
      values,
      errors: {},
      conflict: true,
      formError:
        "This return changed in another tab. Reload the page to see the latest version, then re-enter your changes.",
    };
  }

  redirect(`/returns/${returnId}/documents`);
}
