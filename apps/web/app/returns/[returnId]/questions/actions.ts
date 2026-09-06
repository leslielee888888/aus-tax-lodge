"use server";

import { redirect } from "next/navigation";

import { createEmptyReturnModel, RETURN_MODEL_VERSION, type ReturnModel } from "@aus-tax-lodge/model";

import {
  applyQuestionsToModel,
  parseQuestionsFormData,
  residencyDisagrees,
  studyLoanDisagrees,
  unsettledJointAccounts,
  validateQuestionsForm,
  type QuestionsFieldErrors,
  type QuestionsFormValues,
} from "../../../../lib/questions/form";
import { getReturnRepository } from "../../../../lib/returns";

export interface QuestionsFormState {
  readonly values: QuestionsFormValues;
  readonly errors: QuestionsFieldErrors;
  /** A whole-form problem, not tied to one field (a save conflict, read-only). */
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
 * Save the gap questionnaire (PRD FR-6, §7 step 6). Bound with `returnId` and
 * the `expectedRevision` the page loaded, matching T15's `saveDetails` /
 * T17's actions. Re-validates everything the client already checked — a
 * client can always be bypassed — including whether a residency / study-loan
 * disagreement still needs a resolution, then folds the values into the
 * return's model with {@link applyQuestionsToModel} and saves with
 * last-write-wins conflict detection (PRD FR-16). On success, advances to the
 * estimate step.
 */
export async function saveQuestions(
  returnId: string,
  expectedRevision: number,
  _previous: QuestionsFormState,
  formData: FormData,
): Promise<QuestionsFormState> {
  const repository = getReturnRepository();
  const { envelope, readOnly } = await repository.loadReturn(returnId);
  const currentModel = isReturnModel(envelope.data)
    ? envelope.data
    : createEmptyReturnModel(envelope.targetYear);
  const jointAccountIds = unsettledJointAccounts(currentModel).map((row) => row.accountId);
  const values = parseQuestionsFormData(formData, jointAccountIds);

  if (readOnly) {
    return {
      values,
      errors: {},
      formError:
        "This return is read-only — it was built against a retired tax year and can't be edited.",
    };
  }

  const errors = validateQuestionsForm(values, {
    residencyDisagreementPresent: residencyDisagrees(currentModel, values.residencyFullYear === "yes"),
    studyLoanDisagreementPresent: studyLoanDisagrees(currentModel, values.studyLoanHeld === "yes"),
  });
  if (Object.keys(errors).length > 0) {
    return { values, errors };
  }

  const nextModel = applyQuestionsToModel(currentModel, values);

  const result = await repository.saveReturn(returnId, {
    data: nextModel,
    currentStep: "estimate",
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

  redirect(`/returns/${returnId}/estimate`);
}
