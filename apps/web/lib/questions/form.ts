/**
 * The T18 gap questionnaire (PRD FR-6): its value shape, the pure mapping
 * to/from a {@link ReturnModel}, and validation. Dependency-free (no React, no
 * Next, no filesystem) so it is unit-testable and shared verbatim between the
 * client form (`QuestionsForm.tsx`) and the server action (`actions.ts`) —
 * mirroring how `lib/details/form.ts` (T15) is structured.
 *
 * Two of the six questions are **cross-checks** against a fact T15 already
 * collected on `context` (residency, study loan) rather than a fresh fact —
 * see `residencyDisagrees` / `studyLoanDisagrees`. When the questionnaire
 * answer disagrees with `context`, neither side is silently trusted: the
 * caller must supply a `DisagreementResolution` (which one is right), and
 * {@link applyQuestionsToModel} then updates *both* fields to agree with
 * whichever the user picked (PRD FR-6, "answered ... recorded with the same
 * provenance model as extractions").
 *
 * Field → model path:
 *   residencyFullYear        → questionnaire.residencyFullYear
 *     (+ context.residency, only on an explicit disagreement resolution)
 *   studyLoanHeld             → questionnaire.studyLoanHeld
 *     (+ context.holdsStudyLoan, only on an explicit disagreement resolution)
 *   privateCoverDates/-Days  → questionnaire.privateCoverDatesConfirmed
 *                               + context.privateHospitalCoverDays
 *   wfhDoubleClaimed          → questionnaire.wfhHoursNotDoubleClaimed
 *                               (the UI asks the double-claim question; the
 *                               model field is its negation — see the doc
 *                               comment on `QuestionnaireAnswers`)
 *   jointAccounts[].sharePercent → income.interestAccounts[id].ownershipSharePercent
 *                               + questionnaire.jointAccountSharesProvided
 *   rentalSoleOwnershipAllYear/  → questionnaire.rentalScopeGate
 *     rentalBoughtOrSold           (only when `model.rental.present`)
 */
import {
  answer,
  isSettled,
  type InterestAccount,
  type RentalScopeGateAnswer,
  type ReturnModel,
} from "@aus-tax-lodge/model";

import { validateDayCount } from "../details/validation";

export type YesNo = "yes" | "no";
export type PrivateCoverChoice = "full" | "part" | "none";

/** Which side of a cross-check disagreement the user says is correct. */
export type DisagreementResolution = "keep-details" | "use-answer";

export interface JointAccountFieldValue {
  readonly accountId: string;
  /** Raw percent input, `"0"`–`"100"`. */
  readonly sharePercent: string;
}

export interface JointAccountRowInfo {
  readonly accountId: string;
  /** `"<institution> — <description>"`, or a generic fallback. */
  readonly label: string;
}

export interface QuestionsFormValues {
  readonly residencyFullYear: YesNo;
  /** Present only once the user has picked a side of a residency disagreement. */
  readonly residencyDisagreement?: DisagreementResolution;
  readonly studyLoanHeld: YesNo;
  /** Present only once the user has picked a side of a study-loan disagreement. */
  readonly studyLoanDisagreement?: DisagreementResolution;
  readonly privateCoverDates: PrivateCoverChoice;
  /** Only meaningful (and required) when `privateCoverDates !== "full"`. */
  readonly privateCoverDays: string;
  /** `"yes"` = WFH hours *were* also claimed separately (a double claim). */
  readonly wfhDoubleClaimed: YesNo;
  readonly jointAccounts: readonly JointAccountFieldValue[];
  /** Only asked (and applied) when `model.rental.present`. */
  readonly rentalSoleOwnershipAllYear: YesNo;
  readonly rentalBoughtOrSold: YesNo;
}

export interface QuestionsFieldErrors {
  readonly residencyDisagreement?: string;
  readonly studyLoanDisagreement?: string;
  readonly privateCoverDays?: string;
  /** Keyed by `accountId`. */
  readonly jointAccounts?: Readonly<Record<string, string>>;
}

