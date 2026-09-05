/** Shared review-screen test fixtures (PRD FR-7, FR-20, FR-21, FR-24). */
import {
  answer,
  confirm,
  createEmptyReturnModel,
  documentOrigin,
  markNotApplicable,
  propose,
  unsetField,
  type FieldConfidence,
  type Provenanced,
  type ReturnModel,
  type SubstantiatedDeduction,
} from "@aus-tax-lodge/model";

export function proposed<T>(
  value: T,
  opts: { docId?: string; page?: number; snippet?: string; confidence?: FieldConfidence } = {},
): Provenanced<T> {
  return propose(
    unsetField<T>(),
    value,
    documentOrigin(
      opts.docId ?? "doc1",
      opts.page ?? 1,
      opts.snippet ?? String(value),
      opts.confidence ?? "high",
    ),
  );
}

export function confirmedField<T>(
  value: T,
  opts: { docId?: string; page?: number; snippet?: string; confidence?: FieldConfidence } = {},
): Provenanced<T> {
  return confirm(proposed(value, opts));
}

export function notApplicable<T>(): Provenanced<T> {
  return markNotApplicable(unsetField<T>());
}

export function answered<T>(value: T): Provenanced<T> {
  return answer(unsetField<T>(), value);
}

function nilDeduction(): SubstantiatedDeduction {
  return {
    amount: notApplicable<number>(),
    substantiationRef: notApplicable<string>(),
    unsubstantiated: false,
  };
}

/**
 * A minimal model with every `isReadyForEstimate` requirement settled and no
 * rental — the "all confirmed" state. Individual tests mutate a clone to
 * re-introduce exactly the gap they're testing.
 */
export function readyModel(): ReturnModel {
  const base = createEmptyReturnModel();
  return {
    ...base,
    context: {
      ...base.context,
      residency: confirmedField("resident-full-year"),
      spouse: { ...base.context.spouse, status: confirmedField("none") },
      holdsStudyLoan: confirmedField(false),
      privateHospitalCoverDays: confirmedField(365),
      dependentChildren: confirmedField(0),
    },
    income: {
      salaryWages: [
        {
          id: "e1",
          payerName: confirmedField("Acme Pty Ltd"),
          payerAbn: confirmedField("11111111111"),
          grossSalaryWages: confirmedField(80_000),
          paygWithheld: confirmedField(15_000),
        },
      ],
      interestAccounts: [],
      dividends: [],
      governmentAllowances: notApplicable(),
      reportableFringeBenefits: notApplicable(),
      reportableEmployerSuper: notApplicable(),
    },
    deductions: {
      workRelatedCar: {
        method: "cents-per-km",
        businessKilometres: notApplicable(),
        ratePerKm: notApplicable(),
        amount: notApplicable(),
        substantiationRef: notApplicable(),
        unsubstantiated: false,
      },
      workRelatedTravel: nilDeduction(),
      workRelatedClothing: nilDeduction(),
      selfEducation: nilDeduction(),
      otherWorkRelated: nilDeduction(),
      workFromHome: {
        method: "fixed-rate",
        hours: notApplicable(),
        ratePerHour: notApplicable(),
        amount: notApplicable(),
        substantiationRef: notApplicable(),
        unsubstantiated: false,
      },
      giftsAndDonations: nilDeduction(),
      costOfManagingTaxAffairs: nilDeduction(),
    },
    rental: base.rental,
    privateHealth: {
      held: confirmedField(false),
      premiumsEligibleForRebate: notApplicable(),
      rebateReceived: notApplicable(),
      oldestCoveredPersonAge: notApplicable(),
      coverDays: notApplicable(),
    },
    questionnaire: {
      residencyFullYear: answered(true),
      jointAccountSharesProvided: answered(true),
      studyLoanHeld: answered(false),
      privateCoverDatesConfirmed: answered(true),
      wfhHoursNotDoubleClaimed: answered(true),
      rentalScopeGate: base.questionnaire.rentalScopeGate,
    },
  };
}
