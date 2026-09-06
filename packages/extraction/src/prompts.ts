/**
 * One tight Claude vision prompt per extractable document type (PRD FR-3).
 * Each prompt names the exact `modelPath`s that document type may produce —
 * `pathAllowed` re-checks the model's reply against that same scope, on top
 * of the general `modelPath` vocabulary in `model-paths.ts`, so a stray
 * figure from (say) an income statement can never land on `privateHealth.*`.
 *
 * Rental agent statements and QS depreciation schedules are deliberately not
 * here — FR-24's rental extraction is a separate task.
 */
import type { DocumentType } from "@aus-tax-lodge/store";

const JSON_FORMAT_INSTRUCTION = `Reply with ONLY a JSON array and nothing else — no code fences, no commentary. Each element:
{"modelPath": "...", "value": <number or string>, "page": <1-based page number>, "snippet": "<verbatim text quoted from the document, immediately around the figure>", "rawConfidenceHint": "<optional — your own note if you're unsure, purely informational>"}

Rules:
- "modelPath" must be exactly one of the field paths listed below.
- "snippet" must be copied verbatim from the document — the exact characters, not a paraphrase or summary. It is used to verify you actually saw this figure.
- Only include a figure you can actually find on the document. Omit anything not present.
- If nothing on the document maps to any listed field, reply with [].`;

const SYSTEM_PROMPT =
  "You are a precise figure-extraction step in an Australian individual tax-return " +
  "assistant. You are shown one uploaded document. Extract only the figures listed in " +
  "the instructions, quoting each one verbatim from the document. Never invent a figure " +
  "that isn't on the document, and never compute or estimate a value that isn't printed. " +
  "This step does not give tax advice: do not recommend or comment on what the taxpayer " +
  "should claim, how to arrange their affairs, or whether a figure is favourable — only " +
  "report the figures the document prints.";

export interface DocumentPrompt {
  readonly system: string;
  buildPrompt(filename: string): string;
  /** Scopes the model's reply on top of the general `modelPath` vocabulary. */
  pathAllowed(modelPath: string): boolean;
}

const SINGLE_ENTITY_INDEX = /\[0\]/;

/** Builds an allow-list `Set` from a whitespace-separated list of `modelPath`s. */
function pathSet(list: string): ReadonlySet<string> {
  return new Set(list.trim().split(/\s+/));
}

const INCOME_STATEMENT: DocumentPrompt = {
  system: SYSTEM_PROMPT,
  buildPrompt: (
    filename,
  ) => `This is an employer income statement / PAYG payment summary, "${filename}". It covers one employee and one employer for the year.

Extract these fields:
- income.salaryWages[0].payerName — the employer/payer's name
- income.salaryWages[0].payerAbn — the payer's ABN (digits only where possible)
- income.salaryWages[0].grossSalaryWages — total gross salary/wages/payments for the year (label 1)
- income.salaryWages[0].paygWithheld — total PAYG tax withheld (label 1, "tax withheld")
- income.reportableFringeBenefits — total reportable fringe benefits amount, if shown (label IT1)
- income.reportableEmployerSuper — reportable employer superannuation contributions, if shown (label IT2)

${JSON_FORMAT_INSTRUCTION}`,
  pathAllowed: (path) =>
    /^income\.salaryWages\[0\]\.(payerName|payerAbn|grossSalaryWages|paygWithheld)$/.test(path) ||
    path === "income.reportableFringeBenefits" ||
    path === "income.reportableEmployerSuper",
};

