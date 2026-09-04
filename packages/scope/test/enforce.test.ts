import { describe, expect, it } from "vitest";

import { detectOutOfScope } from "../src/detect";
import { assertInScope, isBlocked, OutOfScopeError } from "../src/enforce";
import { scopeFinding } from "../src/findings";
import { cleanSalaryReturn, withRentalScopeGate, cleanRentalReturn } from "./fixtures";

describe("isBlocked", () => {
  it("is false for no findings and true for any", () => {
    expect(isBlocked([])).toBe(false);
    expect(isBlocked([scopeFinding("capital-gains", "document")])).toBe(true);
  });
});

describe("assertInScope", () => {
  it("does nothing when there are no findings", () => {
    expect(() => assertInScope([])).not.toThrow();
  });

  it("throws an OutOfScopeError carrying the findings", () => {
    const findings = detectOutOfScope({
      model: withRentalScopeGate(cleanRentalReturn(), {
        solelyOwned: false,
        rentedOrAvailableAllYear: true,
        noPrivateUse: true,
        notBoughtOrSoldThisYear: true,
      }),
    });
    expect(findings).toHaveLength(1);

    try {
      assertInScope(findings);
      expect.unreachable("assertInScope should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OutOfScopeError);
      expect((err as OutOfScopeError).findings).toBe(findings);
      expect((err as OutOfScopeError).message).toContain("co-owned");
    }
  });

  it("has no override path — the only argument is the findings list", () => {
    expect(assertInScope).toHaveLength(1);
  });

  it("passes a clean return through", () => {
    expect(() => assertInScope(detectOutOfScope({ model: cleanSalaryReturn() }))).not.toThrow();
  });
});
