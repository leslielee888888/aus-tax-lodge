import { ENGINE_VERSION } from "./version";

/**
 * The report the CLI harness prints. Kept as a pure function so tests can assert
 * on it without spawning a process. From T5 the harness also runs the golden
 * set; for now it just reports the engine version.
 */
export function buildHarnessReport(): string {
  return [
    "aus-tax-lodge engine harness",
    `engine version: ${ENGINE_VERSION}`,
    "status: scaffold — no calculation logic yet (T3/T4), no golden set yet (T5)",
  ].join("\n");
}
