import { assess } from "@aus-tax-lodge/engine";
import { issueId } from "@aus-tax-lodge/export";
import { toEngineInput, type ReturnModel } from "@aus-tax-lodge/model";
import { describe, expect, it } from "vitest";

import { deriveStatedAssumptions } from "../lib/export/assumptions";
import { computeExportGate } from "../lib/export/gate";
import { exportableModel, modelWithFrankingWarning } from "./export-fixtures";
import { confirmedField, readyModel } from "./review-fixtures";

const assessmentFor = (model: ReturnModel) => assess(toEngineInput(model));

describe("computeExportGate", () => {
  it("enables downloads for a clean, fully-confirmed return", () => {
    const model = exportableModel();
    const gate = computeExportGate(model, assessmentFor(model), []);
    expect(gate.blocked).toBe(false);
    expect(gate.errors).toHaveLength(0);
    expect(gate.downloadsEnabled).toBe(true);
  });

  it("blocks downloads when a mandatory figure is unconfirmed", () => {
    const model = readyModel(); // taxpayer identity fields still unset
    const gate = computeExportGate(model, assessmentFor(model), []);
    expect(gate.blocked).toBe(true);
    expect(gate.errors.length).toBeGreaterThan(0);
    expect(gate.downloadsEnabled).toBe(false);
  });

  it("requires every warning to be acknowledged before downloads enable", () => {
    const model = modelWithFrankingWarning();
    const assessment = assessmentFor(model);

    const unacked = computeExportGate(model, assessment, []);
    expect(unacked.blocked).toBe(false);
    expect(unacked.warnings.length).toBeGreaterThan(0);
    expect(unacked.warnings.every((w) => !w.acknowledged)).toBe(true);
    expect(unacked.downloadsEnabled).toBe(false);

    const warningId = unacked.warnings[0]!.id;
    expect(warningId).toBe(
      issueId({ code: "franking-credit-implausible", path: "income.dividends[0].frankingCredits" }),
    );

    const acked = computeExportGate(model, assessment, [warningId]);
    expect(acked.warnings[0]!.acknowledged).toBe(true);
    expect(acked.downloadsEnabled).toBe(true);
  });

  it("blocks when the assessment could not be computed", () => {
    const gate = computeExportGate(exportableModel(), null, []);
    expect(gate.blocked).toBe(true);
    expect(gate.downloadsEnabled).toBe(false);
  });
});

describe("deriveStatedAssumptions", () => {
  it("always states the estimate caveat", () => {
    const model = exportableModel();
    const assumptions = deriveStatedAssumptions(model, assessmentFor(model));
    expect(assumptions.some((a) => a.includes("estimate, not the ATO's assessment"))).toBe(true);
  });

  it("states the spouse-income estimate assumption when there is a spouse", () => {
    const base = exportableModel();
    const model: ReturnModel = {
      ...base,
      context: {
        ...base.context,
        spouse: {
          status: confirmedField("had-spouse"),
          name: confirmedField("Sam Example"),
          dateOfBirth: confirmedField("1986-01-01"),
          estimatedTaxableIncome: confirmedField(60_000),
          privateHospitalCoverDays: confirmedField(365),
        },
      },
    };
    const assumptions = deriveStatedAssumptions(model, assessmentFor(model));
    expect(assumptions.some((a) => a.toLowerCase().includes("spouse taxable income"))).toBe(true);
  });
});
