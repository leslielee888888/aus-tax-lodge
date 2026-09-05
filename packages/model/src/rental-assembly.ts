/**
 * Rental property schedule assembly (PRD FR-24, Q22-Q25).
 *
 * Turns the three rental source documents — the managing agent's annual
 * statement, the lender's loan-interest summary, and the quantity surveyor's
 * depreciation schedule — plus user-entered owner-paid expenses, into a filled
 * {@link RentalSchedule} on the return model. Each parsed figure is a single
 * Claude vision call via {@link ClaudeClient.askVision} (the rental-specific
 * parse; the generic extraction primitive is a separate task) mapped straight
 * onto the model's {@link RentalExpenseKey}s with a document-backed
 * {@link DocumentOrigin}. Owner-paid items are recorded as the user's own facts
 * via {@link answer}.
 *
 * Also owns the repairs-vs-capital gate (PRD Q25, FR-13): a single
 * "repairs and maintenance" line over {@link RENTAL_REPAIRS_CONFIRMATION_THRESHOLD}
 * must be confirmed a genuine repair before the return can proceed, or
 * reclassified as a capital-works amount.
 *
 * Out of scope here (see the task brief): the out-of-scope rental-envelope
 * detection (`@aus-tax-lodge/scope` `detect.ts` is the single source of truth
 * for that — this module only has to keep `RentalSchedule` accurate) and the
 * review-screen UI.
 */
import { type ClaudeClient, type VisionPart } from "@aus-tax-lodge/ai";

import {
  RENTAL_EXPENSE_KEYS,
  RENTAL_REPAIRS_CONFIRMATION_THRESHOLD,
  recomputeNetRentalResult,
  type RentalExpenseKey,
  type RentalExpenseLine,
  type RentalExpenseSource,
  type RentalSchedule,
  type ReturnModel,
} from "./model";
import { answer, computedOrigin, documentOrigin, propose, type FieldConfidence } from "./provenance";

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

/** One rental source document to parse (PRD FR-24, FR-3). */
export interface RentalSourceDocument {
  /** Store doc id (`@aus-tax-lodge/store` `docId`) — recorded on every figure's {@link DocumentOrigin}. */
  readonly docId: string;
  readonly bytes: Buffer;
  /** `application/pdf`, `image/png`, or `image/jpeg`. */
  readonly mimeType: string;
}

/** The (optional) rental documents supplied for one assembly pass. */
export interface RentalSourceDocuments {
  readonly agentStatement?: RentalSourceDocument;
  readonly loanSummary?: RentalSourceDocument;
  readonly qsSchedule?: RentalSourceDocument;
}

/**
 * Owner-paid rental expenses not on the agent statement (PRD FR-24, Q24) — the
 * only three keys a landlord plausibly pays directly rather than through the
 * managing agent. `undefined` leaves the corresponding line untouched.
 */
export interface OwnerPaidRentalExpenses {
  readonly insurance?: number;
  readonly landTax?: number;
  readonly bodyCorporate?: number;
}

/** One figure lifted from a document, with its provenance snippet (PRD FR-3). */
export interface ParsedRentalFigure {
  readonly amount: number;
  /** 1-based page the figure was found on. */
  readonly page: number;
  /** Verbatim snippet quoted from the document. */
  readonly snippet: string;
}

/** Confidence assigned to every figure this module parses (PRD FR-3): found and
 * format-valid, but not cross-checked against another source or the document's
 * text layer — that cross-check is the generic extraction primitive's job. */
const PARSED_CONFIDENCE: FieldConfidence = "medium";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function toVisionPart(doc: RentalSourceDocument): VisionPart {
  return {
    kind: doc.mimeType === "application/pdf" ? "pdf" : "image",
    mimeType: doc.mimeType,
    bytes: doc.bytes,
  };
}

/** Finds the outermost `{...}` in a reply and parses it, tolerating a stray code fence or preamble. */
function extractJson(reply: string): Record<string, unknown> | null {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const parsed: unknown = JSON.parse(reply.slice(start, end + 1));
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function toParsedFigure(raw: unknown): ParsedRentalFigure | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.amount !== "number" || !Number.isFinite(r.amount)) return null;
  const page = typeof r.page === "number" && Number.isFinite(r.page) ? Math.max(1, Math.trunc(r.page)) : 1;
  const snippet = typeof r.snippet === "string" ? r.snippet : "";
  return { amount: round2(r.amount), page, snippet };
}

