import { describe, expect, it } from "vitest";

import { assignConfidence, frankingCreditCrossCheck } from "../src/confidence";
import type { TextLayer } from "../src/text-layer";

const TEXT_LAYER: TextLayer = { pages: ["Gross interest 400.00 credited to your account"] };

describe("assignConfidence", () => {
  it("is low when the format/range check fails, even with a locatable snippet", () => {
    const confidence = assignConfidence(
      {
        modelPath: "income.interestAccounts[0].grossInterest",
        value: -5,
        snippet: "Gross interest 400.00",
      },
      { textLayer: TEXT_LAYER },
    );
    expect(confidence).toBe("low");
  });

  it("is low for an image-only document (no text layer to check against)", () => {
    const confidence = assignConfidence(
      {
        modelPath: "income.interestAccounts[0].grossInterest",
        value: 400,
        snippet: "Gross interest 400.00",
      },
      { textLayer: null },
    );
    expect(confidence).toBe("low");
  });

  it("is unverified when the document has a text layer but the snippet can't be found in it", () => {
    const confidence = assignConfidence(
      {
        modelPath: "income.interestAccounts[0].grossInterest",
        value: 400,
        snippet: "totally different text",
      },
      { textLayer: TEXT_LAYER },
    );
    expect(confidence).toBe("unverified");
  });

  it("is high when format-valid and the snippet is located in the text layer", () => {
    const confidence = assignConfidence(
      {
        modelPath: "income.interestAccounts[0].grossInterest",
        value: 400,
        snippet: "Gross interest 400.00",
      },
      { textLayer: TEXT_LAYER },
    );
    expect(confidence).toBe("high");
  });

  it("stays high when a cross-check agrees on top of a located snippet", () => {
    const confidence = assignConfidence(
      {
        modelPath: "income.dividends[0].frankingCredits",
        value: 300,
        snippet: "Gross interest 400.00",
      },
      { textLayer: TEXT_LAYER },
      "agrees",
    );
    expect(confidence).toBe("high");
  });

  it("is medium when located but an available cross-check disagrees", () => {
    const confidence = assignConfidence(
      {
        modelPath: "income.dividends[0].frankingCredits",
        value: 999,
        snippet: "Gross interest 400.00",
      },
      { textLayer: TEXT_LAYER },
      "disagrees",
    );
    expect(confidence).toBe("medium");
  });

  it("elevates an image-only figure to high only when a cross-check agrees", () => {
    expect(
      assignConfidence(
        { modelPath: "income.dividends[0].frankingCredits", value: 300, snippet: "anything" },
        { textLayer: null },
        "agrees",
      ),
    ).toBe("high");
    expect(
      assignConfidence(
        { modelPath: "income.dividends[0].frankingCredits", value: 300, snippet: "anything" },
        { textLayer: null },
        "disagrees",
      ),
    ).toBe("low");
  });
});

describe("frankingCreditCrossCheck", () => {
  it("agrees when the franking credit is ~30% of the franked amount", () => {
    expect(frankingCreditCrossCheck(1_000, 300)).toBe("agrees");
    expect(frankingCreditCrossCheck(1_000, 305)).toBe("agrees"); // within tolerance
  });

  it("disagrees when the franking credit is far off 30% of the franked amount", () => {
    expect(frankingCreditCrossCheck(1_000, 100)).toBe("disagrees");
  });

  it("has nothing to check when there's no franked amount", () => {
    expect(frankingCreditCrossCheck(0, 0)).toBeUndefined();
  });
});
