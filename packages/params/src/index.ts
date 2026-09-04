/**
 * `@aus-tax-lodge/params` — versioned Australian individual-tax parameters
 * (PRD FR-15) and the ATO individual-return label taxonomy (PRD §8).
 *
 * Data only, zero framework dependencies. The deterministic calculation engine
 * (`@aus-tax-lodge/engine`, T3/T4) and the web app read from here; nothing here
 * imports from them.
 */
export type {
  Provenance,
  Sourced,
  ParamsMeta,
  TaxBracket,
  MedicareLevyBand,
  MedicareLevyParams,
  IncomeTier,
  MlsTier,
  MedicareLevySurchargeParams,
  PhiAgeBracket,
  PhiIncomeTier,
  PhiRebatePeriod,
  PrivateHealthRebateParams,
  LitoTaper,
  LowIncomeTaxOffsetParams,
  BeneficiaryTaxOffsetParams,
  StudyLoanBand,
  StudyLoanParams,
  RoundingParams,
  TaxParams,
  MyTaxSection,
  ReturnLabel,
  RentalPaperLabel,
  RentalScheduleLabel,
  LabelTaxonomy,
  YearDataset,
} from "./types";

export {
  TARGET_YEAR,
  PARAMS_VERSION,
  DATASETS,
  availableYears,
  getDataset,
  getParams,
  getTaxonomy,
} from "./registry";

export { validateDataset, assertValidDataset, type ValidationResult } from "./validate";

export { dataset202526, params202526, taxonomy202526 } from "./2025-26";