// ---------------------------------------------------------------------------
// Agent annual-statement parse (PRD FR-24, FR-3)
// ---------------------------------------------------------------------------

/** One expense line item as the model mapped it off the agent statement. */
export interface AgentStatementLineItem {
  readonly key: RentalExpenseKey;
  readonly amount: number;
  readonly page: number;
  readonly snippet: string;
  /** The line-item label as printed on the statement — kept as a note for anything mapped to `sundryExpenses`. */
  readonly description: string;
}

export interface AgentStatementParseResult {
  readonly grossRent: ParsedRentalFigure | null;
  readonly otherRentalIncome: ParsedRentalFigure | null;
  readonly lineItems: readonly AgentStatementLineItem[];
}

const EMPTY_AGENT_STATEMENT_RESULT: AgentStatementParseResult = {
  grossRent: null,
  otherRentalIncome: null,
  lineItems: [],
};

/** Expense keys the agent statement may plausibly report against (excludes the loan/QS-only keys). */
const AGENT_STATEMENT_EXPENSE_KEYS: readonly RentalExpenseKey[] = RENTAL_EXPENSE_KEYS.filter(
  (key) => key !== "interestOnLoans" && key !== "capitalWorks" && key !== "declineInValue",
);

const AGENT_STATEMENT_SYSTEM_PROMPT =
  "You are a precise financial-figure extraction step in an Australian individual " +
  "tax-return assistant, reading a real-estate managing agent's annual statement " +
  "for one rental property. Extract only figures actually printed on the " +
  "statement — never invent, estimate, or infer a figure that is not stated. " +
  "Reply with strict JSON only: no markdown code fences, no commentary, no " +
  "trailing text outside the JSON object.";

const AGENT_STATEMENT_PROMPT = `This is a real-estate managing agent's annual statement for one rental property, for the 2025-26 Australian income year. Extract:

1. The gross rent received or collected for the year.
2. Any other rental-related income shown (e.g. bond money retained, an insurance payout for lost rent, a reimbursed expense) — omit (null) if none.
3. Every expense line item the agent lists (management/letting fees, repairs, water, council rates, body corporate, insurance, land tax, legal fees, pest control, gardening, cleaning, advertising, stationery/phone/postage, or anything else charged against the rent).

Map each expense line to exactly one of these keys:
- agentFees — management fees, letting fees, commission
- repairsAndMaintenance — repairs, maintenance
- waterCharges — water rates, water usage
- councilRates — council/shire rates
- bodyCorporate — body corporate / strata / owners corporation fees
- insurance — landlord/building/contents insurance (only if actually paid by the agent from rental proceeds)
- landTax — land tax (only if actually paid by the agent from rental proceeds)
- legalFees — legal expenses (not acquisition, sale or borrowing costs)
- pestControl — pest control / termite treatment
- gardeningLawn — gardening, lawn mowing
- cleaning — cleaning
- advertising — advertising for tenants
- stationeryPhonePostage — stationery, telephone, postage
- borrowingExpenses — a loan establishment/application fee only if the agent statement itself (not the loan summary) shows one charged against the rent
- sundryExpenses — anything charged against the rent that does not fit any key above; put the printed line-item description in "description" so it can be checked

Do not report interestOnLoans, capitalWorks or declineInValue from this document — those come from other documents.

For every figure, quote the exact snippet of text from the statement it came from (verbatim, including the line-item label and amount as printed) and the 1-based page number it appears on.

Reply with exactly this JSON shape and nothing else:
{
  "grossRent": { "amount": number, "page": number, "snippet": string } | null,
  "otherRentalIncome": { "amount": number, "page": number, "snippet": string } | null,
  "expenses": [
    { "key": string, "amount": number, "page": number, "snippet": string, "description": string }
  ]
}
Use null for grossRent/otherRentalIncome only if genuinely not stated anywhere on the statement. Amounts are dollars, as plain numbers (no "$", no commas).`;

