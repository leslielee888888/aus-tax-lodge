import { describe, expect, it } from "vitest";

import {
  answer,
  confirm,
  computedOrigin,
  documentOrigin,
  edit,
  isSettled,
  markNotApplicable,
  propose,
  unsetField,
  valueOr,
} from "../src/provenance";

describe("Provenanced field transitions (PRD FR-7, FR-22)", () => {
  it("starts unset with no value, origin or history", () => {
    const f = unsetField<number>();
    expect(f).toEqual({
      value: null,
      status: "unset",
      origin: null,
      proposedValue: null,
      edits: [],
    });
    expect(isSettled(f)).toBe(false);
  });

  it("propose records the value, the origin and the original proposed value", () => {
    const origin = documentOrigin("doc-9", 2, "Interest $412.55", "high");
    const f = propose(unsetField<number>(), 412.55, origin);
    expect(f.value).toBe(412.55);
    expect(f.status).toBe("proposed");
    expect(f.origin).toEqual(origin);
    expect(f.proposedValue).toBe(412.55);
    expect(f.edits).toEqual([]);
    expect(isSettled(f)).toBe(false);
  });

  it("propose → edit keeps the proposed value and appends one edit", () => {
    const proposed = propose(unsetField<number>(), 100, documentOrigin("d", 1, "100", "medium"));
    const edited = edit(proposed, 125, "2026-07-01T00:00:00.000Z");

    expect(edited.value).toBe(125);
    expect(edited.status).toBe("confirmed");
    expect(edited.proposedValue).toBe(100); // original proposal preserved
    expect(edited.edits).toEqual([{ at: "2026-07-01T00:00:00.000Z", from: 100, to: 125 }]);
    // origin carried through from the proposal
    expect(edited.origin).toEqual(documentOrigin("d", 1, "100", "medium"));
  });

  it("a second edit appends again and still keeps the first proposed value", () => {
    let f = propose(unsetField<number>(), 100, documentOrigin("d", 1, "100", "low"));
    f = edit(f, 120, "2026-07-01T00:00:00.000Z");
    f = edit(f, 140, "2026-07-02T00:00:00.000Z");
    expect(f.proposedValue).toBe(100);
    expect(f.edits.map((e) => e.to)).toEqual([120, 140]);
    expect(f.edits.map((e) => e.from)).toEqual([100, 120]);
  });

  it("confirm settles a proposed value without changing it", () => {
    const f = confirm(propose(unsetField<string>(), "NSW", documentOrigin("d", 1, "NSW", "high")));
    expect(f.status).toBe("confirmed");
    expect(f.value).toBe("NSW");
    expect(isSettled(f)).toBe(true);
  });

  it("markNotApplicable clears the value but keeps the history", () => {
    let f = propose(unsetField<number>(), 50, documentOrigin("d", 1, "50", "high"));
    f = edit(f, 60, "2026-07-01T00:00:00.000Z");
    f = markNotApplicable(f);
    expect(f.status).toBe("not-applicable");
    expect(f.value).toBeNull();
    expect(f.origin).toBeNull();
    expect(f.proposedValue).toBe(50);
    expect(f.edits).toHaveLength(1);
    expect(isSettled(f)).toBe(true);
  });

  it("answer records a user-answer origin and settles it confirmed", () => {
    const f = answer(unsetField<boolean>(), true);
    expect(f.status).toBe("confirmed");
    expect(f.value).toBe(true);
    expect(f.origin).toEqual({ kind: "user-answer" });
    expect(f.proposedValue).toBe(true);
    expect(isSettled(f)).toBe(true);
  });

  it("a computed origin carries its inputs description", () => {
    const f = propose(
      unsetField<number>(),
      -4080,
      computedOrigin("gross rent − rental deductions"),
    );
    expect(f.origin).toEqual({ kind: "computed", from: "gross rent − rental deductions" });
  });

  it("helpers never mutate the input field", () => {
    const original = propose(unsetField<number>(), 10, documentOrigin("d", 1, "10", "high"));
    const snapshot = JSON.parse(JSON.stringify(original));
    edit(original, 20, "2026-07-01T00:00:00.000Z");
    confirm(original);
    markNotApplicable(original);
    expect(original).toEqual(snapshot);
  });

  it("valueOr falls back only when the value is null", () => {
    expect(valueOr(unsetField<number>(), 0)).toBe(0);
    expect(
      valueOr(confirm(propose(unsetField<number>(), 7, documentOrigin("d", 1, "7", "high"))), 0),
    ).toBe(7);
  });
});
