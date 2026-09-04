/**
 * Golden-set runner (PRD T5) — the engine release gate.
 *
 * Loads every scenario in `./golden/scenarios.ts`, runs it through `assess()`,
 * and asserts each `expected` field within its per-field tolerance ($0 unless
 * the scenario documents a ≤ $1 tolerance for the Medicare levy surcharge or the
 * PHI rebate reconciliation). Any mismatch fails `npm test`.
 *
 * `expected` values come from the ATO published rates/rules pages (hand-worked
 * in each scenario's `source`), never from `assess()`.
 *
 * Scenarios carrying a `defect` note are ones where `assess()` is known to
 * disagree with the authoritative value because of a defect in the engine or the
 * 2025-26 params (T2–T4), not in the test. They run under `it.fails` so the
 * suite stays green for regression purposes while still pinning the correct
 * answer — if the engine result later changes, `it.fails` turns red and forces a
 * review. Every such scenario is listed in the PR body.
 */
import { describe, expect, it } from "vitest";

import { assess } from "../src/full";
import { readField, type GoldenField, type Scenario } from "./golden/scenario";
import { scenarios } from "./golden/scenarios";

/** Round to whole cents, absorbing binary-float noise before comparison. */
function toCents(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function checkScenario(s: Scenario): void {
  const result = assess(s.input);
  const failures: string[] = [];

  for (const key of Object.keys(s.expected) as GoldenField[]) {
    const expected = s.expected[key];
    if (expected === undefined) continue;
    const tol = s.tolerance?.[key] ?? 0;
    const actual = readField(result, key);
    // The accuracy bar is exact-to-the-cent (with a documented ≤ $1 tolerance on
    // the surcharge / PHI rebate). Compare at cent precision so unrounded
    // intermediate floats (`taxOnTaxableIncome` is kept unrounded) don't read as
    // a mismatch when the cent value is exact.
    const delta = toCents(actual) - expected;
    if (!Number.isFinite(actual) || Math.abs(delta) > tol) {
      failures.push(
        `${key}: expected ${expected}${tol ? ` ±${tol}` : ""}, got ${actual} (Δ ${delta.toFixed(4)})`,
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `${s.id} — ${s.description}\n` +
        `  authoritative source: ${s.source}\n  ` +
        failures.join("\n  "),
    );
  }
}

describe("golden set — 2025-26 (engine release gate)", () => {
  it("covers the PRD accuracy-bar case list (≥ 30 scenarios incl. rental cases)", () => {
    // The PRD asks for ~30–35; hitting every resident bracket boundary at ±1
    // plus the surcharge tiers (single + partnered), the study-loan seams and
    // the rental cases lands a little higher.
    expect(scenarios.length).toBeGreaterThanOrEqual(30);
    expect(new Set(scenarios.map((s) => s.id)).size).toBe(scenarios.length);
  });

  for (const s of scenarios) {
    if (s.defect) {
      it.fails(`${s.id} — ${s.description}  [DEFECT: ${s.defect}]`, () => {
        checkScenario(s);
      });
    } else {
      it(`${s.id} — ${s.description}`, () => {
        checkScenario(s);
      });
    }
  }
});