function toAgentStatementLineItem(raw: unknown): AgentStatementLineItem | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const figure = toParsedFigure(r);
  if (!figure) return null;
  const rawKey = typeof r.key === "string" ? r.key : "";
  const description = typeof r.description === "string" ? r.description : rawKey;
  const key = (AGENT_STATEMENT_EXPENSE_KEYS as readonly string[]).includes(rawKey)
    ? (rawKey as RentalExpenseKey)
    : "sundryExpenses";
  return { key, amount: figure.amount, page: figure.page, snippet: figure.snippet, description };
}

/**
 * Parses a rental agent's annual statement into gross rent, other rental
 * income, and every expense line mapped to a {@link RentalExpenseKey} (PRD
 * FR-24, FR-3). Never throws — a parse failure (a malformed reply, or the
 * Claude call itself failing) returns an empty result so the caller can still
 * fall back to owner entry.
 */
export async function parseAgentStatement(
  doc: RentalSourceDocument,
  client: ClaudeClient,
): Promise<AgentStatementParseResult> {
  try {
    const reply = await client.askVision([toVisionPart(doc)], AGENT_STATEMENT_PROMPT, {
      system: AGENT_STATEMENT_SYSTEM_PROMPT,
      maxTokens: 2048,
    });
    const json = extractJson(reply);
    if (!json) return EMPTY_AGENT_STATEMENT_RESULT;
    const lineItems = Array.isArray(json.expenses)
      ? json.expenses.map(toAgentStatementLineItem).filter((item): item is AgentStatementLineItem => item !== null)
      : [];
    return {
      grossRent: toParsedFigure(json.grossRent),
      otherRentalIncome: toParsedFigure(json.otherRentalIncome),
      lineItems,
    };
  } catch {
    return EMPTY_AGENT_STATEMENT_RESULT;
  }
}

// ---------------------------------------------------------------------------
// Loan-interest summary parse (PRD FR-24, FR-3, Q25)
// ---------------------------------------------------------------------------

export interface LoanSummaryParseResult {
  readonly interestOnLoans: ParsedRentalFigure | null;
  readonly borrowingExpenses: ParsedRentalFigure | null;
}

const EMPTY_LOAN_SUMMARY_RESULT: LoanSummaryParseResult = {
  interestOnLoans: null,
  borrowingExpenses: null,
};

const LOAN_SUMMARY_SYSTEM_PROMPT =
  "You are a precise financial-figure extraction step in an Australian individual " +
  "tax-return assistant, reading a lender's annual interest summary for a rental " +
  "property loan. Extract only figures actually printed on the statement — never " +
  "invent, estimate, or infer a figure that is not stated. Reply with strict JSON " +
  "only: no markdown code fences, no commentary, no trailing text outside the " +
  "JSON object.";

const LOAN_SUMMARY_PROMPT = `This is a lender's annual interest summary for a loan used to purchase or maintain a rental property, for the 2025-26 Australian income year. Extract:

1. interestOnLoans — the total interest charged on the loan for the year.
2. borrowingExpenses — a borrowing-expense figure only if the statement itself states a dollar amount that is this year's charge (e.g. an annual portion of loan establishment, application or valuation fees). Do not calculate or estimate a 5-year amortisation yourself — the user enters that portion by hand elsewhere if the statement does not state it. Omit (null) if the statement does not show one.

For every figure, quote the exact snippet of text it came from (verbatim) and the 1-based page number it appears on.

Reply with exactly this JSON shape and nothing else:
{
  "interestOnLoans": { "amount": number, "page": number, "snippet": string } | null,
  "borrowingExpenses": { "amount": number, "page": number, "snippet": string } | null
}
Amounts are dollars, as plain numbers (no "$", no commas).`;

/**
 * Parses a lender's loan-interest summary into the year's interest and (if
 * stated) borrowing-expense figures (PRD FR-24, Q25). The tool never spreads a
 * borrowing expense over 5 years itself — only a figure the statement states as
 * this year's own charge is reported. Never throws.
 */
export async function parseLoanSummary(
  doc: RentalSourceDocument,
  client: ClaudeClient,
): Promise<LoanSummaryParseResult> {
  try {
    const reply = await client.askVision([toVisionPart(doc)], LOAN_SUMMARY_PROMPT, {
      system: LOAN_SUMMARY_SYSTEM_PROMPT,
      maxTokens: 512,
    });
    const json = extractJson(reply);
    if (!json) return EMPTY_LOAN_SUMMARY_RESULT;
    return {
      interestOnLoans: toParsedFigure(json.interestOnLoans),
      borrowingExpenses: toParsedFigure(json.borrowingExpenses),
    };
  } catch {
    return EMPTY_LOAN_SUMMARY_RESULT;
  }
}

