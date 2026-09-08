/**
 * The closed allow-list of model paths the interview may write, and the pure
 * mapper that applies one parsed {@link FieldUpdate} to a {@link ReturnModel}
 * with `user-entered` provenance (PRD FR-4, FR-22).
 *
 * Mirrors the closed-vocabulary gating v1 uses in
 * `apps/web/lib/review/field-paths.ts` and
 * `@aus-tax-lodge/extraction`'s `model-paths.ts`: a path Claude emits that is
 * NOT on this list is a bug in the answer-parsing prompt, not user input, so
 * {@link applyInterviewField} throws {@link InterviewFieldError} rather than
 * silently writing the wrong field.
 *
 * The FR-6 fact fields mirror `apps/web/lib/questions/form.ts`
 * (`applyQuestionsToModel`) — residency, study loan, private-cover days, the
 * WFH double-claim guard, joint-account shares, spouse — and the deduction
 * amounts mirror `apps/web/lib/details/form.ts` / the review field paths.
 */
import {
  answer,
  confirm,
  confirmRepairsAreDeductible,
  markNotApplicable,
  reclassifyRepairsAsCapital,
  recomputeNetRentalResult,
  type ReturnModel,
  type SpouseStatus,
} from "@aus-tax-lodge/model";

import type { FieldUpdate, FieldUpdateKind } from "./types";

/** Thrown when Claude proposes a path outside the allow-list, or a value of the wrong type. */
export class InterviewFieldError extends Error {
  readonly path: string;

  constructor(message: string, path: string) {
    super(message);
    this.name = "InterviewFieldError";
    this.path = path;
  }
}

// ---------------------------------------------------------------------------
// The allow-list
// ---------------------------------------------------------------------------

/** Deduction labels whose dollar `amount` the interview may set (v1 FR-5 categories). */
const DEDUCTION_AMOUNT_KEYS = [
  "workRelatedCar",
  "workRelatedTravel",
  "workRelatedClothing",
  "selfEducation",
  "otherWorkRelated",
  "workFromHome",
  "giftsAndDonations",
  "costOfManagingTaxAffairs",
] as const;

/** Fixed (non-array) paths → the value kind they expect. */
const FIXED_PATH_KIND: Readonly<Record<string, FieldUpdateKind>> = {
  // Income scalars beyond the pre-fill
  "income.governmentAllowances": "number",
  "income.reportableFringeBenefits": "number",
  "income.reportableEmployerSuper": "number",
  // Deduction amounts + the two substantiation inputs
  ...Object.fromEntries(
    DEDUCTION_AMOUNT_KEYS.map((k) => [`deductions.${k}.amount`, "number"] as const),
  ),
  "deductions.workRelatedCar.businessKilometres": "number",
  "deductions.workFromHome.hours": "number",
  // FR-6 facts
  "questionnaire.residencyFullYear": "boolean",
  "questionnaire.studyLoanHeld": "boolean",
  "questionnaire.wfhHoursNotDoubleClaimed": "boolean",
  "questionnaire.jointAccountSharesProvided": "boolean",
  "context.holdsStudyLoan": "boolean",
  "context.privateHospitalCoverDays": "number",
  "context.dependentChildren": "number",
  // Spouse (FR-6)
  "context.spouse.status": "string",
  "context.spouse.name": "string",
  "context.spouse.dateOfBirth": "date",
  "context.spouse.estimatedTaxableIncome": "number",
  "context.spouse.privateHospitalCoverDays": "number",
  // Private health
  "privateHealth.held": "boolean",
  "privateHealth.premiumsEligibleForRebate": "number",
  "privateHealth.rebateReceived": "number",
  "privateHealth.oldestCoveredPersonAge": "number",
  "privateHealth.coverDays": "number",
  // Rental (FR-24) — the figures the assistant gathers by asking, because they
  // are not on the agent statement: owner-paid expenses (Q24), hand-entered
  // Div 43 / Div 40 totals when there is no QS schedule (Q23), and the
  // repairs-vs-capital confirmation (Q25). The rental documents themselves go
  // through `lib/rental-intake.ts`, never this list.
  "rental.expenses.insurance.amount": "number",
  "rental.expenses.landTax.amount": "number",
  "rental.expenses.bodyCorporate.amount": "number",
  "rental.expenses.capitalWorks.amount": "number",
  "rental.expenses.declineInValue.amount": "number",
  "rental.repairsConfirmedNotCapital": "boolean",
};

