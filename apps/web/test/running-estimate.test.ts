/**
 * T8 — `maybeRunningEstimate` (PRD FR-10): a mid-interview "how's my refund
 * looking?" is answered from the deterministic engine, never by Claude. When the
 * engine can't run yet the reply says so and names what is outstanding.
 */
import { createEmptyReturnModel, type ReturnModel } from "@aus-tax-lodge/model";
import { describe, expect, it } from "vitest";

import { unsetField } from "@aus-tax-lodge/model";

import { isRunningEstimateRequest, maybeRunningEstimate } from "../lib/estimate/running-estimate";
import { exportableModel } from "./export-fixtures";

/**
 * Fully assessable by the engine, but not "ready for estimate" — one FR-6
 * questionnaire fact (the WFH double-claim guard) is still unanswered.
 */
function almostReady(): ReturnModel {
  const base = exportableModel();
  return {
    ...base,
    questionnaire: {
      ...base.questionnaire,
      wfhHoursNotDoubleClaimed: unsetField<boolean>(),
    },
  };
}

describe("isRunningEstimateRequest", () => {
  it("recognises a 'where am I' question", () => {
    expect(isRunningEstimateRequest("what's my refund looking like so far?")).toBe(true);
    expect(isRunningEstimateRequest("roughly how much will I owe?")).toBe(true);
  });

  it("ignores a plain statement of fact", () => {
    expect(isRunningEstimateRequest("my refund last year was 900 dollars")).toBe(false);
    expect(isRunningEstimateRequest("I worked from home three days a week")).toBe(false);
  });
});

describe("maybeRunningEstimate (PRD FR-10)", () => {
  it("returns null when the message is not an estimate request", () => {
    expect(maybeRunningEstimate(exportableModel(), "I had a bank account with NAB")).toBeNull();
  });

  it("gives an engine-computed figure with the 'engine does the maths' caveat when ready", () => {
    const reply = maybeRunningEstimate(exportableModel(), "how's my refund looking so far?");
    expect(reply).toBeTruthy();
    expect(reply).toMatch(/refund|to pay/i);
    expect(reply).toMatch(/engine does the maths, not me|deterministic tax engine/i);
  });

  it("still answers with a rough figure when the return is assessable but not ready", () => {
    const reply = maybeRunningEstimate(almostReady(), "ballpark, what am I getting back?");
    expect(reply).toBeTruthy();
    expect(reply).toMatch(/rough/i);
  });

  it("says it can't compute yet and names what is outstanding when a figure is missing", () => {
    const reply = maybeRunningEstimate(
      createEmptyReturnModel("2025-26"),
      "what does my refund look like right now?",
    );
    expect(reply).toMatch(/can't give you a reliable estimate yet/i);
    expect(reply).toMatch(/still need to sort out/i);
  });
});