// ---------------------------------------------------------------------------
// QS depreciation-schedule parse (PRD FR-24, FR-3, Q23)
// ---------------------------------------------------------------------------

export interface QsScheduleParseResult {
  readonly capitalWorks: ParsedRentalFigure | null;
  readonly declineInValue: ParsedRentalFigure | null;
}

const EMPTY_QS_SCHEDULE_RESULT: QsScheduleParseResult = {
  capitalWorks: null,
  declineInValue: null,
};

const QS_SCHEDULE_SYSTEM_PROMPT =
  "You are a precise financial-figure extraction step in an Australian individual " +
  "tax-return assistant, reading a quantity surveyor's tax depreciation schedule " +
  "for a rental property. Extract only the figures printed for the requested " +
  "income year — never invent, estimate, or infer a figure that is not stated. " +
  "Reply with strict JSON only: no markdown code fences, no commentary, no " +
  "trailing text outside the JSON object.";

/** `"2025-26"` -> the calendar year the income year ends in, `2026`. */
function targetYearEnd(targetYear: string): number {
  const [startStr, endStr] = targetYear.split("-");
  const start = Number(startStr);
  const endSuffix = Number(endStr);
  if (!Number.isFinite(start) || !Number.isFinite(endSuffix)) return start || 0;
  const century = Math.floor(start / 100) * 100;
  let end = century + endSuffix;
  if (end <= start) end += 100;
  return end;
}

function qsSchedulePrompt(targetYear: string): string {
  const yearEnded = targetYearEnd(targetYear);
  return `This is a quantity surveyor's tax depreciation schedule for a rental property. Find the row or column for the Australian income year ${targetYear} (year ended 30 June ${yearEnded}) and extract:

1. capitalWorks — the Division 43 capital works deduction for that year (special building write-off; sometimes labelled "capital allowance" or "building write-off").
2. declineInValue — the Division 40 decline in value of depreciating assets for that year (plant and equipment; sometimes labelled "low-value pool" or "decline in value").

For every figure, quote the exact snippet of text it came from (verbatim, including the year it is drawn from) and the 1-based page number it appears on.

Reply with exactly this JSON shape and nothing else:
{
  "capitalWorks": { "amount": number, "page": number, "snippet": string } | null,
  "declineInValue": { "amount": number, "page": number, "snippet": string } | null
}
Use null for a figure only if the schedule genuinely has no row for the requested income year. Amounts are dollars, as plain numbers (no "$", no commas).`;
}

/**
 * Parses a quantity surveyor's depreciation schedule into the target year's
 * Division 43 (capital works) and Division 40 (decline in value) totals (PRD
 * FR-24, FR-3, Q23). A missing schedule is not this function's concern — the
 * caller simply doesn't call it, and both fields stay `unset` on the schedule
 * (Q23 — the user may enter them by hand or proceed without them). Never throws.
 */
export async function parseQsSchedule(
  doc: RentalSourceDocument,
  client: ClaudeClient,
  targetYear: string,
): Promise<QsScheduleParseResult> {
  try {
    const reply = await client.askVision([toVisionPart(doc)], qsSchedulePrompt(targetYear), {
      system: QS_SCHEDULE_SYSTEM_PROMPT,
      maxTokens: 512,
    });
    const json = extractJson(reply);
    if (!json) return EMPTY_QS_SCHEDULE_RESULT;
    return {
      capitalWorks: toParsedFigure(json.capitalWorks),
      declineInValue: toParsedFigure(json.declineInValue),
    };
  } catch {
    return EMPTY_QS_SCHEDULE_RESULT;
  }
}

// ---------------------------------------------------------------------------
// Assembly (PRD FR-24)
// ---------------------------------------------------------------------------

function proposeExpense(
  line: RentalExpenseLine,
  amount: number,
  origin: ReturnType<typeof documentOrigin>,
  source: RentalExpenseSource,
): RentalExpenseLine {
  return { amount: propose(line.amount, amount, origin), source };
}