const BANK_INTEREST_NOTICE: DocumentPrompt = {
  system: SYSTEM_PROMPT,
  buildPrompt: (
    filename,
  ) => `This is a bank/credit union/building society notice of interest for one account, "${filename}".

Extract these fields:
- income.interestAccounts[0].institution — the bank/institution name
- income.interestAccounts[0].accountDescription — the account name or number as shown
- income.interestAccounts[0].grossInterest — gross interest earned/credited for the year
- income.interestAccounts[0].tfnAmountsWithheld — TFN withholding tax deducted from the interest, if any (0 if none shown)

${JSON_FORMAT_INSTRUCTION}`,
  pathAllowed: (path) =>
    SINGLE_ENTITY_INDEX.test(path) &&
    /^income\.interestAccounts\[0\]\.(institution|accountDescription|grossInterest|tfnAmountsWithheld)$/.test(
      path,
    ),
};

const DIVIDEND_STATEMENT: DocumentPrompt = {
  system: SYSTEM_PROMPT,
  buildPrompt: (
    filename,
  ) => `This is a dividend or distribution statement from a company or share registry, "${filename}", for one holding.

Extract these fields:
- income.dividends[0].company — the paying company's name
- income.dividends[0].unfranked — the unfranked dividend amount (0 if none shown)
- income.dividends[0].franked — the franked dividend amount (0 if none shown)
- income.dividends[0].frankingCredits — the franking credit attached to the franked amount (0 if none shown)
- income.dividends[0].tfnAmountsWithheld — TFN withholding tax deducted, if any (0 if none shown)

${JSON_FORMAT_INSTRUCTION}`,
  pathAllowed: (path) =>
    /^income\.dividends\[0\]\.(company|unfranked|franked|frankingCredits|tfnAmountsWithheld)$/.test(
      path,
    ),
};

const PRIVATE_HEALTH_STATEMENT: DocumentPrompt = {
  system: SYSTEM_PROMPT,
  buildPrompt: (filename) => `This is a private health insurer's tax statement, "${filename}".

Extract these fields:
- privateHealth.premiumsEligibleForRebate — premiums paid that are eligible for the Australian Government rebate (statement label J)
- privateHealth.rebateReceived — rebate already received, as a reduced premium or paid direct (statement label K)
- privateHealth.oldestCoveredPersonAge — age at 30 June of the oldest person covered by the policy, if shown
- privateHealth.coverDays — number of days of hospital/ancillary cover in the year, if shown

${JSON_FORMAT_INSTRUCTION}`,
  pathAllowed: (path) =>
    pathSet(
      "privateHealth.premiumsEligibleForRebate privateHealth.rebateReceived privateHealth.oldestCoveredPersonAge privateHealth.coverDays",
    ).has(path),
};

const DONATION_RECEIPT: DocumentPrompt = {
  system: SYSTEM_PROMPT,
  buildPrompt: (
    filename,
  ) => `This is a receipt for a gift or donation to a deductible-gift-recipient charity, "${filename}".

Extract these fields:
- deductions.giftsAndDonations.amount — the donation amount
- deductions.giftsAndDonations.substantiationRef — a short reference identifying this receipt (charity name, receipt number and/or date, as shown)

${JSON_FORMAT_INSTRUCTION}`,
  pathAllowed: (path) =>
    path === "deductions.giftsAndDonations.amount" ||
    path === "deductions.giftsAndDonations.substantiationRef",
};

const WFH_OR_EXPENSE_RECORD: DocumentPrompt = {
  system: SYSTEM_PROMPT,
  buildPrompt: (
    filename,
  ) => `This is either a working-from-home hours log/diary, or a work-related expense receipt/invoice/record, "${filename}". Decide which it is from its content, then extract only the fields that apply.

If it is a WFH hours log/diary:
- deductions.workFromHome.hours — total hours worked from home for the year (or the period covered, if that's all that's shown)
- deductions.workFromHome.substantiationRef — a short reference to the record (e.g. "WFH diary, Jul 2025 - Jun 2026")

If it is a work-related expense receipt/invoice, classify it into exactly one of these and extract only that pair:
- deductions.workRelatedClothing.amount / .substantiationRef — work uniform, protective clothing, laundry or dry-cleaning
- deductions.workRelatedTravel.amount / .substantiationRef — work-related travel (not car — e.g. flights, public transport, accommodation for work travel)
- deductions.selfEducation.amount / .substantiationRef — work-related self-education (courses, textbooks, professional development)
- deductions.otherWorkRelated.amount / .substantiationRef — any other work-related expense not covered above (tools, subscriptions, union fees, etc.)

${JSON_FORMAT_INSTRUCTION}`,
  pathAllowed: (path) =>
    pathSet(
      "deductions.workFromHome.hours deductions.workFromHome.substantiationRef " +
        "deductions.workRelatedClothing.amount deductions.workRelatedClothing.substantiationRef " +
        "deductions.workRelatedTravel.amount deductions.workRelatedTravel.substantiationRef " +
        "deductions.selfEducation.amount deductions.selfEducation.substantiationRef " +
        "deductions.otherWorkRelated.amount deductions.otherWorkRelated.substantiationRef",
    ).has(path),
};

