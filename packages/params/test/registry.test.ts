import { describe, expect, it } from "vitest";

import {
  availableYears,
  DATASETS,
  getDataset,
  getParams,
  getTaxonomy,
  PARAMS_VERSION,
  TARGET_YEAR,
  dataset202526,
} from "../src/index";

describe("version + target-year constants are exported (PRD FR-15)", () => {
  it("TARGET_YEAR is the ATO income-year label the tool is configured for", () => {
    expect(TARGET_YEAR).toBe("2025-26");
  });

  it("PARAMS_VERSION is the active dataset's version and starts with the target year", () => {
    expect(PARAMS_VERSION).toBe(dataset202526.params.meta.paramsVersion);
    expect(PARAMS_VERSION).toMatch(/^2025-26\./);
  });

  it("the target year's metadata bounds the income year", () => {
    const meta = getParams().meta;
    expect(meta.incomeYearStart).toBe("2025-07-01");
    expect(meta.incomeYearEnd).toBe("2026-06-30");
  });
});

describe("typed accessor", () => {
  it("defaults to the target year", () => {
    expect(getDataset()).toBe(DATASETS[TARGET_YEAR]);
    expect(getParams()).toBe(dataset202526.params);
    expect(getTaxonomy()).toBe(dataset202526.taxonomy);
  });

  it("resolves an explicit known year", () => {
    expect(getDataset("2025-26")).toBe(dataset202526);
  });

  it("throws a helpful error for an unknown year", () => {
    expect(() => getParams("2099-00")).toThrow(
      /No tax-parameter dataset for income year "2099-00"/,
    );
  });

  it("lists the available years", () => {
    expect(availableYears()).toContain("2025-26");
  });
});
