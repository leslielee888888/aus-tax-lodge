import { describe, expect, it } from "vitest";

import { parseExtractedFigures } from "../src/parse";
import { EXTRACTABLE_DOCUMENT_PROMPTS } from "../src/prompts";

const INCOME_STATEMENT_PROMPT = EXTRACTABLE_DOCUMENT_PROMPTS["income-statement"]!;
const DIVIDEND_PROMPT = EXTRACTABLE_DOCUMENT_PROMPTS["dividend-statement"]!;

describe("extraction system prompt", () => {
  it("tells the model this step does not give tax advice (FR-19)", () => {
    expect(INCOME_STATEMENT_PROMPT.system).toContain("does not give tax advice");
    expect(DIVIDEND_PROMPT.system).toContain("does not give tax advice");
  });
});

describe("parseExtractedFigures", () => {
  it("parses a clean JSON array", () => {
    const reply = JSON.stringify([
      {
        modelPath: "income.salaryWages[0].grossSalaryWages",
        value: 90_000,
        page: 1,
        snippet: "Gross payments 90,000.00",
      },
    ]);
    const figures = parseExtractedFigures(reply, INCOME_STATEMENT_PROMPT);
    expect(figures).toEqual([
      {
        modelPath: "income.salaryWages[0].grossSalaryWages",
        value: 90_000,
        page: 1,
        snippet: "Gross payments 90,000.00",
      },
    ]);
  });

  it("tolerates surrounding prose and code fences", () => {
    const reply = `Here you go:\n\`\`\`json\n${JSON.stringify([
      {
        modelPath: "income.salaryWages[0].payerName",
        value: "Acme Pty Ltd",
        page: 1,
        snippet: "Acme Pty Ltd",
      },
    ])}\n\`\`\``;
    const figures = parseExtractedFigures(reply, INCOME_STATEMENT_PROMPT);
    expect(figures).toHaveLength(1);
    expect(figures[0]?.value).toBe("Acme Pty Ltd");
  });

  it("coerces a numeric string with currency formatting", () => {
    const reply = JSON.stringify([
      {
        modelPath: "income.salaryWages[0].grossSalaryWages",
        value: "$90,000.00",
        page: 1,
        snippet: "x",
      },
    ]);
    expect(parseExtractedFigures(reply, INCOME_STATEMENT_PROMPT)[0]?.value).toBe(90_000);
  });

  it("drops an entry with a modelPath outside this document type's scope", () => {
    const reply = JSON.stringify([
      { modelPath: "privateHealth.premiumsEligibleForRebate", value: 1_800, page: 1, snippet: "x" },
    ]);
    expect(parseExtractedFigures(reply, INCOME_STATEMENT_PROMPT)).toEqual([]);
  });

  it("drops an entry with an unknown modelPath entirely", () => {
    const reply = JSON.stringify([
      { modelPath: "not.a.real.path", value: 1, page: 1, snippet: "x" },
    ]);
    expect(parseExtractedFigures(reply, INCOME_STATEMENT_PROMPT)).toEqual([]);
  });

  it("drops an entry whose value doesn't coerce to the expected type", () => {
    const reply = JSON.stringify([
      {
        modelPath: "income.salaryWages[0].grossSalaryWages",
        value: "not a number",
        page: 1,
        snippet: "x",
      },
    ]);
    expect(parseExtractedFigures(reply, INCOME_STATEMENT_PROMPT)).toEqual([]);
  });

  it("drops an entry missing a usable page or snippet", () => {
    const reply = JSON.stringify([
      { modelPath: "income.dividends[0].company", value: "ASX Co", page: 0, snippet: "ASX Co" },
      { modelPath: "income.dividends[0].franked", value: 700, page: 1, snippet: "" },
    ]);
    expect(parseExtractedFigures(reply, DIVIDEND_PROMPT)).toEqual([]);
  });

  it("returns an empty array for [] and for unparsable replies", () => {
    expect(parseExtractedFigures("[]", INCOME_STATEMENT_PROMPT)).toEqual([]);
    expect(parseExtractedFigures("not json at all", INCOME_STATEMENT_PROMPT)).toEqual([]);
    expect(parseExtractedFigures('{"not": "an array"}', INCOME_STATEMENT_PROMPT)).toEqual([]);
  });

  it("keeps a valid rawConfidenceHint but never lets it stand in for confidence", () => {
    const reply = JSON.stringify([
      {
        modelPath: "income.salaryWages[0].grossSalaryWages",
        value: 90_000,
        page: 1,
        snippet: "x",
        rawConfidenceHint: "the print is a bit blurry here",
      },
    ]);
    const [figure] = parseExtractedFigures(reply, INCOME_STATEMENT_PROMPT);
    expect(figure?.rawConfidenceHint).toBe("the print is a bit blurry here");
    expect(figure).not.toHaveProperty("confidence");
  });
});
