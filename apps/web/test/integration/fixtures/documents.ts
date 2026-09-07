/**
 * Document fixtures for the T23 integration suite: small fake "PDF" byte blobs
 * plus the canned Claude replies keyed to them. The fake PDF text is built from
 * the reply's own snippets, so the extraction text-layer check always locates
 * them and confidence lands `high` (never `unverified`).
 */
import type { DocumentType } from "@aus-tax-lodge/store";

import { fakePdf, type VisionRoute } from "../harness";

export interface DocFixture {
  readonly filename: string;
  readonly detectedType: DocumentType;
  readonly mimeType: "application/pdf";
  readonly bytes: Buffer;
  /** The canned reply the mock Claude returns for this document's extraction prompt. */
  readonly reply: string;
}

/** Pull every `snippet` string out of a canned reply (array or object shape). */
function snippetsOf(reply: string): string[] {
  const out: string[] = [];
  JSON.stringify(JSON.parse(reply), (key, value) => {
    if (key === "snippet" && typeof value === "string") out.push(value);
    return value;
  });
  return out;
}

function doc(
  filename: string,
  detectedType: DocumentType,
  reply: string,
  extraText: string[] = [],
): DocFixture {
  const text = [`Document: ${filename}`, ...snippetsOf(reply), ...extraText].join("\n");
  return { filename, detectedType, mimeType: "application/pdf", bytes: fakePdf(text), reply };
}

// ---------------------------------------------------------------------------
// Income / deduction documents (shared by the no-rental and rental flows)
// ---------------------------------------------------------------------------

const PREFILL_REPLY = JSON.stringify([
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
    value: 95000,
    page: 1,
    snippet: "Gross payments $95,000.00",
  },
  {
    modelPath: "income.salaryWages[0].paygWithheld",
    value: 24000,
    page: 1,
    snippet: "Total tax withheld $24,000.00",
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
    value: 800,
    page: 1,
    snippet: "Gross interest paid $800.00",
  },
  {
    modelPath: "income.interestAccounts[0].tfnAmountsWithheld",
    value: 0,
    page: 1,
    snippet: "TFN amounts withheld $0.00 (interest)",
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
    value: 700,
    page: 1,
    snippet: "Franked amount $700.00",
  },
  {
    modelPath: "income.dividends[0].frankingCredits",
    value: 300,
    page: 1,
    snippet: "Franking credit $300.00",
  },
  {
    modelPath: "income.dividends[0].tfnAmountsWithheld",
    value: 0,
    page: 1,
    snippet: "TFN amounts withheld $0.00 (dividends)",
  },
]);

const INCOME_STATEMENT_REPLY = JSON.stringify([
  {
    modelPath: "income.salaryWages[0].payerName",
    value: "Acme Pty Ltd",
    page: 1,
    snippet: "Acme Pty Ltd income statement",
  },
  {
    modelPath: "income.salaryWages[0].payerAbn",
    value: "11111111111",
    page: 1,
    snippet: "ABN: 11111111111",
  },
  {
    modelPath: "income.salaryWages[0].grossSalaryWages",
    value: 95000,
    page: 1,
    snippet: "Gross payments 95,000.00",
  },
  {
    modelPath: "income.salaryWages[0].paygWithheld",
    value: 24000,
    page: 1,
    snippet: "PAYG withholding 24,000.00",
  },
]);

// Deliberately disagrees with the pre-fill report ($800 vs $820) to exercise
// FR-21 multi-document reconciliation.
const BANK_INTEREST_REPLY = JSON.stringify([
  {
    modelPath: "income.interestAccounts[0].institution",
    value: "CommBank",
    page: 1,
    snippet: "CommBank notice of interest",
  },
  {
    modelPath: "income.interestAccounts[0].accountDescription",
    value: "NetBank Saver",
    page: 1,
    snippet: "NetBank Saver account",
  },
  {
    modelPath: "income.interestAccounts[0].grossInterest",
    value: 820,
    page: 1,
    snippet: "Interest credited for the year 820.00",
  },
  {
    modelPath: "income.interestAccounts[0].tfnAmountsWithheld",
    value: 0,
    page: 1,
    snippet: "No TFN withholding",
  },
]);

const DIVIDEND_REPLY = JSON.stringify([
  {
    modelPath: "income.dividends[0].company",
    value: "ASX Co Ltd",
    page: 1,
    snippet: "ASX Co Ltd dividend statement",
  },
  { modelPath: "income.dividends[0].unfranked", value: 0, page: 1, snippet: "Unfranked $0.00" },
  { modelPath: "income.dividends[0].franked", value: 700, page: 1, snippet: "Franked $700.00" },
  {
    modelPath: "income.dividends[0].frankingCredits",
    value: 300,
    page: 1,
    snippet: "Franking credits $300.00",
  },
  {
    modelPath: "income.dividends[0].tfnAmountsWithheld",
    value: 0,
    page: 1,
    snippet: "TFN withheld $0.00",
  },
]);

