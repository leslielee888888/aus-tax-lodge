/**
 * Resolves an {@link ExtractedFigure}'s `modelPath` (a dot-path into
 * `ReturnModel`, e.g. `income.salaryWages[0].grossSalaryWages`) to the actual
 * field on the model and applies it with `propose()`.
 *
 * `modelPath` is deliberately a *closed* vocabulary, not a generic
 * object-path library: every path an extractor may emit is listed in
 * `prompts.ts` per document type, and this module is the only place that
 * knows how each one maps onto `ReturnModel`. A path outside that vocabulary
 * is a bug (in a prompt or in the model's JSON), not user input, so
 * {@link applyFigureToModel} throws rather than silently doing nothing.
 */
import {
  createEmptyDividendHolding,
  createEmptyEmployerIncome,
  createEmptyInterestAccount,
  propose,
  type DividendHolding,
  type DocumentOrigin,
  type EmployerIncome,
  type InterestAccount,
  type ReturnModel,
} from "@aus-tax-lodge/model";

export type ModelPathValueKind = "number" | "string";

const SALARY_WAGES_FIELDS = ["payerName", "payerAbn", "grossSalaryWages", "paygWithheld"] as const;
type SalaryWagesField = (typeof SALARY_WAGES_FIELDS)[number];
const SALARY_WAGES_KIND: Record<SalaryWagesField, ModelPathValueKind> = {
  payerName: "string",
  payerAbn: "string",
  grossSalaryWages: "number",
  paygWithheld: "number",
};

const INTEREST_ACCOUNT_FIELDS = [
  "institution",
  "accountDescription",
  "grossInterest",
  "tfnAmountsWithheld",
] as const;
type InterestAccountField = (typeof INTEREST_ACCOUNT_FIELDS)[number];
const INTEREST_ACCOUNT_KIND: Record<InterestAccountField, ModelPathValueKind> = {
  institution: "string",
  accountDescription: "string",
  grossInterest: "number",
  tfnAmountsWithheld: "number",
};

const DIVIDEND_FIELDS = [
  "company",
  "unfranked",
  "franked",
  "frankingCredits",
  "tfnAmountsWithheld",
] as const;
type DividendField = (typeof DIVIDEND_FIELDS)[number];
const DIVIDEND_KIND: Record<DividendField, ModelPathValueKind> = {
  company: "string",
  unfranked: "number",
  franked: "number",
  frankingCredits: "number",
  tfnAmountsWithheld: "number",
};

const INCOME_SCALAR_FIELDS = [
  "governmentAllowances",
  "reportableFringeBenefits",
  "reportableEmployerSuper",
] as const;
type IncomeScalarField = (typeof INCOME_SCALAR_FIELDS)[number];

const PRIVATE_HEALTH_FIELDS = [
  "premiumsEligibleForRebate",
  "rebateReceived",
  "oldestCoveredPersonAge",
  "coverDays",
] as const;
type PrivateHealthField = (typeof PRIVATE_HEALTH_FIELDS)[number];

/** The `SubstantiatedDeduction`-shaped labels an expense/donation receipt can target. */
const SUBSTANTIATED_DEDUCTIONS = [
  "workRelatedTravel",
  "workRelatedClothing",
  "selfEducation",
  "otherWorkRelated",
  "giftsAndDonations",
  "costOfManagingTaxAffairs",
] as const;
type SubstantiatedDeductionKey = (typeof SUBSTANTIATED_DEDUCTIONS)[number];

const SUBSTANTIATED_FIELDS = ["amount", "substantiationRef"] as const;
type SubstantiatedField = (typeof SUBSTANTIATED_FIELDS)[number];
const SUBSTANTIATED_KIND: Record<SubstantiatedField, ModelPathValueKind> = {
  amount: "number",
  substantiationRef: "string",
};

const WFH_FIELDS = ["hours", "substantiationRef"] as const;
type WfhField = (typeof WFH_FIELDS)[number];
const WFH_KIND: Record<WfhField, ModelPathValueKind> = {
  hours: "number",
  substantiationRef: "string",
};