// ---------------------------------------------------------------------------
// Small parsing helper
// ---------------------------------------------------------------------------

/** A percent, `0`–`100` inclusive. */
export function validatePercent(raw: string, label: string): string | null {
  if (!raw.trim()) return `${label} is required`;
  const n = Number(raw);
  if (!Number.isFinite(n)) return `${label} must be a number`;
  return n >= 0 && n <= 100 ? null : `${label} must be between 0 and 100`;
}

// ---------------------------------------------------------------------------
// Reading the model — labels, defaults, cross-check state
// ---------------------------------------------------------------------------

/** `"<institution> — <description>"`, trimmed of whichever half is empty. */
export function describeInterestAccount(account: InterestAccount): string {
  const parts = [account.institution.value, account.accountDescription.value].filter(
    (part): part is string => Boolean(part),
  );
  return parts.length > 0 ? parts.join(" — ") : "Interest account";
}

/** Every interest account whose ownership share isn't yet settled — these get a row on the form. */
export function unsettledJointAccounts(model: ReturnModel): readonly JointAccountRowInfo[] {
  return model.income.interestAccounts
    .filter((account) => !isSettled(account.ownershipSharePercent))
    .map((account) => ({ accountId: account.id, label: describeInterestAccount(account) }));
}

/** What T15's details step says about residency, reduced to the questionnaire's yes/no shape. */
export function detailsResidentFullYear(model: ReturnModel): boolean {
  return model.context.residency.value == null || model.context.residency.value === "resident-full-year";
}

/** What T15's details step says about holding a study/training loan. */
export function detailsHoldsStudyLoan(model: ReturnModel): boolean {
  return model.context.holdsStudyLoan.value === true;
}

/** `true` when the questionnaire's residency answer would disagree with the confirmed details-step value. */
export function residencyDisagrees(model: ReturnModel, questionnaireAnswerYes: boolean): boolean {
  return isSettled(model.context.residency) && detailsResidentFullYear(model) !== questionnaireAnswerYes;
}

/** `true` when the questionnaire's study-loan answer would disagree with the confirmed details-step value. */
export function studyLoanDisagrees(model: ReturnModel, questionnaireAnswerYes: boolean): boolean {
  return isSettled(model.context.holdsStudyLoan) && detailsHoldsStudyLoan(model) !== questionnaireAnswerYes;
}

/** A short label for the rental property, for the scope-gate questions' copy. */
export function rentalAddressLabel(model: ReturnModel): string {
  return model.rental.property.addressLine1.value ?? "your rental property";
}

/** Pre-fill the form from a saved (or empty) return model — the "resuming" state. */
export function initialQuestionsFormValues(model: ReturnModel): QuestionsFormValues {
  const q = model.questionnaire;
  const days = model.context.privateHospitalCoverDays.value;
  const privateCoverDates: PrivateCoverChoice = days == null || days >= 365 ? "full" : days <= 0 ? "none" : "part";

  const gate = q.rentalScopeGate.value;
  const rentalAllYear = gate ? gate.solelyOwned && gate.rentedOrAvailableAllYear && gate.noPrivateUse : true;

  return {
    residencyFullYear:
      q.residencyFullYear.value != null
        ? q.residencyFullYear.value
          ? "yes"
          : "no"
        : detailsResidentFullYear(model)
          ? "yes"
          : "no",
    studyLoanHeld:
      q.studyLoanHeld.value != null
        ? q.studyLoanHeld.value
          ? "yes"
          : "no"
        : detailsHoldsStudyLoan(model)
          ? "yes"
          : "no",
    privateCoverDates,
    privateCoverDays: days != null ? String(days) : "",
    wfhDoubleClaimed: q.wfhHoursNotDoubleClaimed.value === false ? "yes" : "no",
    jointAccounts: unsettledJointAccounts(model).map((row) => ({ accountId: row.accountId, sharePercent: "" })),
    rentalSoleOwnershipAllYear: rentalAllYear ? "yes" : "no",
    rentalBoughtOrSold: gate ? (gate.notBoughtOrSoldThisYear ? "no" : "yes") : "no",
  };
}

