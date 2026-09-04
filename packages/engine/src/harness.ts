import { PARAMS_VERSION, TARGET_YEAR, getDataset } from "@aus-tax-lodge/params";

import { ENGINE_VERSION } from "./version";

/**
 * The report the CLI harness prints. Kept as a pure function so tests can assert
 * on it without spawning a process. From T5 the harness also runs the golden
 * set; for now it reports the engine version and the active tax-parameter set
 * (PRD FR-15).
 */
export function buildHarnessReport(): string {
  const { params } = getDataset(TARGET_YEAR);
  return [
    "aus-tax-lodge engine harness",
    `engine version: ${ENGINE_VERSION}`,
    `target income year: ${TARGET_YEAR}`,
    `tax-parameter set: ${PARAMS_VERSION} (researched ${params.meta.researchedOn}, pending human verification)`,
    "status: scaffold — no calculation logic yet (T3/T4), no golden set yet (T5)",
  ].join("\n");
}
