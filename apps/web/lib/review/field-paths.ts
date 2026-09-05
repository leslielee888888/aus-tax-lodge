/**
 * The closed vocabulary of single-`Provenanced<number>` fields the review
 * screen (T17) can generically confirm / edit / mark not-applicable (PRD
 * FR-7). Mirrors `@aus-tax-lodge/extraction`'s `model-paths.ts` — a path
 * outside this vocabulary is a bug in `build-sections.ts`, not user input, so
 * {@link getReviewField} / {@link setReviewField} throw rather than silently
 * doing nothing.
 *
 * Deliberately narrower than the full model: compound rows (an interest
 * account's gross interest + ownership share, confirmed together) and the
 * rental repairs gate have their own dedicated server actions instead of a
 * path here — see `actions.ts`.
 */
import {
  type DeductionsSection,
  type IncomeSection,
  type PrivateHealthSection,
  type Provenanced,
  type RentalExpenseKey,
  type RentalSchedule,
  RENTAL_EXPENSE_KEYS,
  type ReturnModel,
} from "@aus-tax-lodge/model";

// Each alternation below is the runtime validation — the regex only matches
// one of the named alternatives, so the capture group is already constrained
// to the union type it's cast to.
type IncomeScalarField =
  "governmentAllowances" | "reportableFringeBenefits" | "reportableEmployerSuper";
type PrivateHealthField =
  "premiumsEligibleForRebate" | "rebateReceived" | "oldestCoveredPersonAge" | "coverDays";
type DirectAmountDeductionKey =
  | "workRelatedCar"
  | "workRelatedTravel"
  | "workRelatedClothing"
  | "selfEducation"
  | "otherWorkRelated"
  | "workFromHome"
  | "giftsAndDonations"
  | "costOfManagingTaxAffairs";
type RentalScalarField = "grossRent" | "otherRentalIncome";
type DividendField = "unfranked" | "franked" | "frankingCredits" | "tfnAmountsWithheld";
type SalaryField = "grossSalaryWages" | "paygWithheld";

type ReviewFieldMatch =
  | { readonly kind: "income-scalar"; readonly field: IncomeScalarField }
  | { readonly kind: "private-health"; readonly field: PrivateHealthField }
  | { readonly kind: "deduction-amount"; readonly key: DirectAmountDeductionKey }
  | { readonly kind: "rental-scalar"; readonly field: RentalScalarField }
  | { readonly kind: "rental-expense"; readonly key: RentalExpenseKey }
  | { readonly kind: "salary"; readonly id: string; readonly field: SalaryField }
  | { readonly kind: "interest-tfn"; readonly id: string }
  | { readonly kind: "dividend"; readonly id: string; readonly field: DividendField };

const INCOME_SCALAR_RE =
  /^income\.(governmentAllowances|reportableFringeBenefits|reportableEmployerSuper)$/;
const PRIVATE_HEALTH_RE =
  /^privateHealth\.(premiumsEligibleForRebate|rebateReceived|oldestCoveredPersonAge|coverDays)$/;
const DEDUCTION_AMOUNT_RE =
  /^deductions\.(workRelatedCar|workRelatedTravel|workRelatedClothing|selfEducation|otherWorkRelated|workFromHome|giftsAndDonations|costOfManagingTaxAffairs)\.amount$/;
const RENTAL_SCALAR_RE = /^rental\.(grossRent|otherRentalIncome)$/;
const RENTAL_EXPENSE_RE = /^rental\.expenses\.([a-zA-Z]+)\.amount$/;
const SALARY_RE = /^income\.salaryWages\.([^.]+)\.(grossSalaryWages|paygWithheld)$/;
const INTEREST_TFN_RE = /^income\.interestAccounts\.([^.]+)\.tfnAmountsWithheld$/;
const DIVIDEND_RE =
  /^income\.dividends\.([^.]+)\.(unfranked|franked|frankingCredits|tfnAmountsWithheld)$/;

function isRentalExpenseKey(key: string): key is RentalExpenseKey {
  return (RENTAL_EXPENSE_KEYS as readonly string[]).includes(key);
}