const ARRAY_PATH = /^income\.(salaryWages|interestAccounts|dividends)\[(\d+)\]\.([a-zA-Z]+)$/;
const INCOME_SCALAR_PATH = /^income\.([a-zA-Z]+)$/;
const PRIVATE_HEALTH_PATH = /^privateHealth\.([a-zA-Z]+)$/;
const SUBSTANTIATED_PATH = /^deductions\.([a-zA-Z]+)\.([a-zA-Z]+)$/;
const WFH_PATH = /^deductions\.workFromHome\.([a-zA-Z]+)$/;

function isSalaryWagesField(field: string): field is SalaryWagesField {
  return (SALARY_WAGES_FIELDS as readonly string[]).includes(field);
}
function isInterestAccountField(field: string): field is InterestAccountField {
  return (INTEREST_ACCOUNT_FIELDS as readonly string[]).includes(field);
}
function isDividendField(field: string): field is DividendField {
  return (DIVIDEND_FIELDS as readonly string[]).includes(field);
}
function isIncomeScalarField(field: string): field is IncomeScalarField {
  return (INCOME_SCALAR_FIELDS as readonly string[]).includes(field);
}
function isPrivateHealthField(field: string): field is PrivateHealthField {
  return (PRIVATE_HEALTH_FIELDS as readonly string[]).includes(field);
}
function isSubstantiatedDeductionKey(key: string): key is SubstantiatedDeductionKey {
  return (SUBSTANTIATED_DEDUCTIONS as readonly string[]).includes(key);
}
function isSubstantiatedField(field: string): field is SubstantiatedField {
  return (SUBSTANTIATED_FIELDS as readonly string[]).includes(field);
}
function isWfhField(field: string): field is WfhField {
  return (WFH_FIELDS as readonly string[]).includes(field);
}

/** The value type a known `modelPath` expects, or `null` if the path isn't recognised. */
export function expectedValueKind(modelPath: string): ModelPathValueKind | null {
  const arrayMatch = ARRAY_PATH.exec(modelPath);
  if (arrayMatch) {
    const [, arrayName, , field] = arrayMatch as unknown as [string, string, string, string];
    if (arrayName === "salaryWages" && isSalaryWagesField(field)) return SALARY_WAGES_KIND[field];
    if (arrayName === "interestAccounts" && isInterestAccountField(field)) {
      return INTEREST_ACCOUNT_KIND[field];
    }
    if (arrayName === "dividends" && isDividendField(field)) return DIVIDEND_KIND[field];
    return null;
  }

  const incomeMatch = INCOME_SCALAR_PATH.exec(modelPath);
  if (incomeMatch) {
    const [, field] = incomeMatch as unknown as [string, string];
    return isIncomeScalarField(field) ? "number" : null;
  }

  const phiMatch = PRIVATE_HEALTH_PATH.exec(modelPath);
  if (phiMatch) {
    const [, field] = phiMatch as unknown as [string, string];
    return isPrivateHealthField(field) ? "number" : null;
  }

  const wfhMatch = WFH_PATH.exec(modelPath);
  if (wfhMatch) {
    const [, field] = wfhMatch as unknown as [string, string];
    return isWfhField(field) ? WFH_KIND[field] : null;
  }

  const substantiatedMatch = SUBSTANTIATED_PATH.exec(modelPath);
  if (substantiatedMatch) {
    const [, key, field] = substantiatedMatch as unknown as [string, string, string];
    if (isSubstantiatedDeductionKey(key) && isSubstantiatedField(field)) {
      return SUBSTANTIATED_KIND[field];
    }
    return null;
  }

  return null;
}

/** `true` when `modelPath` is a path {@link applyFigureToModel} knows how to apply. */
export function isKnownModelPath(modelPath: string): boolean {
  return expectedValueKind(modelPath) !== null;
}

function withArrayEntry<T>(
  array: readonly T[],
  index: number,
  makeEmpty: (id: string) => T,
  id: string,
): T[] {
  const copy = [...array];
  while (copy.length <= index) {
    copy.push(makeEmpty(`${id}-${copy.length}`));
  }
  return copy;
}

