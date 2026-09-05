/**
 * The T15 details form: its value shape, the pure mapping to/from a
 * {@link ReturnModel}, and whole-form validation (PRD FR-1). Kept dependency-
 * free (no Next, no filesystem) so it is unit-testable and shared verbatim
 * between the client form and the server action.
 *
 * Field → model path (for T18/T19 to read the same way):
 *   fullName            → taxpayer.fullName
 *   dob                 → taxpayer.dateOfBirth (ISO)
 *   line1/line2/suburb/  → taxpayer.postalAddress
 *     state/postcode
 *   tfn                 → taxpayer.taxFileNumber (full digits, never truncated)
 *   residency           → context.residency
 *   bsb/accountNumber/   → taxpayer.refundAccount
 *     accountName
 *   studyLoan           → context.holdsStudyLoan
 *   privateCoverDays    → context.privateHospitalCoverDays (FR-1's own-cover
 *                          "dates", reduced to a day count — see model.ts)
 *   dependentChildren   → context.dependentChildren
 *   hasSpouse           → context.spouse.status ("had-spouse" | "none")
 *   spouseName          → context.spouse.name
 *   spouseDob           → context.spouse.dateOfBirth (ISO)
 *   spouseIncome        → context.spouse.estimatedTaxableIncome
 *   spouseCoverDays     → context.spouse.privateHospitalCoverDays
 *
 * Every other section of the model (income, deductions, rental, private
 * health, questionnaire) is left untouched — this form only ever reads and
 * rewrites `taxpayer` and the non-rental parts of `context`.
 */
import { answer, type ReturnModel } from "@aus-tax-lodge/model";

import {
  digitsOnly,
  isoToDdMmYyyy,
  normalizeBsb,
  parseDdMmYyyyToIso,
  validateAccountNumber,
  validateBsb,
  validateDayCount,
  validateDob,
  validateNonNegativeAmount,
  validateNonNegativeInteger,
  validatePostcode,
  validateRequired,
  validateTfn,
} from "./validation";

export type ResidencyChoice = "resident-full-year" | "not-resident";

export interface DetailsFormValues {
  readonly fullName: string;
  readonly dob: string; // DD/MM/YYYY
  readonly line1: string;
  readonly line2: string;
  readonly suburb: string;
  readonly state: string;
  readonly postcode: string;
  readonly tfn: string; // digits only, full
  readonly residency: ResidencyChoice;
  readonly bsb: string;
  readonly accountNumber: string;
  readonly accountName: string;
  readonly studyLoan: "yes" | "no";
  readonly privateCoverDays: string;
  readonly dependentChildren: string;
  readonly hasSpouse: boolean;
  readonly spouseName: string;
  readonly spouseDob: string; // DD/MM/YYYY
  readonly spouseIncome: string;
  readonly spouseCoverDays: string;
}

export type DetailsFieldErrors = Partial<Record<keyof DetailsFormValues, string>>;

/** A blank form for a brand-new return. */
export function emptyDetailsFormValues(): DetailsFormValues {
  return {
    fullName: "",
    dob: "",
    line1: "",
    line2: "",
    suburb: "",
    state: "",
    postcode: "",
    tfn: "",
    residency: "resident-full-year",
    bsb: "",
    accountNumber: "",
    accountName: "",
    studyLoan: "no",
    privateCoverDays: "",
    dependentChildren: "0",
    hasSpouse: false,
    spouseName: "",
    spouseDob: "",
    spouseIncome: "",
    spouseCoverDays: "",
  };
}

/** Pre-fill the form from a saved (or empty) return model — the "resuming" state. */
export function detailsFormValuesFromModel(model: ReturnModel): DetailsFormValues {
  const empty = emptyDetailsFormValues();
  const t = model.taxpayer;
  const c = model.context;
  const address = t.postalAddress.value;
  const account = t.refundAccount.value;
  const hasSpouse = c.spouse.status.value === "had-spouse";

  return {
    ...empty,
    fullName: t.fullName.value ?? "",
    dob: t.dateOfBirth.value ? isoToDdMmYyyy(t.dateOfBirth.value) : "",
    line1: address?.line1 ?? "",
    line2: address?.line2 ?? "",
    suburb: address?.suburb ?? "",
    state: address?.state ?? "",
    postcode: address?.postcode ?? "",
    tfn: t.taxFileNumber.value ?? "",
    residency:
      c.residency.value == null || c.residency.value === "resident-full-year"
        ? "resident-full-year"
        : "not-resident",
    bsb: account?.bsb ?? "",
    accountNumber: account?.accountNumber ?? "",
    accountName: account?.accountName ?? "",
    studyLoan: c.holdsStudyLoan.value ? "yes" : "no",
    privateCoverDays:
      c.privateHospitalCoverDays.value != null ? String(c.privateHospitalCoverDays.value) : "",
    dependentChildren: c.dependentChildren.value != null ? String(c.dependentChildren.value) : "0",
    hasSpouse,
    spouseName: c.spouse.name.value ?? "",
    spouseDob: c.spouse.dateOfBirth.value ? isoToDdMmYyyy(c.spouse.dateOfBirth.value) : "",
    spouseIncome:
      c.spouse.estimatedTaxableIncome.value != null
        ? String(c.spouse.estimatedTaxableIncome.value)
        : "",
    spouseCoverDays:
      c.spouse.privateHospitalCoverDays.value != null
        ? String(c.spouse.privateHospitalCoverDays.value)
        : "",
  };
}

