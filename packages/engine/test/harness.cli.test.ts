import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ENGINE_VERSION } from "../src/version";

const harness = fileURLToPath(new URL("../bin/harness.ts", import.meta.url));

describe("engine CLI harness (bin/harness.ts)", () => {
  it("runs via `node --import tsx`, prints the engine version, and exits 0", () => {
    // execFileSync throws on a non-zero exit, so reaching the assertion == exit 0.
    const output = execFileSync(process.execPath, ["--import", "tsx", harness], {
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(output).toContain(`engine version: ${ENGINE_VERSION}`);
  }, 30_000);
});
