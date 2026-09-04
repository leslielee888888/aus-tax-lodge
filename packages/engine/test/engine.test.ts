import { describe, expect, it } from "vitest";

import { buildHarnessReport, ENGINE_VERSION, estimate } from "../src/index";

describe("engine placeholder surface", () => {
  it("exposes a semver-shaped version string", () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("estimate() throws 'not implemented' until T3/T4", () => {
    expect(() => estimate()).toThrow(/not implemented/i);
  });

  it("the harness report names the engine version", () => {
    expect(buildHarnessReport()).toContain(`engine version: ${ENGINE_VERSION}`);
  });
});
