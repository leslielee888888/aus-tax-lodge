/**
 * `@aus-tax-lodge/model` — the return domain model, field-level provenance, and
 * the model → engine-input mapper (PRD FR-1, FR-4, FR-5, FR-6, FR-7, FR-11,
 * FR-22, FR-24).
 *
 * Pure TypeScript aside from `@aus-tax-lodge/ai` (the rental schedule's Claude
 * vision calls). The persistence layer (`@aus-tax-lodge/store`) stores a
 * {@link ReturnModel} verbatim inside its opaque `data` payload; the extraction
 * pipeline (T11) proposes non-rental figures onto it; the review UI (T17) and
 * questionnaire (T18) confirm them; {@link assembleRentalSchedule} (T7) fills
 * the rental schedule from its three source documents plus owner-paid entries;
 * T9 reads it for out-of-scope detection; T8 validates it; and
 * {@link toEngineInput} hands the confirmed figures to `@aus-tax-lodge/engine`.
 */

export { RETURN_MODEL_VERSION } from "./version";

export {
  type FieldStatus,
  type FieldConfidence,
  type DocumentOrigin,
  type UserAnswerOrigin,
  type ComputedOrigin,
  type FieldOrigin,
  type FieldEdit,
  type Provenanced,
  unsetField,
  documentOrigin,
  computedOrigin,
  propose,
  confirm,
  edit,
  markNotApplicable,
  answer,
  isSettled,
  valueOr,
} from "./provenance";

export {
  RENTAL_REPAIRS_CONFIRMATION_THRESHOLD,
  CAR_CENTS_PER_KM_MAX_KM,
  RENTAL_EXPENSE_KEYS,
  type PostalAddress,
  type BankAccount,
  type TaxpayerDetails,
  type SpouseStatus,
  type SpouseDetails,
  type ReturnContext,
  type EmployerIncome,
  type InterestAccount,
  type DividendHolding,
  type IncomeSection,
  type SubstantiatedDeduction,
  type CarKmDeduction,
  type WorkFromHomeDeduction,
  type DeductionsSection,
  type RentalExpenseKey,
  type RentalExpenseSource,
  type RentalExpenseLine,
  type RentalPropertyIdentity,
  type RentalSchedule,
  type PrivateHealthSection,
  type RentalScopeGateAnswer,
  type QuestionnaireAnswers,
  type ReturnModel,
  computeCarKmDeduction,
  computeWfhFixedRateDeduction,
  totalRentalDeductions,
  computeNetRentalResult,
  recomputeNetRentalResult,
  totalWorkAndPersonalDeductions,
  apportionedInterest,
  assertRentalExpenseKeysMatchTaxonomy,
  createEmptyEmployerIncome,
  createEmptyInterestAccount,
  createEmptyDividendHolding,
  createEmptyReturnModel,
} from "./model";

export { MissingFiguresError, toEngineInput } from "./to-engine-input";

export {
  type RentalSourceDocument,
  type RentalSourceDocuments,
  type OwnerPaidRentalExpenses,
  type ParsedRentalFigure,
  type AgentStatementLineItem,
  type AgentStatementParseResult,
  type LoanSummaryParseResult,
  type QsScheduleParseResult,
  parseAgentStatement,
  parseLoanSummary,
  parseQsSchedule,
  assembleRentalSchedule,
  needsRepairsConfirmation,
  confirmRepairsAreDeductible,
  reclassifyRepairsAsCapital,
} from "./rental-assembly";

export {
  type LabelAggregateStatus,
  type LabelCompleteness,
  requiredLabels,
  isReadyForEstimate,
} from "./completeness";