const WORK_EXPENSE_REPLY = JSON.stringify([
  {
    modelPath: "deductions.workRelatedClothing.amount",
    value: 250,
    page: 1,
    snippet: "Hi-vis work uniform $250.00",
  },
  {
    modelPath: "deductions.workRelatedClothing.substantiationRef",
    value: "Workwear receipt #4471",
    page: 1,
    snippet: "Receipt #4471",
  },
]);

const DONATION_REPLY = JSON.stringify([
  {
    modelPath: "deductions.giftsAndDonations.amount",
    value: 500,
    page: 1,
    snippet: "Donation received: $500.00",
  },
  {
    modelPath: "deductions.giftsAndDonations.substantiationRef",
    value: "RSPCA receipt R-2025-8891",
    page: 1,
    snippet: "Receipt R-2025-8891 RSPCA (DGR)",
  },
]);

/** The six income / deduction fixture documents. */
export function incomeDocs(): DocFixture[] {
  return [
    doc("ato-prefill-report.pdf", "ato-prefill-report", PREFILL_REPLY),
    doc("income-statement.pdf", "income-statement", INCOME_STATEMENT_REPLY),
    doc("commbank-interest.pdf", "bank-interest-notice", BANK_INTEREST_REPLY),
    doc("dividend-statement.pdf", "dividend-statement", DIVIDEND_REPLY),
    doc("work-expenses.pdf", "wfh-or-expense-record", WORK_EXPENSE_REPLY),
    doc("donation-receipt.pdf", "donation-receipt", DONATION_REPLY),
  ];
}

// ---------------------------------------------------------------------------
// Rental documents (FR-24) — parsed by @aus-tax-lodge/model rental-assembly
// ---------------------------------------------------------------------------

export const RENTAL_AGENT_STATEMENT_REPLY = JSON.stringify({
  grossRent: { amount: 26000, page: 1, snippet: "Rent collected for the year 26,000.00" },
  otherRentalIncome: null,
  expenses: [
    {
      key: "agentFees",
      amount: 2080,
      page: 1,
      snippet: "Management fee 2,080.00",
      description: "Management fee",
    },
    {
      key: "councilRates",
      amount: 1400,
      page: 1,
      snippet: "Council rates 1,400.00",
      description: "Council rates",
    },
    {
      key: "repairsAndMaintenance",
      amount: 600,
      page: 1,
      snippet: "Plumbing repair 600.00",
      description: "Repairs",
    },
    {
      key: "waterCharges",
      amount: 300,
      page: 1,
      snippet: "Water usage 300.00",
      description: "Water",
    },
  ],
});

export const RENTAL_LOAN_SUMMARY_REPLY = JSON.stringify({
  interestOnLoans: { amount: 25000, page: 1, snippet: "Total interest charged 25,000.00" },
  borrowingExpenses: null,
});

export const RENTAL_QS_SCHEDULE_REPLY = JSON.stringify({
  capitalWorks: { amount: 3000, page: 1, snippet: "Division 43 capital works 2025-26 3,000.00" },
  declineInValue: {
    amount: 1200,
    page: 1,
    snippet: "Division 40 decline in value 2025-26 1,200.00",
  },
});

export interface RentalDocFixture {
  readonly filename: string;
  readonly detectedType: DocumentType;
  readonly mimeType: "application/pdf";
  readonly bytes: Buffer;
}

export function rentalDocs(): {
  agentStatement: RentalDocFixture;
  loanSummary: RentalDocFixture;
  qsSchedule: RentalDocFixture;
} {
  const mk = (filename: string, detectedType: DocumentType): RentalDocFixture => ({
    filename,
    detectedType,
    mimeType: "application/pdf",
    bytes: fakePdf(`rental document ${filename}`),
  });
  return {
    agentStatement: mk("rental-agent-statement.pdf", "rental-agent-statement"),
    loanSummary: mk("loan-interest-summary.pdf", "loan-interest-summary"),
    qsSchedule: mk("qs-depreciation-schedule.pdf", "qs-depreciation-schedule"),
  };
}

// ---------------------------------------------------------------------------
// Vision routing for the mock Claude
// ---------------------------------------------------------------------------

/** Routes for the six income / deduction documents (matched by embedded filename). */
export function incomeDocRoutes(docs: readonly DocFixture[]): VisionRoute[] {
  return docs.map((d) => ({ match: new RegExp(d.filename.replace(".", "\\.")), reply: d.reply }));
}

/** Routes for the three rental documents (matched by the rental-assembly prompt text). */
export function rentalDocRoutes(): VisionRoute[] {
  return [
    { match: /real-estate managing agent's annual statement/, reply: RENTAL_AGENT_STATEMENT_REPLY },
    { match: /lender's annual interest summary/, reply: RENTAL_LOAN_SUMMARY_REPLY },
    { match: /quantity surveyor's tax depreciation schedule/, reply: RENTAL_QS_SCHEDULE_REPLY },
  ];
}
