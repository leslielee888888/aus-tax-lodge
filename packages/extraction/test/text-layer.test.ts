import { describe, expect, it } from "vitest";

import { extractTextLayer, locateSnippet, type TextLayer } from "../src/text-layer";
import { buildMinimalPdf } from "./pdf-fixture";

describe("extractTextLayer", () => {
  it("returns null for an image mime type without touching the PDF parser", async () => {
    await expect(extractTextLayer(Buffer.from("PNG"), "image/png")).resolves.toBeNull();
    await expect(extractTextLayer(Buffer.from("JPG"), "image/jpeg")).resolves.toBeNull();
  });

  it("reads real text out of a digital-native PDF", async () => {
    const pdf = buildMinimalPdf("Gross interest 123.45 credited");
    const textLayer = await extractTextLayer(pdf, "application/pdf");
    expect(textLayer).not.toBeNull();
    expect(textLayer?.pages[0]).toContain("Gross interest 123.45 credited");
  });

  it("returns null for a PDF with no meaningful extractable text (scanned/rasterised)", async () => {
    const blankPdf = buildMinimalPdf("");
    const textLayer = await extractTextLayer(blankPdf, "application/pdf");
    expect(textLayer).toBeNull();
  });

  it("returns null rather than throwing for an unparsable PDF", async () => {
    await expect(extractTextLayer(Buffer.from("not a pdf"), "application/pdf")).resolves.toBeNull();
  });
});

describe("locateSnippet", () => {
  const textLayer: TextLayer = { pages: ["Gross interest: $400.00 credited to your account."] };

  it("finds an exact substring", () => {
    expect(locateSnippet("Gross interest: $400.00", textLayer)).toBe(true);
  });

  it("tolerates whitespace and case differences", () => {
    expect(locateSnippet("gross   interest:  $400.00", textLayer)).toBe(true);
  });

  it("tolerates punctuation/currency-symbol differences", () => {
    expect(locateSnippet("Gross interest 400.00", textLayer)).toBe(true);
  });

  it("returns false for text that isn't on the page", () => {
    expect(locateSnippet("Franking credit $999.99", textLayer)).toBe(false);
  });

  it("returns false for an empty snippet", () => {
    expect(locateSnippet("   ", textLayer)).toBe(false);
  });
});
