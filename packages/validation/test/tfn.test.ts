import { describe, expect, it } from "vitest";

import { isValidTfn } from "../src/tfn";

describe("isValidTfn (PRD FR-1, FR-13)", () => {
  it("accepts a valid 9-digit ATO test TFN", () => {
    expect(isValidTfn("123456782")).toBe(true);
  });

  it("accepts the same TFN with space separators", () => {
    expect(isValidTfn("123 456 782")).toBe(true);
  });

  it("rejects a 9-digit number that fails the checksum", () => {
    expect(isValidTfn("123456781")).toBe(false);
  });

  it("rejects a TFN with non-digit characters", () => {
    expect(isValidTfn("12345678A")).toBe(false);
  });

  it("rejects the wrong length", () => {
    expect(isValidTfn("1234567")).toBe(false);
    expect(isValidTfn("1234567890")).toBe(false);
  });

  it("accepts a valid 8-digit legacy TFN (modulus-11 checksum, weights [10,7,8,4,6,3,5,1])", () => {
    // 3*10+2*7+5*8+4*4+7*6+6*3+8*5+9*1 = 209 = 11 x 19.
    expect(isValidTfn("32547689")).toBe(true);
  });

  it("rejects an 8-digit number that fails the checksum", () => {
    expect(isValidTfn("32547688")).toBe(false);
  });
});
