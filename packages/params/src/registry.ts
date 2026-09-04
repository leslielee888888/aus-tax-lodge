/**
 * Typed accessor over the curated datasets. One income year is active at a time
 * (PRD FR-15); {@link TARGET_YEAR} and {@link PARAMS_VERSION} are surfaced so
 * the UI and the export can show which parameter set a return was built against.
 *
 * Adding a future income year is a new folder under `src/<year>/` plus one line
 * in {@link DATASETS} — no engine change (see `../README.md`).
 */
import { dataset202526 } from "./2025-26";
import type { LabelTaxonomy, TaxParams, YearDataset } from "./types";

/** The income year the tool is currently configured for. */
export const TARGET_YEAR = "2025-26";

/** Every curated dataset, keyed by ATO income-year label. */
export const DATASETS: Readonly<Record<string, YearDataset>> = {
  "2025-26": dataset202526,
};

/**
 * Version of the **active** curated dataset (`<year>.<n>`). Shown in the UI and
 * printed on the export package (PRD FR-15).
 */
export const PARAMS_VERSION: string = DATASETS[TARGET_YEAR]!.params.meta.paramsVersion;

/** Income-year labels with a curated dataset, newest first. */
export function availableYears(): string[] {
  return Object.keys(DATASETS).sort().reverse();
}

/** Get a full dataset by income year. Defaults to {@link TARGET_YEAR}. Throws if unknown. */
export function getDataset(year: string = TARGET_YEAR): YearDataset {
  const dataset = DATASETS[year];
  if (!dataset) {
    throw new Error(
      `No tax-parameter dataset for income year "${year}". Available: ${availableYears().join(", ")}`,
    );
  }
  return dataset;
}

/** Get the tax parameters for an income year (default {@link TARGET_YEAR}). */
export function getParams(year: string = TARGET_YEAR): TaxParams {
  return getDataset(year).params;
}

/** Get the ATO label taxonomy for an income year (default {@link TARGET_YEAR}). */
export function getTaxonomy(year: string = TARGET_YEAR): LabelTaxonomy {
  return getDataset(year).taxonomy;
}
