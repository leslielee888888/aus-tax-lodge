export { ENGINE_VERSION } from "./version";
export {
  assessCore,
  computeAssessableIncome,
  computeTaxableIncome,
  grossUpDividends,
  residentIncomeTax,
} from "./core";
export { buildHarnessReport } from "./harness";

export type {
  ResidencyStatus,
  DividendIncome,
  EngineIncomeInput,
  EngineDeductionsInput,
  EngineContextInput,
  EngineInput,
  AssessableIncomeBreakdown,
  CoreAssessment,
  EngineResult,
} from "./types";

/**
 * Re-exported from `@aus-tax-lodge/params` so callers (the estimate output, the
 * export package, the UI) can stamp which versioned tax-parameter set a return
 * was calculated against (PRD FR-15) without a second dependency.
 */
export {
  TARGET_YEAR,
  PARAMS_VERSION,
  getParams,
  getTaxonomy,
  getDataset,
} from "@aus-tax-lodge/params";
