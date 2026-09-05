/**
 * Shared test fixtures — a fully-populated, all-confirmed, in-scope return
 * model. Deliberately a standalone copy of the shape
 * `@aus-tax-lodge/model`'s own test fixtures build (that file lives under
 * that package's `test/`, which isn't published for other packages to
 * import) rather than a dependency on it, matching the pattern
 * `@aus-tax-lodge/scope`'s own `test/fixtures.ts` already uses.
 */
import type { ResidencyStatus } from "@aus-tax-lodge/engine";
import {
  answer,
  confirm,
  createEmptyReturnModel,
  documentOrigin,
  markNotApplicable,
  propose,
  RENTAL_EXPENSE_KEYS,
  type Provenanced,
  type RentalSchedule,
  type RentalScopeGateAnswer,
  type ReturnModel,
  type SpouseStatus,
  type SubstantiatedDeduction,
  unsetField,
} from "@aus-tax-lodge/model";

/** A confirmed field carrying `value`, with a plausible high-confidence document origin. */
export function conf<T>(value: T): Provenanced<T> {
  return confirm(
    propose(unsetField<T>(), value, documentOrigin("doc-1", 1, String(value), "high")),
  );
}

/** A field the user marked "nil / not applicable". */
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
  // Interest well under the 3x-gross-rent plausibility ceiling (26,000 x 3 = 78,000).
  expenses.interestOnLoans = { amount: conf(14_000), source: "loan-summary" };
  expenses.agentFees = { amount: conf(2_080), source: "agent-statement" };

  return {
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
  };
}

/**
 * A return with every in-scope figure confirmed (or marked nil): one
 * employer, one 50%-owned joint interest account, one franked-dividend
 * holding (franking credits exactly at the 30/70 gross-up ratio), a small
 * deduction set, and a negatively-geared but plausible rental. Passes every
 * FR-13 check with `[]`.
 */
export function validReturn(): ReturnModel {
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
      // A valid ATO test TFN (passes the modulus-11 checksum).
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
          grossSalaryWages: conf(90_000),
          // 22.2% of gross salary — within the 5-55% plausible band.
          paygWithheld: conf(20_000),
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
          // Exactly 700 x 30/70 = 300 — the plausible gross-up.
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
    rental: rentalSchedule(),
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
