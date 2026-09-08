/**
 * Document fixtures for the v2 conversation integration suite (T12).
 *
 * Each fixture is a REAL PDF (built by {@link textPdf}) whose text layer carries
 * every snippet the scripted extraction reply quotes — so `extractTextLayer`
 * (unpdf) locates them and confidence lands `high`, never `unverified`.
 *
 * `wire(script)` registers the scripted-Claude matchers this document needs:
 * its classification identifier, and (for the generic income/deduction
 * documents) its figure-extraction reply.
 */
import type { ClaudeScript } from "../harness";
import { textPdf } from "../harness";

// ---------------------------------------------------------------------------
// Matcher predicates keyed to the real prompt text
// ---------------------------------------------------------------------------

const isClassifyPrompt = (p: string, o?: { system?: string }) =>
  (o?.system ?? "").includes("document-classification step") &&
  p.includes("Reply with exactly one of these identifiers");
const isExtractionPrompt = (p: string, o?: { system?: string }) =>
  (o?.system ?? "").includes("figure-extraction step");
/** The three rental-parse prompts all use a "financial-figure extraction step" system prompt. */
const isRentalParsePrompt = (o?: { system?: string }) =>
  (o?.system ?? "").includes("financial-figure extraction step");

// ---------------------------------------------------------------------------
// ATO pre-fill report (the spine of the return — PRD FR-2)
// ---------------------------------------------------------------------------

export interface PrefillOptions {
  readonly grossSalary: number;
  readonly paygWithheld: number;
  /** Gross bank interest on the one CommBank account. */
  readonly grossInterest?: number;
  /** Franked dividend amount + its franking credit on the one ASX Co holding. */
  readonly frankedDividend?: number;
  readonly frankingCredit?: number;
}

export interface DocFixture {
  readonly filename: string;
  readonly bytes: Buffer;
  wire(script: ClaudeScript): void;
}

function prefillFigures(o: PrefillOptions) {
  const interest = o.grossInterest ?? 800;
  const franked = o.frankedDividend ?? 700;
  const credit = o.frankingCredit ?? 300;
  return [
    {
      modelPath: "income.salaryWages[0].payerName",
      value: "Acme Pty Ltd",
      page: 1,
      snippet: "Employer: Acme Pty Ltd",
    },
    {
      modelPath: "income.salaryWages[0].payerAbn",
      value: "11111111111",
      page: 1,
      snippet: "ABN 11111111111",
    },
    {
      modelPath: "income.salaryWages[0].grossSalaryWages",
      value: o.grossSalary,
      page: 1,
      snippet: `Gross payments $${o.grossSalary}.00`,
    },
    {
      modelPath: "income.salaryWages[0].paygWithheld",
      value: o.paygWithheld,
      page: 1,
      snippet: `Total tax withheld $${o.paygWithheld}.00`,
    },
    {
      modelPath: "income.interestAccounts[0].institution",
      value: "CommBank",
      page: 1,
      snippet: "Institution: CommBank",
    },
    {
      modelPath: "income.interestAccounts[0].accountDescription",
      value: "NetBank Saver",
      page: 1,
      snippet: "Account NetBank Saver 12345678",
    },
    {
      modelPath: "income.interestAccounts[0].grossInterest",
      value: interest,
      page: 1,
      snippet: `Gross interest paid $${interest}.00`,
    },
    {
      modelPath: "income.interestAccounts[0].tfnAmountsWithheld",
      value: 0,
      page: 1,
      snippet: "TFN amounts withheld from interest $0.00",
    },
    {
      modelPath: "income.dividends[0].company",
      value: "ASX Co Ltd",
      page: 1,
      snippet: "Company ASX Co Ltd",
    },
    {
      modelPath: "income.dividends[0].unfranked",
      value: 0,
      page: 1,
      snippet: "Unfranked amount $0.00",
    },
    {
      modelPath: "income.dividends[0].franked",
      value: franked,
      page: 1,
      snippet: `Franked amount $${franked}.00`,
    },
    {
      modelPath: "income.dividends[0].frankingCredits",
      value: credit,
      page: 1,
      snippet: `Franking credit $${credit}.00`,
    },
    {
      modelPath: "income.dividends[0].tfnAmountsWithheld",
      value: 0,
      page: 1,
      snippet: "TFN amounts withheld from dividends $0.00",
    },
  ];
}

