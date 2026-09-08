import { describe, expect, it } from "vitest";

import { APPLY_TURN_SYSTEM, NEXT_TURN_SYSTEM } from "../../lib/interview";

/**
 * PRD acceptance (issue #67): "Assistant never advises, recommends structuring,
 * or suggests an unraised deduction." This is a prompt-level guarantee — both
 * system prompts must carry the constraint. No runtime enforcement is expected.
 */
const NO_ADVICE =
  "You do not give tax advice, recommend how to arrange affairs, or suggest a deduction";

describe("interview system prompts — the assistant never advises (issue #67)", () => {
  it("NEXT_TURN_SYSTEM forbids advice / structuring / unraised deductions", () => {
    expect(NEXT_TURN_SYSTEM).toContain(NO_ADVICE);
  });

  it("APPLY_TURN_SYSTEM forbids advice / structuring / unraised deductions", () => {
    expect(APPLY_TURN_SYSTEM).toContain(NO_ADVICE);
  });

  it("NEXT_TURN_SYSTEM no longer offers 'out-of-scope' as a card type Claude can pick", () => {
    expect(NEXT_TURN_SYSTEM).not.toContain('"out-of-scope"');
  });
});
