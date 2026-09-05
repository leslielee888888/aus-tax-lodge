import { isValidTfn } from "@aus-tax-lodge/validation";
import { describe, expect, it } from "vitest";

import {
  normalizeBsb,
  parseDdMmYyyyToIso,
  validateAccountNumber,
  validateBsb,
  validateDayCount,
  validateDob,
  validateNonNegativeAmount,
  validateNonNegativeInteger,
  validatePostcode,
  validateTfn,
} from "../lib/details/validation";

// The checksum itself is `@aus-tax-lodge/validation`'s (T8); these tests only
// exercise this form's wrapping (required / length / message conventions).
describe("TFN checksum (PRD FR-1)", () => {
  it("accepts a valid ATO test TFN", () => {
    // The same test TFN used by packages/model/test/fixtures.ts.
    expect(isValidTfn("123456782")).toBe(true);
  });

  it("rejects a TFN with a bad checksum digit", () => {
    expect(isValidTfn("123456781")).toBe(false);
  });

  it("accepts a valid 8-digit TFN and rejects a 10-digit string", () => {
    expect(isValidTfn("12345677")).toBe(true);
    expect(isValidTfn("1234567823")).toBe(false);
  });

  it("validateTfn reports each failure distinctly", () => {
    expect(validateTfn("")).toMatch(/required/i);
    expect(validateTfn("1234567")).toMatch(/8 or 9 digits/i);
    expect(validateTfn("123456781")).toMatch(/check/i);
    expect(validateTfn("123 456 782")).toBeNull();
    expect(validateTfn("123 456 77")).toBeNull();
  });
});

describe("BSB (PRD FR-1)", () => {
  it("accepts NNN-NNN and NNNNNN", () => {
    expect(validateBsb("063-018")).toBeNull();
    expect(validateBsb("063018")).toBeNull();
  });

  it("rejects the wrong shape", () => {
    expect(validateBsb("")).toMatch(/required/i);
    expect(validateBsb("63-018")).toMatch(/6 digits/i);
    expect(validateBsb("063-01")).toMatch(/6 digits/i);
  });

  it("normalizes 6 raw digits to NNN-NNN", () => {
    expect(normalizeBsb("063018")).toBe("063-018");
    expect(normalizeBsb("063-018")).toBe("063-018");
  });
});

describe("Account number", () => {
  it("accepts 5-10 digits", () => {
    expect(validateAccountNumber("12345")).toBeNull();
    expect(validateAccountNumber("1234567890")).toBeNull();
  });

  it("rejects too short or too long", () => {
    expect(validateAccountNumber("1234")).toMatch(/5.10/);
    expect(validateAccountNumber("12345678901")).toMatch(/5.10/);
    expect(validateAccountNumber("")).toMatch(/required/i);
  });
});

describe("Date of birth (PRD FR-1)", () => {
  it("accepts a real past date as DD/MM/YYYY", () => {
    expect(validateDob("14/03/1990")).toBeNull();
  });

  it("rejects a calendar-invalid date", () => {
    expect(validateDob("31/02/2020")).toMatch(/real date/i);
    expect(validateDob("32/01/2020")).toMatch(/real date/i);
  });

  it("rejects a future date", () => {
    expect(validateDob("01/01/2999")).toMatch(/past/i);
  });

  it("rejects the wrong format", () => {
    expect(validateDob("1990-03-14")).toMatch(/real date/i);
    expect(validateDob("")).toMatch(/required/i);
  });

  it("round-trips through parseDdMmYyyyToIso", () => {
    expect(parseDdMmYyyyToIso("14/03/1990")).toBe("1990-03-14");
    expect(parseDdMmYyyyToIso("31/02/2020")).toBeNull();
  });
});

describe("Postcode", () => {
  it("requires exactly 4 digits", () => {
    expect(validatePostcode("2000")).toBeNull();
    expect(validatePostcode("200")).toMatch(/4 digits/);
    expect(validatePostcode("")).toMatch(/required/i);
  });
});

describe("Day counts and amounts", () => {
  it("accepts 0-366 for a day count", () => {
    expect(validateDayCount("0", "Days")).toBeNull();
    expect(validateDayCount("366", "Days")).toBeNull();
    expect(validateDayCount("367", "Days")).toMatch(/between 0 and 366/);
    expect(validateDayCount("-1", "Days")).toMatch(/whole number/);
  });

  it("accepts a non-negative amount", () => {
    expect(validateNonNegativeAmount("78400", "Income")).toBeNull();
    expect(validateNonNegativeAmount("-1", "Income")).toMatch(/negative/);
    expect(validateNonNegativeAmount("abc", "Income")).toMatch(/number/);
  });

  it("accepts a non-negative integer", () => {
    expect(validateNonNegativeInteger("0", "Children")).toBeNull();
    expect(validateNonNegativeInteger("2", "Children")).toBeNull();
    expect(validateNonNegativeInteger("-1", "Children")).toMatch(/0 or more/);
  });
});
