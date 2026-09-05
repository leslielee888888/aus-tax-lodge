import { createEmptyReturnModel } from "@aus-tax-lodge/model";
import { describe, expect, it } from "vitest";

import {
  hasUnresolvedMismatches,
  resolveReconciliation,
  suggestDefaultChoice,
} from "../src/reconcile";
import type { PendingReconciliation, ReconciliationCandidate } from "../src/types";

function candidate(overrides: Partial<ReconciliationCandidate> = {}): ReconciliationCandidate {
  return {
    docId: "doc-1",
    documentType: "bank-interest-notice",
    page: 1,
    snippet: "x",
    confidence: "high",
    value: 400,
    ...overrides,
  };
}

describe("resolveReconciliation", () => {
  it("applies the chosen candidate's value with the chosen candidate's own provenance", () => {
    const pending: PendingReconciliation[] = [
      {
        modelPath: "income.interestAccounts[0].grossInterest",
        candidates: [
          candidate({
            docId: "prefill-doc",
            documentType: "ato-prefill-report",
            value: 400,
            page: 2,
            snippet: "pre-fill: 400.00",
          }),
          candidate({
            docId: "bank-notice-doc",
            documentType: "bank-interest-notice",
            value: 420,
            page: 1,
            snippet: "bank notice: 420.00",
          }),
        ],
      },
    ];

    const { model, unresolved } = resolveReconciliation(createEmptyReturnModel(), pending, [
      { modelPath: "income.interestAccounts[0].grossInterest", chosenIndex: 1 },
    ]);

    const field = model.income.interestAccounts[0]?.grossInterest;
    expect(field?.value).toBe(420);
    expect(field?.origin).toMatchObject({
      kind: "document",
      docId: "bank-notice-doc",
      page: 1,
      snippet: "bank notice: 420.00",
      confidence: "high",
    });
    expect(unresolved).toEqual([]);
  });

  it("leaves an entry with no matching choice in unresolved and the model untouched at that path", () => {
    const pending: PendingReconciliation[] = [
      {
        modelPath: "income.interestAccounts[0].grossInterest",
        candidates: [
          candidate({ docId: "prefill-doc", documentType: "ato-prefill-report", value: 400 }),
          candidate({ docId: "bank-notice-doc", value: 420 }),
        ],
      },
    ];

    const before = createEmptyReturnModel();
    const { model, unresolved } = resolveReconciliation(before, pending, []);

    expect(unresolved).toEqual(pending);
    // Nothing was applied at the unmatched path — the model comes back unchanged.
    expect(model).toEqual(before);
  });

  it("does not mark the resolved field confirmed — it stays proposed for the review step (FR-7)", () => {
    const pending: PendingReconciliation[] = [
      {
        modelPath: "income.interestAccounts[0].grossInterest",
        candidates: [
          candidate({ docId: "prefill-doc", documentType: "ato-prefill-report", value: 400 }),
          candidate({ docId: "bank-notice-doc", value: 420 }),
        ],
      },
    ];

    const { model } = resolveReconciliation(createEmptyReturnModel(), pending, [
      { modelPath: "income.interestAccounts[0].grossInterest", chosenIndex: 0 },
    ]);

    expect(model.income.interestAccounts[0]?.grossInterest.status).toBe("proposed");
  });

  it("only resolves entries with a matching choice, leaving the rest unresolved", () => {
    const pending: PendingReconciliation[] = [
      {
        modelPath: "income.interestAccounts[0].grossInterest",
        candidates: [candidate({ value: 400 }), candidate({ docId: "doc-2", value: 420 })],
      },
      {
        modelPath: "income.dividends[0].franked",
        candidates: [candidate({ value: 100 }), candidate({ docId: "doc-2", value: 110 })],
      },
    ];

    const { unresolved } = resolveReconciliation(createEmptyReturnModel(), pending, [
      { modelPath: "income.interestAccounts[0].grossInterest", chosenIndex: 0 },
    ]);

    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]?.modelPath).toBe("income.dividends[0].franked");
  });

  it("throws for a chosenIndex out of range", () => {
    const pending: PendingReconciliation[] = [
      {
        modelPath: "income.interestAccounts[0].grossInterest",
        candidates: [candidate({ value: 400 })],
      },
    ];

    expect(() =>
      resolveReconciliation(createEmptyReturnModel(), pending, [
        { modelPath: "income.interestAccounts[0].grossInterest", chosenIndex: 5 },
      ]),
    ).toThrow(/chosenIndex/);
  });
});

describe("suggestDefaultChoice", () => {
  it("prefers the pre-fill-report candidate when present, regardless of confidence", () => {
    const pending: PendingReconciliation = {
      modelPath: "income.interestAccounts[0].grossInterest",
      candidates: [
        candidate({
          docId: "bank-notice-doc",
          documentType: "bank-interest-notice",
          confidence: "high",
          value: 420,
        }),
        candidate({
          docId: "prefill-doc",
          documentType: "ato-prefill-report",
          confidence: "low",
          value: 400,
        }),
      ],
    };

    expect(suggestDefaultChoice(pending)).toEqual({
      modelPath: "income.interestAccounts[0].grossInterest",
      chosenIndex: 1,
    });
  });

  it("falls back to the highest-confidence candidate when no pre-fill report is present", () => {
    const pending: PendingReconciliation = {
      modelPath: "income.interestAccounts[0].grossInterest",
      candidates: [
        candidate({
          docId: "doc-a",
          documentType: "bank-interest-notice",
          confidence: "medium",
          value: 420,
        }),
        candidate({
          docId: "doc-b",
          documentType: "income-statement",
          confidence: "high",
          value: 400,
        }),
      ],
    };

    expect(suggestDefaultChoice(pending)).toEqual({
      modelPath: "income.interestAccounts[0].grossInterest",
      chosenIndex: 1,
    });
  });
});

describe("hasUnresolvedMismatches", () => {
  it("is false for an empty list and true otherwise", () => {
    expect(hasUnresolvedMismatches([])).toBe(false);
    expect(
      hasUnresolvedMismatches([
        { modelPath: "income.interestAccounts[0].grossInterest", candidates: [candidate()] },
      ]),
    ).toBe(true);
  });
});
