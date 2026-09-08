/**
 * Mid-conversation rental-document intake (PRD FR-24, FR-6).
 *
 * The three rental source documents — the managing agent's annual statement,
 * the lender's loan-interest summary, and the quantity surveyor's depreciation
 * schedule — have no generic extraction prompt. v1 folded them in through
 * `@aus-tax-lodge/model`'s {@link assembleRentalSchedule} from its six-step
 * wizard (`app/returns/[returnId]/documents/actions.ts`, `extractFigures`); this
 * is the same substance ported to the v2 chat shape, called by the
 * mid-conversation document route (`app/api/returns/[returnId]/documents`).
 *
 * Pure aside from the injected `@aus-tax-lodge/ai` client `assembleRentalSchedule`
 * needs for its vision parses — no Next, no store, so it unit-tests directly.
 *
 * What is deliberately NOT here (kept conversational — see `lib/interview/fields.ts`):
 *
 * - **Owner-paid expenses** (insurance, land tax, body corporate) and
 *   **hand-entered Div 43 / Div 40 totals** when there is no QS schedule
 *   (PRD FR-24, Q23, Q24) — the assistant asks for these and they map onto the
 *   rental lines through the interview field allow-list.
 * - The **repairs-vs-capital gate** (PRD Q25) — `needsRepairsConfirmation`
 *   already blocks the deterministic completeness gate, so `nextTurn` raises it
 *   as a plain question; `rental.repairsConfirmedNotCapital` on the allow-list
 *   applies the answer.
 */
import type { ClaudeClient } from "@aus-tax-lodge/ai";
import {
  assembleRentalSchedule,
  RENTAL_EXPENSE_KEYS,
  type RentalSchedule,
  type RentalSourceDocument,
  type ReturnModel,
} from "@aus-tax-lodge/model";

/**
 * Store {@link DocumentType} → the {@link assembleRentalSchedule} slot it fills.
 * Mirrors v1's `RENTAL_DOC_SLOT` (`documents/actions.ts`).
 */
export const RENTAL_DOC_SLOT = {
  "rental-agent-statement": "agentStatement",
  "loan-interest-summary": "loanSummary",
  "qs-depreciation-schedule": "qsSchedule",
} as const;

export type RentalDocType = keyof typeof RENTAL_DOC_SLOT;
export type RentalDocSlot = (typeof RENTAL_DOC_SLOT)[RentalDocType];

/** `true` when `type` is one of the three rental source-document types. */
export function isRentalDocType(type: string): type is RentalDocType {
  return type in RENTAL_DOC_SLOT;
}

/** Plain-English name for a slot, for the assistant's "what I read" summary. */
export function rentalSlotLabel(slot: RentalDocSlot): string {
  switch (slot) {
    case "agentStatement":
      return "managing agent statement";
    case "loanSummary":
      return "loan-interest summary";
    case "qsSchedule":
      return "quantity surveyor's depreciation schedule";
  }
}

export interface AssembleFromDocumentInput {
  readonly model: ReturnModel;
  readonly slot: RentalDocSlot;
  readonly source: RentalSourceDocument;
  readonly client: ClaudeClient;
}

/**
 * Fold one rental source document into the model's {@link RentalSchedule} via
 * {@link assembleRentalSchedule} (which marks `present: true`, `propose()`s each
 * parsed figure against its document origin, and re-nets the schedule).
 */
export async function assembleRentalFromDocument(
  input: AssembleFromDocumentInput,
): Promise<RentalSchedule> {
  const { model, slot, source, client } = input;
  return assembleRentalSchedule(model, { [slot]: source }, client);
}

const RENTAL_LINE_LABEL: Partial<Record<(typeof RENTAL_EXPENSE_KEYS)[number], string>> = {
  interestOnLoans: "loan interest",
  capitalWorks: "capital works (Division 43)",
  declineInValue: "decline in value (Division 40)",
  borrowingExpenses: "borrowing expenses",
  agentFees: "agent fees",
  repairsAndMaintenance: "repairs and maintenance",
  councilRates: "council rates",
  waterCharges: "water charges",
  bodyCorporate: "body corporate",
  insurance: "insurance",
  landTax: "land tax",
};

function money(value: number): string {
  return `$${value.toLocaleString("en-AU", { maximumFractionDigits: 2 })}`;
}

/**
 * A plain-English recap of the figures a rental document contributed — built
 * **only from the model**, by diffing the schedule before and after
 * {@link assembleRentalFromDocument} (the same LLM boundary
 * `lib/income-summary`'s `summariseIncomeFound` keeps: the assistant never
 * states a figure the model does not hold).
 */
export function summariseRentalDocument(
  before: RentalSchedule,
  after: RentalSchedule,
  slot: RentalDocSlot,
): string {
  const parts: string[] = [];

  const grossBefore = before.grossRent.value;
  if (after.grossRent.value != null && after.grossRent.value !== grossBefore) {
    parts.push(`${money(after.grossRent.value)} gross rent`);
  }
  const otherBefore = before.otherRentalIncome.value;
  if (after.otherRentalIncome.value != null && after.otherRentalIncome.value !== otherBefore) {
    parts.push(`${money(after.otherRentalIncome.value)} other rental income`);
  }
  for (const key of RENTAL_EXPENSE_KEYS) {
    const now = after.expenses[key].amount.value;
    const was = before.expenses[key].amount.value;
    if (now != null && now !== was) {
      parts.push(`${money(now)} ${RENTAL_LINE_LABEL[key] ?? key}`);
    }
  }

  const label = rentalSlotLabel(slot);
  if (parts.length === 0) {
    return (
      `I read your ${label}, but couldn't pull any new rental figures from it. ` +
      "If it's the right document, tell me the figures directly and I'll use those."
    );
  }
  return `From your ${label} I've got ${joinList(parts)}.`;
}

function joinList(items: readonly string[]): string {
  if (items.length === 1) return items[0]!;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * `true` when the return has no quantity surveyor's schedule and neither
 * depreciation line is filled yet — the point at which the assistant should
 * offer to take Div 43 / Div 40 by hand or proceed without them (PRD Q23).
 */
export function depreciationOutstanding(schedule: RentalSchedule, hasQsSchedule: boolean): boolean {
  if (hasQsSchedule) return false;
  return (
    schedule.expenses.capitalWorks.amount.value == null &&
    schedule.expenses.declineInValue.amount.value == null
  );
}

/**
 * The "no QS schedule" warning + offer (PRD FR-24, Q23). Ported from v1's
 * `DocumentsPanel` copy — the user under-claims without a schedule, so the
 * assistant surfaces the choice rather than quietly leaving the lines nil.
 */
export const DEPRECIATION_WARNING =
  "You haven't given me a quantity surveyor's depreciation schedule. Without one you may be " +
  "under-claiming capital works (Division 43) and decline in value (Division 40). If you have " +
  "this year's totals, tell me and I'll record them; otherwise say to proceed without them.";

/**
 * The assistant's line when a repairs-and-maintenance figure lands over the
 * $1,000 confirmation threshold (PRD Q25). `nextTurn` also raises this from the
 * outstanding-topics list; keeping the copy here lets the document route say it
 * straight away, in the same turn it reports what it read.
 */
export function repairsConfirmationPrompt(schedule: RentalSchedule): string | null {
  const amount = schedule.expenses.repairsAndMaintenance.amount.value;
  if (amount == null) return null;
  return (
    `The repairs and maintenance line is ${money(amount)}. Can you confirm that was genuine ` +
    "repair work (fixing wear or damage), not a renovation or improvement? An improvement is a " +
    "capital cost, not an immediate deduction."
  );
}