/** Read the raw `FormData` a submit posts into a {@link DetailsFormValues}. */
export function parseDetailsFormData(formData: FormData): DetailsFormValues {
  const str = (name: string) => (formData.get(name)?.toString() ?? "").trim();
  return {
    fullName: str("fullName"),
    dob: str("dob"),
    line1: str("line1"),
    line2: str("line2"),
    suburb: str("suburb"),
    state: str("state"),
    postcode: str("postcode"),
    tfn: digitsOnly(str("tfn")),
    residency: str("residency") === "not-resident" ? "not-resident" : "resident-full-year",
    bsb: str("bsb"),
    accountNumber: str("accountNumber"),
    accountName: str("accountName"),
    studyLoan: str("studyLoan") === "yes" ? "yes" : "no",
    privateCoverDays: str("privateCoverDays"),
    dependentChildren: str("dependentChildren"),
    hasSpouse: formData.get("hasSpouse") === "on",
    spouseName: str("spouseName"),
    spouseDob: str("spouseDob"),
    spouseIncome: str("spouseIncome"),
    spouseCoverDays: str("spouseCoverDays"),
  };
}

/** Validate the whole form (PRD FR-1). Run on the client (blur/submit) and again in the server action. */
export function validateDetailsForm(values: DetailsFormValues): DetailsFieldErrors {
  const errors: DetailsFieldErrors = {};
  const set = (field: keyof DetailsFormValues, error: string | null) => {
    if (error) errors[field] = error;
  };

  set("fullName", validateRequired(values.fullName, "Full name"));
  set("dob", validateDob(values.dob, "Date of birth"));
  set("line1", validateRequired(values.line1, "Address line 1"));
  set("suburb", validateRequired(values.suburb, "Suburb"));
  set("state", validateRequired(values.state, "State"));
  set("postcode", validatePostcode(values.postcode));
  set("tfn", validateTfn(values.tfn));
  set("bsb", validateBsb(values.bsb));
  set("accountNumber", validateAccountNumber(values.accountNumber));
  set("accountName", validateRequired(values.accountName, "Account name"));
  set(
    "privateCoverDays",
    validateDayCount(values.privateCoverDays, "Days of private hospital cover"),
  );
  set(
    "dependentChildren",
    validateNonNegativeInteger(values.dependentChildren, "Dependent children"),
  );

  if (values.hasSpouse) {
    set("spouseName", validateRequired(values.spouseName, "Spouse name"));
    set("spouseDob", validateDob(values.spouseDob, "Spouse date of birth"));
    set("spouseIncome", validateNonNegativeAmount(values.spouseIncome, "Spouse taxable income"));
    set(
      "spouseCoverDays",
      validateDayCount(values.spouseCoverDays, "Days spouse held private hospital cover"),
    );
  }

  return errors;
}

/**
 * Fold valid, submitted values into a {@link ReturnModel}. Every field here is
 * the user's own entry, so it lands `confirmed` via {@link answer} (PRD FR-1,
 * FR-7) — never `proposed`. Only `taxpayer` and the non-rental parts of
 * `context` are touched; everything else on `model` passes through unchanged.
 *
 * Callers must validate first ({@link validateDetailsForm}) — this does not
 * re-validate, only parses/normalises (e.g. BSB → `NNN-NNN`, dates → ISO).
 */
export function applyDetailsToModel(model: ReturnModel, values: DetailsFormValues): ReturnModel {
  const dobIso = parseDdMmYyyyToIso(values.dob) ?? "";
  const spouseDobIso = values.hasSpouse ? (parseDdMmYyyyToIso(values.spouseDob) ?? "") : "";

  return {
    ...model,
    taxpayer: {
      fullName: answer(model.taxpayer.fullName, values.fullName),
      dateOfBirth: answer(model.taxpayer.dateOfBirth, dobIso),
      postalAddress: answer(model.taxpayer.postalAddress, {
        line1: values.line1,
        line2: values.line2,
        suburb: values.suburb,
        state: values.state,
        postcode: values.postcode,
        country: "Australia",
      }),
      taxFileNumber: answer(model.taxpayer.taxFileNumber, values.tfn),
      refundAccount: answer(model.taxpayer.refundAccount, {
        bsb: normalizeBsb(values.bsb),
        accountNumber: digitsOnly(values.accountNumber),
        accountName: values.accountName,
      }),
    },
    context: {
      ...model.context,
      residency: answer(
        model.context.residency,
        values.residency === "resident-full-year" ? "resident-full-year" : "non-resident",
      ),
      spouse: values.hasSpouse
        ? {
            status: answer(model.context.spouse.status, "had-spouse"),
            name: answer(model.context.spouse.name, values.spouseName),
            dateOfBirth: answer(model.context.spouse.dateOfBirth, spouseDobIso),
            estimatedTaxableIncome: answer(
              model.context.spouse.estimatedTaxableIncome,
              Number(values.spouseIncome.replace(/,/g, "")),
            ),
            privateHospitalCoverDays: answer(
              model.context.spouse.privateHospitalCoverDays,
              Number(values.spouseCoverDays),
            ),
          }
        : {
            status: answer(model.context.spouse.status, "none"),
            name: answer(model.context.spouse.name, null),
            dateOfBirth: answer(model.context.spouse.dateOfBirth, null),
            estimatedTaxableIncome: answer(model.context.spouse.estimatedTaxableIncome, null),
            privateHospitalCoverDays: answer(model.context.spouse.privateHospitalCoverDays, null),
          },
      holdsStudyLoan: answer(model.context.holdsStudyLoan, values.studyLoan === "yes"),
      privateHospitalCoverDays: answer(
        model.context.privateHospitalCoverDays,
        Number(values.privateCoverDays),
      ),
      dependentChildren: answer(model.context.dependentChildren, Number(values.dependentChildren)),
    },
  };
}
