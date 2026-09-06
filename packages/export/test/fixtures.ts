/**
 * Standalone export-package test fixtures — a rental return and a no-rental
 * return, both fully confirmed and in scope. Mirrors the pattern
 * `@aus-tax-lodge/validation`'s own `test/fixtures.ts` uses (a local copy
 * rather than importing another package's unpublished `test/` folder).
 */
import {
  assess,
  getTaxonomy,
  PARAMS_VERSION,
  TARGET_YEAR,
  type ResidencyStatus,
} from "@aus-tax-lodge/engine";
import {
  answer,
  confirm,
  createEmptyReturnModel,
  documentOrigin,
  edit,
  markNotApplicable,
  propose,
  RENTAL_EXPENSE_KEYS,
  recomputeNetRentalResult,
  toEngineInput,
  unsetField,
  type Provenanced,
  type RentalSchedule,
  type RentalScopeGateAnswer,
  type ReturnModel,
  type SpouseStatus,
  type SubstantiatedDeduction,
} from "@aus-tax-lodge/model";

import type { ExportPackageInput } from "../src/types";

export function conf<T>(value: T, snippet = String(value)): Provenanced<T> {
  return confirm(propose(unsetField<T>(), value, documentOrigin("doc-1", 1, snippet, "high")));
}

export function na<T>(): Provenanced<T> {
  return markNotApplicable(unsetField<T>());
}

function nilDeduction(): SubstantiatedDeduction {
  return { amount: na<number>(), substantiationRef: na<string>(), unsubstantiated: false };
}

function rentalSchedule(): RentalSchedule {
  const base = createEmptyReturnModel().rental;
  const expenses = { ...base.expenses };
  for (const key of RENTAL_EXPENSE_KEYS) {
    expenses[key] = { amount: na<number>(), source: "owner-paid" };
  }
  expenses.interestOnLoans = { amount: conf(14_000), source: "loan-summary" };
  expenses.agentFees = { amount: conf(2_080), source: "agent-statement" };
  expenses.councilRates = { amount: conf(1_400), source: "agent-statement" };

  return recomputeNetRentalResult({
    ...base,
    present: true,
    property: {
      addressLine1: conf("2 Rental Rd"),
      suburb: conf("Sydney"),
      state: conf("NSW"),
      postcode: conf("2000"),
      firstEarnedIncomeOn: conf("2020-06-01"),
    },
    soleOwnership: conf(true),
    rentedOrAvailableAllYear: conf(true),
    noPrivateUse: conf(true),
    grossRent: conf(26_000),
    otherRentalIncome: na<number>(),
    expenses,
    repairsConfirmedNotCapital: false,
    netRentalResult: unsetField<number>(),
  });
}

