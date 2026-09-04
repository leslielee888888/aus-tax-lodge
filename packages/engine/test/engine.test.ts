import { describe, expect, it } from "vitest";

import { buildHarnessReport, ENGINE_VERSION } from "../src/index";

describe("engine public surface", () => {
  it("exposes a semver-shaped version string", () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("the harness report names the engine version and runs the worked example", () => {
    const report = buildHarnessReport();
    expect(report).toContain(`engine version: ${ENGINE_VERSION}`);
    expect(report).toContain("total assessable income");
    expect(report).toContain("resident income tax on taxable income");
  });
});
