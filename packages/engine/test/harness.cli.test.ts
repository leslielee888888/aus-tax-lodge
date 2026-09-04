import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ENGINE_VERSION } from "../src/version";

const require = createRequire(import.meta.url);
// Resolve tsx's CLI entry and run it with the current `node`. Works on every
// Node version tsx supports (18+) — unlike `node --import tsx`, which needs 20.6.
const tsxCli = require.resolve("tsx/cli");
const harness = fileURLToPath(new URL("../bin/harness.ts", import.meta.url));

describe("engine CLI harness (bin/harness.ts)", () => {
  it("runs via tsx, prints the engine version, and exits 0", () => {
    // execFileSync throws on a non-zero exit, so reaching the assertion == exit 0.
    const output = execFileSync(process.execPath, [tsxCli, harness], {
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(output).toContain(`engine version: ${ENGINE_VERSION}`);
  }, 30_000);
});