function baseReturn(): ReturnModel {
  const base = createEmptyReturnModel();
  return {
    ...base,
    taxpayer: {
      fullName: conf("Priya Example"),
      dateOfBirth: conf("1985-03-02"),
      postalAddress: conf({
        line1: "1 Test St",
        line2: "",
        suburb: "Sydney",
        state: "NSW",
        postcode: "2000",
        country: "Australia",
      }),
      taxFileNumber: conf("123456782"),
      refundAccount: conf({
        bsb: "062-000",
        accountNumber: "12345678",
        accountName: "Priya Example",
      }),
    },
    context: {
      ...base.context,
      residency: conf<ResidencyStatus>("resident-full-year"),
      spouse: { ...base.context.spouse, status: conf<SpouseStatus>("none") },
      holdsStudyLoan: conf(true),
      privateHospitalCoverDays: conf(365),
      dependentChildren: conf(0),
    },
    income: {
      salaryWages: [
        {
          id: "e1",
          payerName: conf("Acme Pty Ltd"),
          payerAbn: conf("11111111111"),
          grossSalaryWages: edit(
            propose(
              unsetField<number>(),
              88_000,
              documentOrigin("doc-2", 1, "Gross payments 88,000.00", "high"),
            ),
            90_000,
            "2026-07-05T00:00:00.000Z",
          ),
          paygWithheld: conf(20_000, "Total tax withheld 20,000.00"),
        },
      ],
      interestAccounts: [
        {
          id: "a1",
          institution: conf("Big Bank"),
          accountDescription: conf("Joint saver"),
          grossInterest: conf(400),
          tfnAmountsWithheld: na<number>(),
          ownershipSharePercent: conf(50),
        },
      ],
      dividends: [
        {
          id: "d1",
          company: conf("ASX Co"),
          unfranked: conf(0),
          franked: conf(700),
          frankingCredits: conf(300),
          tfnAmountsWithheld: na<number>(),
        },
      ],
      governmentAllowances: na<number>(),
      reportableFringeBenefits: na<number>(),
      reportableEmployerSuper: na<number>(),
    },
    deductions: {
      workRelatedCar: {
        method: "cents-per-km",
        businessKilometres: conf(1_000),
        ratePerKm: conf(0.88),
        amount: conf(880),
        substantiationRef: conf("odometer log"),
        unsubstantiated: false,
      },
      workRelatedTravel: nilDeduction(),
      workRelatedClothing: {
        amount: conf(250),
        substantiationRef: conf("receipts"),
        unsubstantiated: false,
      },
      selfEducation: nilDeduction(),
      otherWorkRelated: nilDeduction(),
      workFromHome: {
        method: "fixed-rate",
        hours: conf(1_400),
        ratePerHour: conf(0.7),
        amount: conf(980),
        substantiationRef: conf("WFH diary"),
        unsubstantiated: false,
      },
      giftsAndDonations: {
        amount: conf(500),
        substantiationRef: conf("DGR receipt"),
        unsubstantiated: false,
      },
      costOfManagingTaxAffairs: nilDeduction(),
    },
    rental: createEmptyReturnModel().rental,
    privateHealth: {
      held: conf(true),
      premiumsEligibleForRebate: conf(1_800),
      rebateReceived: conf(400),
      oldestCoveredPersonAge: conf(40),
      coverDays: conf(365),
    },
    questionnaire: {
      residencyFullYear: answer(unsetField<boolean>(), true),
      jointAccountSharesProvided: answer(unsetField<boolean>(), true),
      studyLoanHeld: answer(unsetField<boolean>(), true),
      privateCoverDatesConfirmed: answer(unsetField<boolean>(), true),
      wfhHoursNotDoubleClaimed: answer(unsetField<boolean>(), true),
      rentalScopeGate: answer<RentalScopeGateAnswer>(unsetField<RentalScopeGateAnswer>(), {
        solelyOwned: true,
        rentedOrAvailableAllYear: true,
        noPrivateUse: true,
        notBoughtOrSoldThisYear: true,
      }),
    },
  };
}

/** A return with a negatively-geared rental. */
export function rentalReturn(): ReturnModel {
  return { ...baseReturn(), rental: rentalSchedule() };
}

/** A return with no rental property. */
export function noRentalReturn(): ReturnModel {
  return baseReturn();
}

/** A return that trips exactly one FR-13 warning (franking credits implausible). */
export function returnWithWarning(): ReturnModel {
  const model = noRentalReturn();
  const holding = model.income.dividends[0]!;
  return {
    ...model,
    income: {
      ...model.income,
      dividends: [{ ...holding, frankingCredits: conf(120) }],
    },
  };
}

/** Wrap a model in the fully-resolved {@link ExportPackageInput}. */
export function inputFor(
  model: ReturnModel,
  overrides: Partial<ExportPackageInput> = {},
): ExportPackageInput {
  const assessment = assess(toEngineInput(model));
  return {
    model,
    assessment,
    taxonomy: getTaxonomy(TARGET_YEAR),
    paramsVersion: PARAMS_VERSION,
    targetYear: TARGET_YEAR,
    documents: [
      { docId: "doc-1", filename: "ato-prefill-report.pdf" },
      { docId: "doc-2", filename: "income-statement.pdf" },
    ],
    acknowledgedWarningIds: [],
    statedAssumptions: [],
    generatedAt: "2026-07-10T09:00:00.000Z",
    ...overrides,
  };
}