/** Groups agent-statement line items by key, summing amounts that share a key and joining their snippets. */
function groupLineItems(
  items: readonly AgentStatementLineItem[],
): Map<RentalExpenseKey, { amount: number; page: number; snippet: string }> {
  const groups = new Map<RentalExpenseKey, { amount: number; page: number; snippet: string }>();
  for (const item of items) {
    const label = item.key === "sundryExpenses" ? `${item.description}: ${item.snippet}` : item.snippet;
    const existing = groups.get(item.key);
    if (existing) {
      groups.set(item.key, {
        amount: round2(existing.amount + item.amount),
        page: existing.page,
        snippet: `${existing.snippet}; ${label}`,
      });
    } else {
      groups.set(item.key, { amount: item.amount, page: item.page, snippet: label });
    }
  }
  return groups;
}

function applyAgentStatement(
  schedule: RentalSchedule,
  docId: string,
  parsed: AgentStatementParseResult,
): RentalSchedule {
  let next = schedule;
  if (parsed.grossRent) {
    next = {
      ...next,
      grossRent: propose(
        next.grossRent,
        parsed.grossRent.amount,
        documentOrigin(docId, parsed.grossRent.page, parsed.grossRent.snippet, PARSED_CONFIDENCE),
      ),
    };
  }
  if (parsed.otherRentalIncome) {
    next = {
      ...next,
      otherRentalIncome: propose(
        next.otherRentalIncome,
        parsed.otherRentalIncome.amount,
        documentOrigin(
          docId,
          parsed.otherRentalIncome.page,
          parsed.otherRentalIncome.snippet,
          PARSED_CONFIDENCE,
        ),
      ),
    };
  }

  const expenses = { ...next.expenses };
  for (const [key, group] of groupLineItems(parsed.lineItems)) {
    expenses[key] = proposeExpense(
      expenses[key],
      group.amount,
      documentOrigin(docId, group.page, group.snippet, PARSED_CONFIDENCE),
      "agent-statement",
    );
  }
  return { ...next, expenses };
}

function applyLoanSummary(
  schedule: RentalSchedule,
  docId: string,
  parsed: LoanSummaryParseResult,
): RentalSchedule {
  const expenses = { ...schedule.expenses };
  if (parsed.interestOnLoans) {
    expenses.interestOnLoans = proposeExpense(
      expenses.interestOnLoans,
      parsed.interestOnLoans.amount,
      documentOrigin(docId, parsed.interestOnLoans.page, parsed.interestOnLoans.snippet, PARSED_CONFIDENCE),
      "loan-summary",
    );
  }
  if (parsed.borrowingExpenses) {
    expenses.borrowingExpenses = proposeExpense(
      expenses.borrowingExpenses,
      parsed.borrowingExpenses.amount,
      documentOrigin(
        docId,
        parsed.borrowingExpenses.page,
        parsed.borrowingExpenses.snippet,
        PARSED_CONFIDENCE,
      ),
      "loan-summary",
    );
  }
  return { ...schedule, expenses };
}

function applyQsSchedule(
  schedule: RentalSchedule,
  docId: string,
  parsed: QsScheduleParseResult,
): RentalSchedule {
  const expenses = { ...schedule.expenses };
  if (parsed.capitalWorks) {
    expenses.capitalWorks = proposeExpense(
      expenses.capitalWorks,
      parsed.capitalWorks.amount,
      documentOrigin(docId, parsed.capitalWorks.page, parsed.capitalWorks.snippet, PARSED_CONFIDENCE),
      "qs-schedule",
    );
  }
  if (parsed.declineInValue) {
    expenses.declineInValue = proposeExpense(
      expenses.declineInValue,
      parsed.declineInValue.amount,
      documentOrigin(
        docId,
        parsed.declineInValue.page,
        parsed.declineInValue.snippet,
        PARSED_CONFIDENCE,
      ),
      "qs-schedule",
    );
  }
  return { ...schedule, expenses };
}

const OWNER_PAID_KEYS: readonly (keyof OwnerPaidRentalExpenses & RentalExpenseKey)[] = [
  "insurance",
  "landTax",
  "bodyCorporate",
];

function applyOwnerPaid(schedule: RentalSchedule, ownerPaid: OwnerPaidRentalExpenses): RentalSchedule {
  const expenses = { ...schedule.expenses };
  for (const key of OWNER_PAID_KEYS) {
    const value = ownerPaid[key];
    if (value === undefined) continue;
    expenses[key] = { amount: answer(expenses[key].amount, round2(value)), source: "owner-paid" };
  }
  return { ...schedule, expenses };
}