/** Rental expense lines the interview may set directly (owner-paid + manual depreciation). */
const RENTAL_OWNER_PAID_KEYS = ["insurance", "landTax", "bodyCorporate"] as const;
const RENTAL_MANUAL_DEPRECIATION_KEYS = ["capitalWorks", "declineInValue"] as const;
const RENTAL_LINE_RE = /^rental\.expenses\.([a-zA-Z]+)\.amount$/;

const INTEREST_ACCOUNT_RE =
  /^income\.interestAccounts\.([^.]+)\.(grossInterest|ownershipSharePercent)$/;
const DIVIDEND_RE = /^income\.dividends\.([^.]+)\.(unfranked|franked|frankingCredits)$/;

/** Every allowed path, for the prompt's own reference and for tests. */
export const INTERVIEW_FIELD_PATHS: readonly string[] = [
  ...Object.keys(FIXED_PATH_KIND),
  "income.interestAccounts.<id>.grossInterest",
  "income.interestAccounts.<id>.ownershipSharePercent",
  "income.dividends.<id>.unfranked",
  "income.dividends.<id>.franked",
  "income.dividends.<id>.frankingCredits",
];

/** `true` when `path` is one {@link applyInterviewField} knows how to write. */
export function isInterviewFieldPath(path: string): boolean {
  return path in FIXED_PATH_KIND || INTEREST_ACCOUNT_RE.test(path) || DIVIDEND_RE.test(path);
}

// ---------------------------------------------------------------------------
// Value coercion
// ---------------------------------------------------------------------------

function coerce(update: FieldUpdate, expected: FieldUpdateKind): string | number | boolean | null {
  const { value, path } = update;
  if (value === null) return null;

  switch (expected) {
    case "number": {
      const n = typeof value === "number" ? value : Number(String(value).replace(/[$,\s]/g, ""));
      if (!Number.isFinite(n)) {
        throw new InterviewFieldError(
          `"${path}" expects a number, got ${JSON.stringify(value)}`,
          path,
        );
      }
      return n;
    }
    case "boolean": {
      if (typeof value === "boolean") return value;
      const s = String(value).trim().toLowerCase();
      if (["true", "yes", "y"].includes(s)) return true;
      if (["false", "no", "n"].includes(s)) return false;
      throw new InterviewFieldError(
        `"${path}" expects a boolean, got ${JSON.stringify(value)}`,
        path,
      );
    }
    case "string":
    case "date":
      return String(value);
  }
}

// ---------------------------------------------------------------------------
// The mapper
// ---------------------------------------------------------------------------

function set(model: ReturnModel, mutate: (m: ReturnModel) => ReturnModel): ReturnModel {
  return mutate(model);
}