// ---------------------------------------------------------------------------
// Reading submitted FormData
// ---------------------------------------------------------------------------

function yesNo(raw: string, fallback: YesNo): YesNo {
  return raw === "yes" ? "yes" : raw === "no" ? "no" : fallback;
}

function disagreementChoice(raw: string): DisagreementResolution | undefined {
  return raw === "keep-details" || raw === "use-answer" ? raw : undefined;
}

/** Read the raw `FormData` a submit posts into a {@link QuestionsFormValues}. `jointAccountIds` is the closed set of rows the form rendered (unsettled accounts as of page load). */
export function parseQuestionsFormData(
  formData: FormData,
  jointAccountIds: readonly string[],
): QuestionsFormValues {
  const str = (name: string) => (formData.get(name)?.toString() ?? "").trim();
  const privateCoverDatesRaw = str("privateCoverDates");

  return {
    residencyFullYear: yesNo(str("residencyFullYear"), "yes"),
    residencyDisagreement: disagreementChoice(str("residencyDisagreement")),
    studyLoanHeld: yesNo(str("studyLoanHeld"), "no"),
    studyLoanDisagreement: disagreementChoice(str("studyLoanDisagreement")),
    privateCoverDates:
      privateCoverDatesRaw === "part" || privateCoverDatesRaw === "none" ? privateCoverDatesRaw : "full",
    privateCoverDays: str("privateCoverDays"),
    wfhDoubleClaimed: yesNo(str("wfhDoubleClaimed"), "no"),
    jointAccounts: jointAccountIds.map((accountId) => ({
      accountId,
      sharePercent: str(`jointShare.${accountId}`),
    })),
    rentalSoleOwnershipAllYear: yesNo(str("rentalSoleOwnershipAllYear"), "yes"),
    rentalBoughtOrSold: yesNo(str("rentalBoughtOrSold"), "no"),
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidateQuestionsOpts {
  readonly residencyDisagreementPresent: boolean;
  readonly studyLoanDisagreementPresent: boolean;
}

/** Validate the whole form (PRD FR-6). Run on the client (submit) and again in the server action. */
export function validateQuestionsForm(
  values: QuestionsFormValues,
  opts: ValidateQuestionsOpts,
): QuestionsFieldErrors {
  const errors: {
    residencyDisagreement?: string;
    studyLoanDisagreement?: string;
    privateCoverDays?: string;
    jointAccounts?: Record<string, string>;
  } = {};

  if (opts.residencyDisagreementPresent && !values.residencyDisagreement) {
    errors.residencyDisagreement = "Choose which is correct before continuing.";
  }
  if (opts.studyLoanDisagreementPresent && !values.studyLoanDisagreement) {
    errors.studyLoanDisagreement = "Choose which is correct before continuing.";
  }
  if (values.privateCoverDates !== "full") {
    const error = validateDayCount(values.privateCoverDays, "Days of private hospital cover");
    if (error) errors.privateCoverDays = error;
  }

  const jointErrors: Record<string, string> = {};
  for (const account of values.jointAccounts) {
    const error = validatePercent(account.sharePercent, "Ownership share");
    if (error) jointErrors[account.accountId] = error;
  }
  if (Object.keys(jointErrors).length > 0) errors.jointAccounts = jointErrors;

  return errors;
}

// ---------------------------------------------------------------------------
// Folding valid values into the model
// ---------------------------------------------------------------------------

/**
 * Fold valid, submitted values into a {@link ReturnModel} (PRD FR-6). Every
 * field here is the user's own entry, so it lands `confirmed` via
 * {@link answer} — never `proposed`. Callers must validate first
 * ({@link validateQuestionsForm}) — this does not re-validate.
 *
 * A residency/study-loan disagreement resolution, when present, updates
 * *both* `context` (T15's field) and `questionnaire` (this step's field) to
 * agree — "keep-details" reverts the questionnaire answer to match `context`;
 * "use-answer" overwrites `context` to match what was just answered here.
 * With no disagreement, only the questionnaire field is touched.
 */
export function applyQuestionsToModel(model: ReturnModel, values: QuestionsFormValues): ReturnModel {
  const residencyAnswerYes = values.residencyFullYear === "yes";
  let residencyFullYearField = answer(model.questionnaire.residencyFullYear, residencyAnswerYes);
  let residencyField = model.context.residency;
  if (values.residencyDisagreement === "use-answer") {
    residencyField = answer(
      model.context.residency,
      residencyAnswerYes ? "resident-full-year" : "non-resident",
    );
  } else if (values.residencyDisagreement === "keep-details") {
    residencyFullYearField = answer(model.questionnaire.residencyFullYear, detailsResidentFullYear(model));
  }

  const studyLoanAnswerYes = values.studyLoanHeld === "yes";
  let studyLoanHeldField = answer(model.questionnaire.studyLoanHeld, studyLoanAnswerYes);
  let holdsStudyLoanField = model.context.holdsStudyLoan;
  if (values.studyLoanDisagreement === "use-answer") {
    holdsStudyLoanField = answer(model.context.holdsStudyLoan, studyLoanAnswerYes);
  } else if (values.studyLoanDisagreement === "keep-details") {
    studyLoanHeldField = answer(model.questionnaire.studyLoanHeld, detailsHoldsStudyLoan(model));
  }

  const privateCoverDays = values.privateCoverDates === "full" ? 365 : Number(values.privateCoverDays);
  const privateHospitalCoverDaysField = answer(model.context.privateHospitalCoverDays, privateCoverDays);
  const privateCoverDatesConfirmedField = answer(model.questionnaire.privateCoverDatesConfirmed, true);

  const wfhHoursNotDoubleClaimedField = answer(
    model.questionnaire.wfhHoursNotDoubleClaimed,
    values.wfhDoubleClaimed === "no",
  );

  const shareByAccountId = new Map(values.jointAccounts.map((row) => [row.accountId, row.sharePercent]));
  const interestAccounts = model.income.interestAccounts.map((account) => {
    const sharePercent = shareByAccountId.get(account.id);
    if (sharePercent === undefined) return account;
    return {
      ...account,
      ownershipSharePercent: answer(account.ownershipSharePercent, Number(sharePercent)),
    };
  });
  const jointAccountSharesProvidedField = answer(model.questionnaire.jointAccountSharesProvided, true);

  let rentalScopeGateField = model.questionnaire.rentalScopeGate;
  if (model.rental.present) {
    const allYear = values.rentalSoleOwnershipAllYear === "yes";
    const gate: RentalScopeGateAnswer = {
      solelyOwned: allYear,
      rentedOrAvailableAllYear: allYear,
      noPrivateUse: allYear,
      notBoughtOrSoldThisYear: values.rentalBoughtOrSold === "no",
    };
    rentalScopeGateField = answer(model.questionnaire.rentalScopeGate, gate);
  }

  return {
    ...model,
    context: {
      ...model.context,
      residency: residencyField,
      holdsStudyLoan: holdsStudyLoanField,
      privateHospitalCoverDays: privateHospitalCoverDaysField,
    },
    income: { ...model.income, interestAccounts },
    questionnaire: {
      residencyFullYear: residencyFullYearField,
      jointAccountSharesProvided: jointAccountSharesProvidedField,
      studyLoanHeld: studyLoanHeldField,
      privateCoverDatesConfirmed: privateCoverDatesConfirmedField,
      wfhHoursNotDoubleClaimed: wfhHoursNotDoubleClaimedField,
      rentalScopeGate: rentalScopeGateField,
    },
  };
}