/**
 * Assembles an updated {@link RentalSchedule} from whichever rental documents
 * are supplied plus any owner-paid expenses (PRD FR-24). Every parsed figure is
 * `propose()`d against its {@link DocumentOrigin}; owner-paid figures are
 * `answer()`ed (the user's own fact). `netRentalResult` is recomputed at the end
 * via {@link recomputeNetRentalResult}. Marks the schedule `present: true` —
 * assembly only runs once the user has said they have a rental.
 *
 * Omitting a document leaves its figures untouched on the schedule (Q23 — no QS
 * schedule means capital works / decline in value stay whatever they were,
 * `unset` on a fresh schedule, for the user to enter by hand or leave nil).
 */
export async function assembleRentalSchedule(
  model: ReturnModel,
  documents: RentalSourceDocuments,
  client: ClaudeClient,
  ownerPaid: OwnerPaidRentalExpenses = {},
): Promise<RentalSchedule> {
  let schedule: RentalSchedule = { ...model.rental, present: true };

  if (documents.agentStatement) {
    const parsed = await parseAgentStatement(documents.agentStatement, client);
    schedule = applyAgentStatement(schedule, documents.agentStatement.docId, parsed);
  }
  if (documents.loanSummary) {
    const parsed = await parseLoanSummary(documents.loanSummary, client);
    schedule = applyLoanSummary(schedule, documents.loanSummary.docId, parsed);
  }
  if (documents.qsSchedule) {
    const parsed = await parseQsSchedule(documents.qsSchedule, client, model.targetYear);
    schedule = applyQsSchedule(schedule, documents.qsSchedule.docId, parsed);
  }

  schedule = applyOwnerPaid(schedule, ownerPaid);

  return recomputeNetRentalResult(schedule);
}

// ---------------------------------------------------------------------------
// Repairs-vs-capital gate (PRD Q25, FR-13, FR-24)
// ---------------------------------------------------------------------------

/**
 * `true` when the repairs-and-maintenance line (confirmed or proposed) exceeds
 * {@link RENTAL_REPAIRS_CONFIRMATION_THRESHOLD} and the user has not yet
 * confirmed it a genuine repair (PRD Q25, FR-13, FR-24).
 */
export function needsRepairsConfirmation(schedule: RentalSchedule): boolean {
  const amount = schedule.expenses.repairsAndMaintenance.amount.value;
  return amount != null && amount > RENTAL_REPAIRS_CONFIRMATION_THRESHOLD && !schedule.repairsConfirmedNotCapital;
}

/** Records the user's confirmation that the over-threshold repairs line is a genuine repair, not a capital improvement. */
export function confirmRepairsAreDeductible(schedule: RentalSchedule): RentalSchedule {
  return { ...schedule, repairsConfirmedNotCapital: true };
}

/**
 * Moves the repairs-and-maintenance amount into `capitalWorks` (it was a
 * capital improvement, not an immediately deductible repair) and clears the
 * repairs line to zero, each with a {@link ComputedOrigin} note. Clears the
 * confirmation flag — the amount is no longer sitting in a line that needs it —
 * and re-nets the schedule.
 */
export function reclassifyRepairsAsCapital(schedule: RentalSchedule): RentalSchedule {
  const repairsLine = schedule.expenses.repairsAndMaintenance;
  const movedAmount = repairsLine.amount.value ?? 0;
  const capitalWorksLine = schedule.expenses.capitalWorks;
  const newCapitalWorksAmount = round2((capitalWorksLine.amount.value ?? 0) + movedAmount);

  const expenses = {
    ...schedule.expenses,
    repairsAndMaintenance: {
      ...repairsLine,
      amount: propose(
        repairsLine.amount,
        0,
        computedOrigin(`reclassified to capital works — not a genuine repair (was ${movedAmount})`),
      ),
    },
    capitalWorks: {
      ...capitalWorksLine,
      amount: propose(
        capitalWorksLine.amount,
        newCapitalWorksAmount,
        computedOrigin(`capital works + reclassified repairs-and-maintenance amount (${movedAmount})`),
      ),
    },
  };

  return recomputeNetRentalResult({ ...schedule, expenses, repairsConfirmedNotCapital: false });
}