export async function prefillFixture(o: PrefillOptions): Promise<DocFixture> {
  const figures = prefillFigures(o);
  const filename = "ato-prefill-report.pdf";
  const bytes = await textPdf(["ATO pre-fill report 2025-26", ...figures.map((f) => f.snippet)]);
  return {
    filename,
    bytes,
    wire(script) {
      script.onVision(
        `classify:${filename}`,
        (p, o) => isClassifyPrompt(p, o) && p.includes(filename),
        "ato-prefill-report",
      );
      script.onVision(
        `extract:${filename}`,
        (p, opt) => isExtractionPrompt(p, opt) && p.includes(filename),
        JSON.stringify(figures),
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Rental source documents (PRD FR-24) — parsed by @aus-tax-lodge/model
// ---------------------------------------------------------------------------

export interface RentalFixtureOptions {
  readonly grossRent: number;
  readonly agentFees: number;
  readonly councilRates: number;
  readonly waterCharges: number;
  readonly repairs: number;
  readonly loanInterest: number;
  readonly capitalWorks: number;
  readonly declineInValue: number;
}

export async function rentalAgentStatementFixture(o: RentalFixtureOptions): Promise<DocFixture> {
  const filename = "rental-agent-statement.pdf";
  const reply = JSON.stringify({
    grossRent: {
      amount: o.grossRent,
      page: 1,
      snippet: `Rent collected for the year ${o.grossRent}.00`,
    },
    otherRentalIncome: null,
    expenses: [
      {
        key: "agentFees",
        amount: o.agentFees,
        page: 1,
        snippet: `Management fee ${o.agentFees}.00`,
        description: "Management fee",
      },
      {
        key: "councilRates",
        amount: o.councilRates,
        page: 1,
        snippet: `Council rates ${o.councilRates}.00`,
        description: "Council rates",
      },
      {
        key: "repairsAndMaintenance",
        amount: o.repairs,
        page: 1,
        snippet: `Plumbing repair ${o.repairs}.00`,
        description: "Repairs",
      },
      {
        key: "waterCharges",
        amount: o.waterCharges,
        page: 1,
        snippet: `Water usage ${o.waterCharges}.00`,
        description: "Water",
      },
    ],
  });
  const bytes = await textPdf([
    "Managing agent annual statement 2025-26",
    `Rent collected for the year ${o.grossRent}.00`,
    `Management fee ${o.agentFees}.00`,
    `Council rates ${o.councilRates}.00`,
    `Plumbing repair ${o.repairs}.00`,
    `Water usage ${o.waterCharges}.00`,
  ]);
  return {
    filename,
    bytes,
    wire(script) {
      script.onVision(
        `classify:${filename}`,
        (p, o) => isClassifyPrompt(p, o) && p.includes(filename),
        "rental-agent-statement",
      );
      script.onVision(
        "rental:agent-statement",
        (p, o) =>
          isRentalParsePrompt(o) && p.includes("real-estate managing agent's annual statement"),
        reply,
      );
    },
  };
}

export async function loanInterestSummaryFixture(o: RentalFixtureOptions): Promise<DocFixture> {
  const filename = "loan-interest-summary.pdf";
  const reply = JSON.stringify({
    interestOnLoans: {
      amount: o.loanInterest,
      page: 1,
      snippet: `Total interest charged ${o.loanInterest}.00`,
    },
    borrowingExpenses: null,
  });
  const bytes = await textPdf([
    "Lender annual interest summary 2025-26",
    `Total interest charged ${o.loanInterest}.00`,
  ]);
  return {
    filename,
    bytes,
    wire(script) {
      script.onVision(
        `classify:${filename}`,
        (p, o) => isClassifyPrompt(p, o) && p.includes(filename),
        "loan-interest-summary",
      );
      script.onVision(
        "rental:loan-summary",
        (p, o) => isRentalParsePrompt(o) && p.includes("lender's annual interest summary"),
        reply,
      );
    },
  };
}

export async function qsScheduleFixture(o: RentalFixtureOptions): Promise<DocFixture> {
  const filename = "qs-depreciation-schedule.pdf";
  const reply = JSON.stringify({
    capitalWorks: {
      amount: o.capitalWorks,
      page: 1,
      snippet: `Division 43 capital works 2025-26 ${o.capitalWorks}.00`,
    },
    declineInValue: {
      amount: o.declineInValue,
      page: 1,
      snippet: `Division 40 decline in value 2025-26 ${o.declineInValue}.00`,
    },
  });
  const bytes = await textPdf([
    "Quantity surveyor tax depreciation schedule",
    `Division 43 capital works 2025-26 ${o.capitalWorks}.00`,
    `Division 40 decline in value 2025-26 ${o.declineInValue}.00`,
  ]);
  return {
    filename,
    bytes,
    wire(script) {
      script.onVision(
        `classify:${filename}`,
        (p, o) => isClassifyPrompt(p, o) && p.includes(filename),
        "qs-depreciation-schedule",
      );
      script.onVision(
        "rental:qs-schedule",
        (p, o) =>
          isRentalParsePrompt(o) && p.includes("quantity surveyor's tax depreciation schedule"),
        reply,
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Out-of-scope: a managed-fund / trust distribution statement (PRD FR-20)
// ---------------------------------------------------------------------------

/**
 * A document that classifies as a `dividend-statement` but whose CONTENT is a
 * trust / managed-fund distribution — caught by the scope content check
 * (`checkDocumentForOutOfScopeContent`), not by classification.
 */
export async function trustDistributionFixture(): Promise<DocFixture> {
  const filename = "managed-fund-annual-tax-statement.pdf";
  const bytes = await textPdf([
    "ACME Diversified Fund - Annual tax statement 2025-26",
    "Net cash distribution 4,200.00",
    "Franked distribution 1,500.00  Foreign income 300.00",
    "Net capital gains 900.00  AMIT cost base net amount 120.00",
  ]);
  return {
    filename,
    bytes,
    wire(script) {
      // Classifier: looks like a dividend statement.
      script.onVision(
        `classify:${filename}`,
        (p, o) => isClassifyPrompt(p, o) && p.includes(filename),
        "dividend-statement",
      );
      // Generic dividend extraction: pull nothing usable (the figures must NOT
      // be applied — the scope stop happens regardless).
      script.onVision(
        `extract:${filename}`,
        (p, opt) => isExtractionPrompt(p, opt) && p.includes(filename),
        "[]",
      );
      // Scope content check: flag the trust-distribution category → hard stop.
      script.onVision(
        "scope-content:trust",
        (p) => p.includes("Does this document contain, report or evidence ANY of the following"),
        JSON.stringify(["trust-partnership-managed-fund-distribution"]),
      );
    },
  };
}