/** Apply one field update, returning a new model. Throws for an unknown path / wrong type. */
export function applyInterviewField(model: ReturnModel, update: FieldUpdate): ReturnModel {
  const { path } = update;

  // --- Array-indexed income paths (existing entries only) -------------------
  const interest = INTEREST_ACCOUNT_RE.exec(path);
  if (interest) {
    const [, id, field] = interest as unknown as [
      string,
      string,
      "grossInterest" | "ownershipSharePercent",
    ];
    const value = coerce(update, "number") as number | null;
    const accounts = model.income.interestAccounts;
    if (!accounts.some((a) => a.id === id)) {
      throw new InterviewFieldError(`no interest account with id "${id}"`, path);
    }
    return {
      ...model,
      income: {
        ...model.income,
        interestAccounts: accounts.map((a) =>
          a.id === id ? { ...a, [field]: answer(a[field], value) } : a,
        ),
      },
    };
  }

  const dividend = DIVIDEND_RE.exec(path);
  if (dividend) {
    const [, id, field] = dividend as unknown as [
      string,
      string,
      "unfranked" | "franked" | "frankingCredits",
    ];
    const value = coerce(update, "number") as number | null;
    const holdings = model.income.dividends;
    if (!holdings.some((h) => h.id === id)) {
      throw new InterviewFieldError(`no dividend holding with id "${id}"`, path);
    }
    return {
      ...model,
      income: {
        ...model.income,
        dividends: holdings.map((h) =>
          h.id === id ? { ...h, [field]: answer(h[field], value) } : h,
        ),
      },
    };
  }

  // --- Fixed paths --------------------------------------------------------
  const expected = FIXED_PATH_KIND[path];
  if (!expected) {
    throw new InterviewFieldError(
      `path "${path}" is not on the interview allow-list — this is a prompt bug`,
      path,
    );
  }
  const value = coerce(update, expected);

  // --- Rental (FR-24) ----------------------------------------------------
  const rentalLine = RENTAL_LINE_RE.exec(path);
  if (rentalLine) {
    return applyRentalExpenseLine(model, path, rentalLine[1]!, value as number | null);
  }
  if (path === "rental.repairsConfirmedNotCapital") {
    return applyRepairsConfirmation(model, value as boolean | null);
  }

  switch (path) {
    // --- Income scalars ---------------------------------------------------
    case "income.governmentAllowances":
    case "income.reportableFringeBenefits":
    case "income.reportableEmployerSuper": {
      const field = path.split(".")[1] as
        "governmentAllowances" | "reportableFringeBenefits" | "reportableEmployerSuper";
      return {
        ...model,
        income: { ...model.income, [field]: answer(model.income[field], value as number | null) },
      };
    }

    // --- Deductions -----------------------------------------------------
    case "deductions.workRelatedCar.businessKilometres":
      return withDeductions(model, (d) => ({
        ...d,
        workRelatedCar: {
          ...d.workRelatedCar,
          businessKilometres: answer(d.workRelatedCar.businessKilometres, value as number | null),
        },
      }));
    case "deductions.workFromHome.hours":
      return withDeductions(model, (d) => ({
        ...d,
        workFromHome: {
          ...d.workFromHome,
          hours: answer(d.workFromHome.hours, value as number | null),
        },
      }));

    // --- FR-6: residency ------------------------------------------------
    case "questionnaire.residencyFullYear": {
      const yes = value as boolean | null;
      return set(model, (m) => ({
        ...m,
        context: {
          ...m.context,
          residency: yes ? answer(m.context.residency, "resident-full-year") : m.context.residency,
        },
        questionnaire: {
          ...m.questionnaire,
          residencyFullYear: answer(m.questionnaire.residencyFullYear, yes),
        },
      }));
    }

    // --- FR-6: study loan (both paths keep context + questionnaire in step) --
    case "context.holdsStudyLoan":
    case "questionnaire.studyLoanHeld": {
      const held = value as boolean | null;
      return set(model, (m) => ({
        ...m,
        context: { ...m.context, holdsStudyLoan: answer(m.context.holdsStudyLoan, held) },
        questionnaire: {
          ...m.questionnaire,
          studyLoanHeld: answer(m.questionnaire.studyLoanHeld, held),
        },
      }));
    }

    // --- FR-6: private-cover days (also marks the dates confirmed) --------
    case "context.privateHospitalCoverDays": {
      const days = value as number | null;
      return set(model, (m) => ({
        ...m,
        context: {
          ...m.context,
          privateHospitalCoverDays: answer(m.context.privateHospitalCoverDays, days),
        },
        questionnaire: {
          ...m.questionnaire,
          privateCoverDatesConfirmed: answer(m.questionnaire.privateCoverDatesConfirmed, true),
        },
      }));
    }

    case "questionnaire.wfhHoursNotDoubleClaimed":
      return withQuestionnaire(model, (q) => ({
        ...q,
        wfhHoursNotDoubleClaimed: answer(q.wfhHoursNotDoubleClaimed, value as boolean | null),
      }));
    case "questionnaire.jointAccountSharesProvided":
      return withQuestionnaire(model, (q) => ({
        ...q,
        jointAccountSharesProvided: answer(q.jointAccountSharesProvided, value as boolean | null),
      }));

    case "context.dependentChildren":
      return set(model, (m) => ({
        ...m,
        context: {
          ...m.context,
          dependentChildren: answer(m.context.dependentChildren, value as number | null),
        },
      }));

    // --- FR-6: spouse ---------------------------------------------------
    case "context.spouse.status": {
      const status = String(value) as SpouseStatus;
      if (status !== "none" && status !== "had-spouse") {
        throw new InterviewFieldError(`spouse status must be "none" or "had-spouse"`, path);
      }
      return withSpouse(model, (s) =>
        status === "none"
          ? {
              status: answer(s.status, "none"),
              name: markNotApplicable(s.name),
              dateOfBirth: markNotApplicable(s.dateOfBirth),
              estimatedTaxableIncome: markNotApplicable(s.estimatedTaxableIncome),
              privateHospitalCoverDays: markNotApplicable(s.privateHospitalCoverDays),
            }
          : { ...s, status: answer(s.status, "had-spouse") },
      );
    }
    case "context.spouse.name":
      return withSpouse(model, (s) => ({ ...s, name: answer(s.name, value as string | null) }));
    case "context.spouse.dateOfBirth":
      return withSpouse(model, (s) => ({
        ...s,
        dateOfBirth: answer(s.dateOfBirth, value as string | null),
      }));
    case "context.spouse.estimatedTaxableIncome":
      return withSpouse(model, (s) => ({
        ...s,
        estimatedTaxableIncome: answer(s.estimatedTaxableIncome, value as number | null),
      }));
    case "context.spouse.privateHospitalCoverDays":
      return withSpouse(model, (s) => ({
        ...s,
        privateHospitalCoverDays: answer(s.privateHospitalCoverDays, value as number | null),
      }));

    // --- Private health -----------------------------------------------
    case "privateHealth.held": {
      const held = value as boolean | null;
      return set(model, (m) => ({
        ...m,
        privateHealth:
          held === false
            ? {
                held: answer(m.privateHealth.held, false),
                premiumsEligibleForRebate: markNotApplicable(
                  m.privateHealth.premiumsEligibleForRebate,
                ),
                rebateReceived: markNotApplicable(m.privateHealth.rebateReceived),
                oldestCoveredPersonAge: markNotApplicable(m.privateHealth.oldestCoveredPersonAge),
                coverDays: markNotApplicable(m.privateHealth.coverDays),
              }
            : { ...m.privateHealth, held: answer(m.privateHealth.held, held) },
      }));
    }
    case "privateHealth.premiumsEligibleForRebate":
    case "privateHealth.rebateReceived":
    case "privateHealth.oldestCoveredPersonAge":
    case "privateHealth.coverDays": {
      const field = path.split(".")[1] as
        "premiumsEligibleForRebate" | "rebateReceived" | "oldestCoveredPersonAge" | "coverDays";
      return {
        ...model,
        privateHealth: {
          ...model.privateHealth,
          [field]: answer(model.privateHealth[field], value as number | null),
        },
      };
    }

    default: {
      // A deduction `.amount` path — the only fixed paths not handled above.
      const key = DEDUCTION_AMOUNT_KEYS.find((k) => path === `deductions.${k}.amount`);
      if (!key) {
        throw new InterviewFieldError(`unhandled allow-listed path "${path}"`, path);
      }
      return withDeductions(model, (d) => ({
        ...d,
        [key]: { ...d[key], amount: answer(d[key].amount, value as number | null) },
      }));
    }
  }
}

