import { createEmptyReturnModel } from "@aus-tax-lodge/model";
import { describe, expect, it } from "vitest";

import { topicsOutstanding } from "../../lib/interview";
import { readyModel } from "../review-fixtures";

describe("topicsOutstanding (PRD FR-3, Q1)", () => {
  it("is empty for a model that meets the deterministic completeness gate", () => {
    expect(topicsOutstanding(readyModel())).toEqual([]);
  });

  it("lists outstanding areas for a barely-started return", () => {
    const topics = topicsOutstanding(createEmptyReturnModel());
    expect(topics.length).toBeGreaterThan(0);
    // Deduction labels and the FR-6 questionnaire facts are all still open.
    expect(topics.join(" | ")).toMatch(/study|resident|cover|D5|donation/i);
  });
});