/** Parses `path` against the closed vocabulary, or returns `null` for an unrecognised path. */
export function parseReviewFieldPath(path: string): ReviewFieldMatch | null {
  const incomeScalar = INCOME_SCALAR_RE.exec(path);
  if (incomeScalar) return { kind: "income-scalar", field: incomeScalar[1] as IncomeScalarField };

  const phi = PRIVATE_HEALTH_RE.exec(path);
  if (phi) return { kind: "private-health", field: phi[1] as PrivateHealthField };

  const deduction = DEDUCTION_AMOUNT_RE.exec(path);
  if (deduction) return { kind: "deduction-amount", key: deduction[1] as DirectAmountDeductionKey };

  const rentalScalar = RENTAL_SCALAR_RE.exec(path);
  if (rentalScalar) return { kind: "rental-scalar", field: rentalScalar[1] as RentalScalarField };

  const rentalExpense = RENTAL_EXPENSE_RE.exec(path);
  if (rentalExpense && isRentalExpenseKey(rentalExpense[1]!)) {
    return { kind: "rental-expense", key: rentalExpense[1] as RentalExpenseKey };
  }

  const salary = SALARY_RE.exec(path);
  if (salary) return { kind: "salary", id: salary[1]!, field: salary[2] as SalaryField };

  const interestTfn = INTEREST_TFN_RE.exec(path);
  if (interestTfn) return { kind: "interest-tfn", id: interestTfn[1]! };

  const dividend = DIVIDEND_RE.exec(path);
  if (dividend) return { kind: "dividend", id: dividend[1]!, field: dividend[2] as DividendField };

  return null;
}

/** `true` when `path` is one {@link getReviewField} / {@link setReviewField} know how to handle. */
export function isKnownReviewFieldPath(path: string): boolean {
  return parseReviewFieldPath(path) !== null;
}

function findById<T extends { readonly id: string }>(list: readonly T[], id: string): T {
  const found = list.find((item) => item.id === id);
  if (!found) throw new Error(`review: no entry with id "${id}" (path referenced a stale row)`);
  return found;
}

/** Read the `Provenanced<number>` at `path`. Throws for a path outside the vocabulary. */
export function getReviewField(model: ReturnModel, path: string): Provenanced<number> {
  const match = parseReviewFieldPath(path);
  if (!match) throw new Error(`review: unknown field path "${path}"`);
  return readMatch(model, match);
}

function readMatch(model: ReturnModel, match: ReviewFieldMatch): Provenanced<number> {
  switch (match.kind) {
    case "income-scalar":
      return model.income[match.field];
    case "private-health":
      return model.privateHealth[match.field];
    case "deduction-amount":
      return model.deductions[match.key].amount;
    case "rental-scalar":
      return model.rental[match.field];
    case "rental-expense":
      return model.rental.expenses[match.key].amount;
    case "salary":
      return findById(model.income.salaryWages, match.id)[match.field];
    case "interest-tfn":
      return findById(model.income.interestAccounts, match.id).tfnAmountsWithheld;
    case "dividend":
      return findById(model.income.dividends, match.id)[match.field];
  }
}

/**
 * Return a new `ReturnModel` with the field at `path` replaced by `next`.
 * Throws for a path outside the vocabulary.
 */
export function setReviewField(
  model: ReturnModel,
  path: string,
  next: Provenanced<number>,
): ReturnModel {
  const match = parseReviewFieldPath(path);
  if (!match) throw new Error(`review: unknown field path "${path}"`);
  return writeMatch(model, match, next);
}

function replaceById<T extends { readonly id: string }>(
  list: readonly T[],
  id: string,
  update: (item: T) => T,
): T[] {
  return list.map((item) => (item.id === id ? update(item) : item));
}

function writeMatch(
  model: ReturnModel,
  match: ReviewFieldMatch,
  next: Provenanced<number>,
): ReturnModel {
  switch (match.kind) {
    case "income-scalar": {
      const income: IncomeSection = { ...model.income, [match.field]: next };
      return { ...model, income };
    }
    case "private-health": {
      const privateHealth: PrivateHealthSection = { ...model.privateHealth, [match.field]: next };
      return { ...model, privateHealth };
    }
    case "deduction-amount": {
      const deductions: DeductionsSection = {
        ...model.deductions,
        [match.key]: { ...model.deductions[match.key], amount: next },
      };
      return { ...model, deductions };
    }
    case "rental-scalar": {
      const rental: RentalSchedule = { ...model.rental, [match.field]: next };
      return { ...model, rental };
    }
    case "rental-expense": {
      const rental: RentalSchedule = {
        ...model.rental,
        expenses: {
          ...model.rental.expenses,
          [match.key]: { ...model.rental.expenses[match.key], amount: next },
        },
      };
      return { ...model, rental };
    }
    case "salary": {
      const salaryWages = replaceById(model.income.salaryWages, match.id, (entry) => ({
        ...entry,
        [match.field]: next,
      }));
      return { ...model, income: { ...model.income, salaryWages } };
    }
    case "interest-tfn": {
      const interestAccounts = replaceById(model.income.interestAccounts, match.id, (entry) => ({
        ...entry,
        tfnAmountsWithheld: next,
      }));
      return { ...model, income: { ...model.income, interestAccounts } };
    }
    case "dividend": {
      const dividends = replaceById(model.income.dividends, match.id, (entry) => ({
        ...entry,
        [match.field]: next,
      }));
      return { ...model, income: { ...model.income, dividends } };
    }
  }
}