// ---------------------------------------------------------------------------
// Small immutable-update helpers
// ---------------------------------------------------------------------------

function withDeductions(
  model: ReturnModel,
  mutate: (d: ReturnModel["deductions"]) => ReturnModel["deductions"],
): ReturnModel {
  return { ...model, deductions: mutate(model.deductions) };
}

function withQuestionnaire(
  model: ReturnModel,
  mutate: (q: ReturnModel["questionnaire"]) => ReturnModel["questionnaire"],
): ReturnModel {
  return { ...model, questionnaire: mutate(model.questionnaire) };
}

function withSpouse(
  model: ReturnModel,
  mutate: (s: ReturnModel["context"]["spouse"]) => ReturnModel["context"]["spouse"],
): ReturnModel {
  return { ...model, context: { ...model.context, spouse: mutate(model.context.spouse) } };
}

// ---------------------------------------------------------------------------
// Rental (FR-24)
// ---------------------------------------------------------------------------

/**
 * Set one owner-paid or hand-entered rental expense line (PRD FR-24, Q23/Q24)
 * as the user's own fact, re-net the schedule, and mark the rental present —
 * the user telling us a rental figure establishes that they have one. Only the
 * three owner-paid keys and the two manual-depreciation keys are writable here;
 * the agent statement / loan / QS figures land through `lib/rental-intake.ts`.
 */
