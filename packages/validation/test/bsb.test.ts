import { describe, expect, it } from "vitest";

import { isValidBsb } from "../src/bsb";

describe("isValidBsb (PRD FR-1, FR-13)", () => {
  it("accepts a hyphenated BSB", () => {
    expect(isValidBsb("062-000")).toBe(true);
  });

  it("accepts an unhyphenated 6-digit BSB", () => {
    expect(isValidBsb("062000")).toBe(true);
  });

  it("rejects the wrong number of digits", () => {
    expect(isValidBsb("1234567")).toBe(false);
    expect(isValidBsb("12345")).toBe(false);
  });

  it("rejects non-digit characters", () => {
    expect(isValidBsb("06A-000")).toBe(false);
  });

  it("rejects a bad grouping", () => {
    expect(isValidBsb("06-2000")).toBe(false);
  });
});