const ARRAY_INDEX_PATH = /^income\.(salaryWages|interestAccounts|dividends)\[\d+\]\./;

const ATO_PREFILL_REPORT: DocumentPrompt = {
  system: SYSTEM_PROMPT,
  buildPrompt: (
    filename,
  ) => `This is an ATO pre-fill report / pre-filling report, "${filename}", downloaded from myGov or ATO online. It typically lists several income sources for one taxpayer and year. This is the spine of the return (PRD FR-2) — extract EVERY income line it carries, not just the first of each kind.

For EACH employer/payer listed under salary and wages, emit one group (index them 0, 1, 2, ... in the order they appear on the report):
- income.salaryWages[N].payerName, income.salaryWages[N].payerAbn, income.salaryWages[N].grossSalaryWages, income.salaryWages[N].paygWithheld

For EACH interest-paying account listed:
- income.interestAccounts[N].institution, income.interestAccounts[N].accountDescription, income.interestAccounts[N].grossInterest, income.interestAccounts[N].tfnAmountsWithheld

For EACH dividend-paying holding listed:
- income.dividends[N].company, income.dividends[N].unfranked, income.dividends[N].franked, income.dividends[N].frankingCredits, income.dividends[N].tfnAmountsWithheld

Once each, if shown:
- income.governmentAllowances — taxable Australian Government allowances (JobSeeker, Youth Allowance, Austudy)
- income.reportableFringeBenefits — total reportable fringe benefits (label IT1)
- income.reportableEmployerSuper — reportable employer super contributions (label IT2)
- privateHealth.premiumsEligibleForRebate, privateHealth.rebateReceived, privateHealth.oldestCoveredPersonAge, privateHealth.coverDays — from any private health insurance policy details section

${JSON_FORMAT_INSTRUCTION}`,
  pathAllowed: (path) =>
    ARRAY_INDEX_PATH.test(path) ||
    pathSet(
      "income.governmentAllowances income.reportableFringeBenefits income.reportableEmployerSuper " +
        "privateHealth.premiumsEligibleForRebate privateHealth.rebateReceived " +
        "privateHealth.oldestCoveredPersonAge privateHealth.coverDays",
    ).has(path),
};

/**
 * `DocumentType`s this package extracts from. Rental agent statements, loan
 * summaries and QS depreciation schedules are excluded — FR-24's rental
 * extraction is a separate task; `unrecognised` is never extractable.
 */
export const EXTRACTABLE_DOCUMENT_PROMPTS: Partial<Record<DocumentType, DocumentPrompt>> = {
  "ato-prefill-report": ATO_PREFILL_REPORT,
  "income-statement": INCOME_STATEMENT,
  "bank-interest-notice": BANK_INTEREST_NOTICE,
  "dividend-statement": DIVIDEND_STATEMENT,
  "private-health-statement": PRIVATE_HEALTH_STATEMENT,
  "donation-receipt": DONATION_RECEIPT,
  "wfh-or-expense-record": WFH_OR_EXPENSE_RECORD,
};
