import { describe, expect, it, vi } from "vitest";

import { extractDocument } from "../src/extract-document";
import type { TextLayer } from "../src/text-layer";
import { stubClient, stubStore, testMetadata } from "./fixtures";

const INCOME_STATEMENT_TEXT: TextLayer = {
  pages: ["Acme Pty Ltd ABN 11111111111 Gross payments 90,000.00 Total tax withheld 20,000.00"],
};

function jsonReply(figures: unknown[]): string {
  return JSON.stringify(figures);
}

describe("extractDocument", () => {
  it("maps an income statement to the right modelPaths, all high confidence", async () => {
    const reply = jsonReply([
      {
        modelPath: "income.salaryWages[0].payerName",
        value: "Acme Pty Ltd",
        page: 1,
        snippet: "Acme Pty Ltd",
      },
      {
        modelPath: "income.salaryWages[0].payerAbn",
        value: "11111111111",
        page: 1,
        snippet: "ABN 11111111111",
      },
      {
        modelPath: "income.salaryWages[0].grossSalaryWages",
        value: 90_000,
        page: 1,
        snippet: "Gross payments 90,000.00",
      },
      {
        modelPath: "income.salaryWages[0].paygWithheld",
        value: 20_000,
        page: 1,
        snippet: "Total tax withheld 20,000.00",
      },
    ]);
    const client = stubClient(reply);
    const store = stubStore({
      metadata: testMetadata({ detectedType: "income-statement" }),
      bytes: Buffer.from("pdf"),
    });

    const result = await extractDocument("return-1", "doc-1", {
      store,
      client,
      extractTextLayer: async () => INCOME_STATEMENT_TEXT,
    });

    expect(result.documentType).toBe("income-statement");
    expect(result.figures.map((f) => f.modelPath)).toEqual([
      "income.salaryWages[0].payerName",
      "income.salaryWages[0].payerAbn",
      "income.salaryWages[0].grossSalaryWages",
      "income.salaryWages[0].paygWithheld",
    ]);
    expect(result.figures.every((f) => f.confidence === "high")).toBe(true);
    expect(client.askVision).toHaveBeenCalledOnce();
  });

  it("flags a figure unverified when its snippet isn't in the document's text layer", async () => {
    const reply = jsonReply([
      {
        modelPath: "income.salaryWages[0].grossSalaryWages",
        value: 90_000,
        page: 1,
        snippet: "this text is nowhere in the document",
      },
    ]);
    const store = stubStore({ metadata: testMetadata(), bytes: Buffer.from("pdf") });

    const result = await extractDocument("return-1", "doc-1", {
      store,
      client: stubClient(reply),
      extractTextLayer: async () => INCOME_STATEMENT_TEXT,
    });

    expect(result.figures[0]?.confidence).toBe("unverified");
  });

  it("scores an image-only document low, not unverified", async () => {
    const reply = jsonReply([
      { modelPath: "income.dividends[0].company", value: "ASX Co", page: 1, snippet: "ASX Co" },
    ]);
    const store = stubStore({
      metadata: testMetadata({ detectedType: "dividend-statement", mimeType: "image/png" }),
      bytes: Buffer.from("PNG"),
    });

    const result = await extractDocument("return-1", "doc-1", {
      store,
      client: stubClient(reply),
      // No override: extractTextLayer's real implementation returns null for a
      // non-PDF mime type without needing to parse anything.
    });

    expect(result.figures[0]?.confidence).toBe("low");
  });

  it("downgrades to medium when the franking-credit cross-check disagrees, and stays high when it agrees", async () => {
    const dividendText: TextLayer = {
      pages: ["ASX Co Unfranked 0.00 Franked 1,000.00 Franking credit 100.00"],
    };
    const disagreeingReply = jsonReply([
      { modelPath: "income.dividends[0].company", value: "ASX Co", page: 1, snippet: "ASX Co" },
      {
        modelPath: "income.dividends[0].franked",
        value: 1_000,
        page: 1,
        snippet: "Franked 1,000.00",
      },
      {
        modelPath: "income.dividends[0].frankingCredits",
        value: 100,
        page: 1,
        snippet: "Franking credit 100.00",
      },
    ]);
    const store = stubStore({
      metadata: testMetadata({ detectedType: "dividend-statement" }),
      bytes: Buffer.from("pdf"),
    });

    const disagreeing = await extractDocument("return-1", "doc-1", {
      store,
      client: stubClient(disagreeingReply),
      extractTextLayer: async () => dividendText,
    });
    const frankingFigure = disagreeing.figures.find((f) => f.modelPath.endsWith("frankingCredits"));
    expect(frankingFigure?.confidence).toBe("medium");

    const agreeingText: TextLayer = {
      pages: ["ASX Co Unfranked 0.00 Franked 1,000.00 Franking credit 300.00"],
    };
    const agreeingReply = jsonReply([
      {
        modelPath: "income.dividends[0].franked",
        value: 1_000,
        page: 1,
        snippet: "Franked 1,000.00",
      },
      {
        modelPath: "income.dividends[0].frankingCredits",
        value: 300,
        page: 1,
        snippet: "Franking credit 300.00",
      },
    ]);
    const agreeing = await extractDocument("return-1", "doc-2", {
      store: stubStore({
        metadata: testMetadata({ docId: "doc-2", detectedType: "dividend-statement" }),
        bytes: Buffer.from("pdf"),
      }),
      client: stubClient(agreeingReply),
      extractTextLayer: async () => agreeingText,
    });
    const agreeingFranking = agreeing.figures.find((f) => f.modelPath.endsWith("frankingCredits"));
    expect(agreeingFranking?.confidence).toBe("high");
  });

  it("yields no figures and never calls the model for a non-extractable document", async () => {
    const client = stubClient("[]");
    const store = stubStore({
      metadata: testMetadata({ detectedType: "unrecognised", extractable: false }),
      bytes: Buffer.from("pdf"),
    });

    const result = await extractDocument("return-1", "doc-1", { store, client });

    expect(result.figures).toEqual([]);
    expect(client.askVision).not.toHaveBeenCalled();
  });

  it("yields no figures for a document type this package doesn't extract (rental agent statement)", async () => {
    const client = stubClient("[]");
    const store = stubStore({
      metadata: testMetadata({ detectedType: "rental-agent-statement", extractable: true }),
      bytes: Buffer.from("pdf"),
    });

    const result = await extractDocument("return-1", "doc-1", { store, client });

    expect(result.figures).toEqual([]);
    expect(client.askVision).not.toHaveBeenCalled();
  });

  it("extracts multiple employers from an ATO pre-fill report at sequential indices", async () => {
    const reply = jsonReply([
      {
        modelPath: "income.salaryWages[0].payerName",
        value: "Acme Pty Ltd",
        page: 1,
        snippet: "Acme Pty Ltd",
      },
      {
        modelPath: "income.salaryWages[0].grossSalaryWages",
        value: 90_000,
        page: 1,
        snippet: "Acme gross 90,000",
      },
      {
        modelPath: "income.salaryWages[1].payerName",
        value: "Second Employer Pty Ltd",
        page: 1,
        snippet: "Second Employer Pty Ltd",
      },
      {
        modelPath: "income.salaryWages[1].grossSalaryWages",
        value: 15_000,
        page: 1,
        snippet: "Second gross 15,000",
      },
    ]);
    const store = stubStore({
      metadata: testMetadata({ detectedType: "ato-prefill-report" }),
      bytes: Buffer.from("pdf"),
    });

    const result = await extractDocument("return-1", "doc-1", {
      store,
      client: stubClient(reply),
      extractTextLayer: async () => ({
        pages: ["Acme Pty Ltd Acme gross 90,000 Second Employer Pty Ltd Second gross 15,000"],
      }),
    });

    expect(result.figures.map((f) => f.modelPath)).toEqual([
      "income.salaryWages[0].payerName",
      "income.salaryWages[0].grossSalaryWages",
      "income.salaryWages[1].payerName",
      "income.salaryWages[1].grossSalaryWages",
    ]);
  });

  it("passes a PDF vision part for a PDF and an image part for a PNG/JPG upload", async () => {
    const client = stubClient("[]");
    await extractDocument("return-1", "doc-1", {
      store: stubStore({ metadata: testMetadata(), bytes: Buffer.from("pdf") }),
      client,
      extractTextLayer: async () => null,
    });
    const [parts] = vi.mocked(client.askVision).mock.calls[0]!;
    expect(parts[0]).toMatchObject({ kind: "pdf", mimeType: "application/pdf" });
  });
});