function applyRentalExpenseLine(
  model: ReturnModel,
  path: string,
  key: string,
  value: number | null,
): ReturnModel {
  const ownerPaid = (RENTAL_OWNER_PAID_KEYS as readonly string[]).includes(key);
  const manual = (RENTAL_MANUAL_DEPRECIATION_KEYS as readonly string[]).includes(key);
  if (!ownerPaid && !manual) {
    throw new InterviewFieldError(
      `rental expense line "${key}" is not one the interview may set directly`,
      path,
    );
  }
  const expenseKey = key as keyof ReturnModel["rental"]["expenses"];
  const line = model.rental.expenses[expenseKey];
  const rental = recomputeNetRentalResult({
    ...model.rental,
    present: true,
    expenses: {
      ...model.rental.expenses,
      [expenseKey]: { amount: answer(line.amount, value), source: "owner-paid" },
    },
  });
  return { ...model, rental };
}

/**
 * Apply the repairs-vs-capital answer (PRD Q25): `true` = a genuine repair
 * (`confirmRepairsAreDeductible`), `false` = a capital improvement
 * (`reclassifyRepairsAsCapital` moves the amount into capital works).
 */
function applyRepairsConfirmation(
  model: ReturnModel,
  isGenuineRepair: boolean | null,
): ReturnModel {
  if (isGenuineRepair == null) {
    throw new InterviewFieldError(
      "rental.repairsConfirmedNotCapital needs a yes/no answer",
      "rental.repairsConfirmedNotCapital",
    );
  }
  if (!isGenuineRepair) {
    return { ...model, rental: reclassifyRepairsAsCapital(model.rental) };
  }
  // A genuine repair: record the confirmation AND settle the amount, so the
  // user is not asked about the same line twice (mirrors v1 `confirmRepairs`).
  const confirmed = confirmRepairsAreDeductible(model.rental);
  const rental = {
    ...confirmed,
    expenses: {
      ...confirmed.expenses,
      repairsAndMaintenance: {
        ...confirmed.expenses.repairsAndMaintenance,
        amount: confirm(confirmed.expenses.repairsAndMaintenance.amount),
      },
    },
  };
  return { ...model, rental };
}
