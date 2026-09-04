// CLI harness for the calculation engine. Run with `npm -w @aus-tax-lodge/engine
// run harness` (or `npm run harness` from the repo root). Later tasks' golden-set
// tests (T5) invoke this; for now it prints the engine version and exits 0.
import { buildHarnessReport } from "../src/harness";

console.log(buildHarnessReport());
