import { createEmptyReturnModel } from "@aus-tax-lodge/model";
import { describe, expect, it } from "vitest";

import { applyExtractions } from "../src/apply";
import type { DocumentExtractionResult } from "../src/types";

function figure(modelPath: string, value: number | string, page = 1, snippet = "x") {
  return { modelPath, value, page, snippet, confidence: "high" as const };
}

describe("applyExtractions", () => {
  it("proposes every figure — never confirmed", () => {
    const extractions: DocumentExtractionResult[] = [
      {
        docId: "doc-1",
        documentType: "income-statement",
        figures: [figure("income.salaryWages[0].grossSalaryWages", 90_000)],
      },
    ];
    const { model } = applyExtractions(createEmptyReturnModel(), extractions);
    expect(model.income.salaryWages[0]?.grossSalaryWages).toMatchObject({
      value: 90_000,
      status: "proposed",
    });
  });

  it("applies the pre-fill report's figures first, even when it's later in the input array", () => {
    const extractions: DocumentExtractionResult[] = [
      {
        docId: "income-statement-doc",
        documentType: "income-statement",
        figures: [figure("income.interestAccounts[0].grossInterest", 999, 1, "wrong source order")],
      },
      {
        docId: "prefill-doc",
        documentType: "ato-prefill-report",
        figures: [figure("income.interestAccounts[0].grossInterest", 400, 1, "pre-fill value")],
      },
    ];
    const { model, pendingReconciliation } = applyExtractions(
      createEmptyReturnModel(),
      extractions,
    );

    // The pre-fill report seeds the field even though it's second in the input array (FR-2).
    expect(model.income.interestAccounts[0]?.grossInterest.value).toBe(400);
    expect(model.income.interestAccounts[0]?.grossInterest.origin).toMatchObject({
      docId: "prefill-doc",
    });
    expect(pendingReconciliation).toHaveLength(1);
    expect(pendingReconciliation[0]?.modelPath).toBe("income.interestAccounts[0].grossInterest");
  });

  it("surfaces both candidates in pendingReconciliation when two documents disagree, without picking a winner", () => {
    const extractions: DocumentExtractionResult[] = [
      {
        docId: "prefill-doc",
        documentType: "ato-prefill-report",
        figures: [figure("income.interestAccounts[0].grossInterest", 400, 2, "pre-fill: 400.00")],
      },
      {
        docId: "bank-notice-doc",
        documentType: "bank-interest-notice",
        figures: [
          figure("income.interestAccounts[0].grossInterest", 420, 1, "bank notice: 420.00"),
        ],
      },
    ];
    const { model, pendingReconciliation } = applyExtractions(
      createEmptyReturnModel(),
      extractions,
    );

    // The field keeps the first (pre-fill) value — never auto-resolved to the bank notice's.
    expect(model.income.interestAccounts[0]?.grossInterest.value).toBe(400);
    expect(pendingReconciliation).toEqual([
      {
        modelPath: "income.interestAccounts[0].grossInterest",
        candidates: [
          {
            docId: "prefill-doc",
            page: 2,
            snippet: "pre-fill: 400.00",
            confidence: "high",
            value: 400,
          },
          {
            docId: "bank-notice-doc",
            page: 1,
            snippet: "bank notice: 420.00",
            confidence: "high",
            value: 420,
          },
        ],
      },
    ]);
  });

  it("does not flag agreement between sources as a reconciliation conflict", () => {
    const extractions: DocumentExtractionResult[] = [
      {
        docId: "prefill-doc",
        documentType: "ato-prefill-report",
        figures: [figure("income.interestAccounts[0].grossInterest", 400)],
      },
      {
        docId: "bank-notice-doc",
        documentType: "bank-interest-notice",
        figures: [figure("income.interestAccounts[0].grossInterest", 400.001)], // cent-level rounding
      },
    ];
    const { pendingReconciliation } = applyExtractions(createEmptyReturnModel(), extractions);
    expect(pendingReconciliation).toEqual([]);
  });

  it("seeds every income label the pre-fill report carries before other documents reconcile against it (FR-2)", () => {
    const extractions: DocumentExtractionResult[] = [
      {
        docId: "prefill-doc",
        documentType: "ato-prefill-report",
        figures: [
          figure("income.salaryWages[0].payerName", "Acme Pty Ltd"),
          figure("income.salaryWages[0].grossSalaryWages", 90_000),
          figure("income.dividends[0].company", "ASX Co"),
        ],
      },
    ];
    const { model } = applyExtractions(createEmptyReturnModel(), extractions);
    expect(model.income.salaryWages[0]?.payerName.value).toBe("Acme Pty Ltd");
    expect(model.income.salaryWages[0]?.grossSalaryWages.value).toBe(90_000);
    expect(model.income.dividends[0]?.company.value).toBe("ASX Co");
  });
});