/**
 * Apply one figure to `model` via `propose()`, returning a new `ReturnModel`.
 * Throws for a `modelPath` outside the vocabulary in `prompts.ts`, or a
 * value whose type doesn't match what that path expects — both indicate a
 * bug upstream (a prompt drifted from this module, or `parse.ts` let through
 * something it shouldn't have), not bad user input.
 */
export function applyFigureToModel(
  model: ReturnModel,
  modelPath: string,
  value: number | string,
  origin: DocumentOrigin,
): ReturnModel {
  const expectedKind = expectedValueKind(modelPath);
  if (expectedKind === null) {
    throw new Error(`extraction: unknown modelPath "${modelPath}"`);
  }
  const actualKind = typeof value === "number" ? "number" : "string";
  if (actualKind !== expectedKind) {
    throw new Error(
      `extraction: modelPath "${modelPath}" expects a ${expectedKind}, got ${actualKind}`,
    );
  }

  const arrayMatch = ARRAY_PATH.exec(modelPath);
  if (arrayMatch) {
    const [, arrayName, indexText, field] = arrayMatch as unknown as [
      string,
      "salaryWages" | "interestAccounts" | "dividends",
      string,
      string,
    ];
    const index = Number(indexText);

    if (arrayName === "salaryWages" && isSalaryWagesField(field)) {
      const salaryWages = withArrayEntry(
        model.income.salaryWages,
        index,
        createEmptyEmployerIncome,
        origin.docId,
      );
      const entry = salaryWages[index] as EmployerIncome;
      salaryWages[index] = { ...entry, [field]: propose(entry[field], value, origin) };
      return { ...model, income: { ...model.income, salaryWages } };
    }

    if (arrayName === "interestAccounts" && isInterestAccountField(field)) {
      const interestAccounts = withArrayEntry(
        model.income.interestAccounts,
        index,
        createEmptyInterestAccount,
        origin.docId,
      );
      const entry = interestAccounts[index] as InterestAccount;
      interestAccounts[index] = { ...entry, [field]: propose(entry[field], value, origin) };
      return { ...model, income: { ...model.income, interestAccounts } };
    }

    if (arrayName === "dividends" && isDividendField(field)) {
      const dividends = withArrayEntry(
        model.income.dividends,
        index,
        createEmptyDividendHolding,
        origin.docId,
      );
      const entry = dividends[index] as DividendHolding;
      dividends[index] = { ...entry, [field]: propose(entry[field], value, origin) };
      return { ...model, income: { ...model.income, dividends } };
    }
  }

  const incomeMatch = INCOME_SCALAR_PATH.exec(modelPath);
  if (incomeMatch) {
    const [, field] = incomeMatch as unknown as [string, IncomeScalarField];
    return {
      ...model,
      income: { ...model.income, [field]: propose(model.income[field], value, origin) },
    };
  }

  const phiMatch = PRIVATE_HEALTH_PATH.exec(modelPath);
  if (phiMatch) {
    const [, field] = phiMatch as unknown as [string, PrivateHealthField];
    return {
      ...model,
      privateHealth: {
        ...model.privateHealth,
        [field]: propose(model.privateHealth[field], value, origin),
      },
    };
  }

  const wfhMatch = WFH_PATH.exec(modelPath);
  if (wfhMatch) {
    const [, field] = wfhMatch as unknown as [string, WfhField];
    return {
      ...model,
      deductions: {
        ...model.deductions,
        workFromHome: {
          ...model.deductions.workFromHome,
          [field]: propose(model.deductions.workFromHome[field], value, origin),
        },
      },
    };
  }

  const substantiatedMatch = SUBSTANTIATED_PATH.exec(modelPath);
  if (substantiatedMatch) {
    const [, key, field] = substantiatedMatch as unknown as [
      string,
      SubstantiatedDeductionKey,
      SubstantiatedField,
    ];
    const deduction = model.deductions[key];
    return {
      ...model,
      deductions: {
        ...model.deductions,
        [key]: { ...deduction, [field]: propose(deduction[field], value, origin) },
      },
    };
  }

  // Unreachable: expectedValueKind already matched one of the branches above.
  throw new Error(`extraction: unhandled modelPath "${modelPath}"`);
}
