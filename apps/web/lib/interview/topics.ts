/**
 * The deterministic "what still needs settling" list (PRD FR-3, Q1).
 *
 * {@link topicsOutstanding} is derived only from `@aus-tax-lodge/model`'s
 * {@link requiredLabels} — which already folds in the in-scope ATO income /
 * deduction labels, the FR-6 questionnaire facts, private health, spouse, and
 * (when present) the rental scope gate. `nextTurn` puts it in the prompt so
 * Claude knows what is left to cover, and re-checks against it when Claude
 * claims the interview is done. T5 / T9 may also read it.
 *
 * This is Q1's "rely on the export gate to catch a gap" position: the list is
 * informational for the prompt and load-bearing only at the `done` re-check —
 * the real completeness decision is `isReadyForEstimate` + a clean
 * `validateReturn` (PRD FR-3).
 */
import { requiredLabels, type ReturnModel } from "@aus-tax-lodge/model";

/**
 * The static topic areas a simple resident return covers — given to Claude in
 * full every turn so it can ask natural follow-ups, not just tick labels
 * (PRD FR-3). Ordering is a suggestion, not a script.
 */
export const INTERVIEW_TOPIC_AREAS: readonly string[] = [
  "Income beyond the pre-fill report — bank interest, dividends or government payments the report missed",
  "Residency — Australian resident for tax purposes for the whole income year",
  "Spouse — whether the taxpayer had one, and if so their name, date of birth, estimated taxable income and days of private hospital cover",
  "Study / training support (HELP) loan — whether one is held",
  "Private hospital cover — the number of days held in the year",
  "Joint accounts — the taxpayer's ownership share of each joint interest account",
  "Working from home — hours, and confirming those hours were not also claimed as a separate expense",
  "Deductions — work-related car (cents-per-km only), travel, clothing/laundry, self-education, other work-related, working from home (fixed-rate method), gifts/donations to DGRs, cost of managing tax affairs",
  "Rental property — whether the taxpayer has one, and if so its figures (handled with a document request)",
];

/**
 * Every {@link requiredLabels} row not yet satisfied, by its human-readable
 * name. Empty when the deterministic completeness gate is met.
 */
export function topicsOutstanding(model: ReturnModel): string[] {
  return requiredLabels(model)
    .filter((row) => !row.satisfied)
    .map((row) => row.name);
}
