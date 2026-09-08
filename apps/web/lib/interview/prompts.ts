/**
 * Prompt construction and JSON-reply parsing for the interview agent
 * (PRD FR-3, FR-4).
 *
 * Both prompts are tight (small `maxTokens`) and demand a single JSON object
 * back. The system prompts pin the LLM boundary: Claude picks and phrases
 * questions and parses answers — it never does return arithmetic and never
 * states a computed figure (PRD FR-3, "LLM boundary").
 */
import type { ReturnModel } from "@aus-tax-lodge/model";
import { SCOPE_CODES, type ScopeCode } from "@aus-tax-lodge/scope";

import type { ConversationState } from "../conversation";
import { readExtractionScratch } from "../extraction-scratch";
import { INTERVIEW_FIELD_PATHS } from "./fields";
import { renderModelForPrompt, renderTranscript } from "./render";
import { INTERVIEW_TOPIC_AREAS, topicsOutstanding } from "./topics";
import type { FieldUpdate, FieldUpdateKind } from "./types";

export const NEXT_TURN_MAX_TOKENS = 400;
export const APPLY_TURN_MAX_TOKENS = 500;

export const NEXT_TURN_SYSTEM = [
  "You are a careful Australian registered-tax-agent-style interviewer preparing a simple",
  "resident individual tax return. You choose and phrase the next thing to say, in plain",
  "English, working through what the return still needs. You skip anything already settled.",
  "",
  "HARD RULES:",
  "- You never do tax arithmetic and never state a computed figure (a refund, tax payable,",
  "  taxable income, a total). Only repeat numbers exactly as they appear in the supplied",
  "  model rendering. The deterministic engine computes every assessment figure, not you.",
  "- You do not give tax advice, recommend how to arrange affairs, or suggest a deduction",
  "  the user has not raised.",
  "- You never declare a return out of scope or raise a hard stop — that is decided",
  "  deterministically by the app, not by you.",
  "- Completeness is decided by a deterministic gate, not by you. Say you are done only when",
  "  you genuinely believe every topic is covered; the app will re-check and overrule you.",
  "",
  "Reply with ONE JSON object, no prose, no code fence. One of:",
  '  {"kind":"ask","text":"<a single plain question>"}',
  '  {"kind":"say","text":"<a short statement or acknowledgement, no question>"}',
  '  {"kind":"card","card":"<card-type>","text":"<optional lead-in>"}',
  '  {"kind":"done"}',
  "Valid card types:",
  '  "income-checkpoint" — check the income the pre-fill report seeded, line by line.',
  '  "upload-or-tell" — a topic the pre-fill does not carry (a deduction amount, the rental',
  "    inputs): offer the user one document to drop OR to state the figure(s). Put what is",
  "    needed in the lead text. Never list documents the user 'should' provide.",
  '  "reconcile" — two sources disagree on a figure; the app raises this itself, do not pick it.',
  '  "confirm-figure" — check one specific flagged figure.',
  'When every topic is genuinely covered, return {"kind":"done"} — do NOT try to',
  "produce a review or summary card yourself; the app builds the whole-return review.",
].join("\n");

/**
 * If the last user turn reopened the review (a `card-response` on a
 * `review-summary` card), the line they rejected — so `nextTurn` asks about it
 * again and doesn't immediately re-declare the interview done (PRD FR-5).
 */
function reopenedLineHint(conversation: ConversationState): string | null {
  const last = conversation.turns.at(-1);
  if (!last || last.role !== "user" || last.kind !== "card-response") return null;
  const card = [...conversation.turns]
    .reverse()
    .find((t) => t.role === "assistant" && t.kind === "card" && t.id === last.cardId);
  if (!card || card.kind !== "card" || card.card.type !== "review-summary") return null;
  const response = last.response;
  const lineKey =
    response &&
    typeof response === "object" &&
    typeof (response as { lineKey?: unknown }).lineKey === "string"
      ? (response as { lineKey: string }).lineKey
      : "a figure";
  return `The user has just reopened the review to correct: ${lineKey}. Ask them about that, and do not say the interview is done until it is resolved.`;
}

/** Build the per-turn prompt for {@link import("./next-turn").nextTurn}. */
export function buildNextTurnPrompt(model: ReturnModel, conversation: ConversationState): string {
  const outstanding = topicsOutstanding(model);
  const unresolvedReconciliations = readExtractionScratch(model).pendingReconciliation;
  const reopened = reopenedLineHint(conversation);
  const rentalGateOutstanding =
    model.rental.present && outstanding.some((t) => /rental scope gate/i.test(t));
  return [
    ...(reopened ? ["JUST HAPPENED:", reopened, ""] : []),
    "WHAT THE RETURN MODEL ALREADY HOLDS:",
    renderModelForPrompt(model),
    "",
    "RECENT CONVERSATION (oldest first):",
    renderTranscript(conversation),
    "",
    "TOPIC AREAS A SIMPLE RESIDENT RETURN COVERS:",
    ...INTERVIEW_TOPIC_AREAS.map((t) => `- ${t}`),
    "",
    "STILL OUTSTANDING PER THE DETERMINISTIC CHECKLIST (may be incomplete — use judgement too):",
    outstanding.length > 0 ? outstanding.map((t) => `- ${t}`).join("\n") : "- (nothing flagged)",
    "",
    "UNRESOLVED SOURCE DISAGREEMENTS (the app raises the reconcile card for these — do not ask about them yourself):",
    unresolvedReconciliations.length > 0
      ? unresolvedReconciliations.map((r) => `- ${r.modelPath}`).join("\n")
      : "- (none)",
    "",
    'TOPICS THAT NEED A DOCUMENT OR A STATED FIGURE — use a "upload-or-tell" card, phrasing the',
    "lead as what specifically is needed: a deduction dollar amount the user has raised, or the",
    "rental figures once the user has said they have a rental property.",
    "",
    ...(rentalGateOutstanding
      ? [
          "RENTAL SCOPE GATE OUTSTANDING — the return has a rental property but its scope-gate",
          "questions are not all answered yet. Ask, in plain English, one question covering: whether",
          "they own the property on their own (not co-owned), whether it was rented or genuinely",
          "available for rent the whole year, whether there was any private use, and whether they",
          "bought or sold it during the year. A 'no' to sole ownership / all-year / no-private-use,",
          "or a 'yes' to bought-or-sold, is decided by the app as an out-of-scope stop — do not",
          "declare that yourself, just gather the answers.",
          "",
        ]
      : []),
    "Decide the single next thing to say. Return the JSON object.",
  ].join("\n");
}

export const APPLY_TURN_SYSTEM = [
  "You map a taxpayer's plain-English reply in a tax interview onto concrete return fields.",
  "",
  "HARD RULES:",
  "- You never do tax arithmetic that lands in the assessment. Converting units the user",
  "  states (e.g. '5 hours a week' -> 260 hours a year) is fine; computing a tax figure is not.",
  "- You do not give tax advice, recommend how to arrange affairs, or suggest a deduction",
  "  the user has not raised. You only map what the taxpayer actually said onto fields.",
  "- If the reply is ambiguous, or spans several fields you cannot split confidently",
  "  (e.g. 'about two grand for tools and some union fees'), do NOT guess — ask to clarify.",
  "- Only use field paths from the ALLOWED PATHS list. Never invent one.",
  "- If the reply implies something out of scope for a simple resident return (capital gains /",
  "  selling shares or property, business or sole-trader income, foreign income, a trust /",
  "  partnership / managed-fund distribution, an employee share scheme, an employment",
  "  termination or redundancy payment, a super income stream, the car logbook method, the",
  "  working-from-home actual-cost method, non-resident or part-year residency, a co-owned /",
  "  part-year / privately-used rental), flag it.",
  "",
  "Reply with ONE JSON object, no prose, no code fence. One of:",
  '  {"updates":[{"path":"<allowed path>","value":<string|number|boolean|null>,"kind":"number|string|boolean|date"}]}',
  '  {"clarify":"<a single follow-up question>"}',
  'You may add "outOfScope":["<scope-code>", ...] to either shape when the reply implies an',
  "out-of-scope item.",
  `Valid scope codes: ${SCOPE_CODES.join(", ")}.`,
].join("\n");

/** Build the answer-parsing prompt for {@link import("./apply-user-turn").applyUserTurn}. */
export function buildApplyTurnPrompt(
  model: ReturnModel,
  conversation: ConversationState,
  text: string,
): string {
  const lastAssistant = [...conversation.turns]
    .reverse()
    .find((t) => t.role === "assistant" && t.kind === "message");
  return [
    "WHAT THE RETURN MODEL ALREADY HOLDS:",
    renderModelForPrompt(model),
    "",
    "THE QUESTION THE ASSISTANT JUST ASKED:",
    lastAssistant && lastAssistant.kind === "message" ? lastAssistant.text : "(none recorded)",
    "",
    "THE TAXPAYER'S REPLY:",
    text,
    "",
    "ALLOWED PATHS:",
    INTERVIEW_FIELD_PATHS.map((p) => `- ${p}`).join("\n"),
    "",
    "Map the reply onto fields, or ask to clarify. Return the JSON object.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Reply parsing
// ---------------------------------------------------------------------------

/** Strip an optional ```json fence and parse the first JSON object. Throws on failure. */
export function parseJsonObject(raw: string): Record<string, unknown> {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`interview: expected a JSON object from Claude, got: ${raw.slice(0, 200)}`);
  }
  const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("interview: Claude reply was not a JSON object");
  }
  return parsed as Record<string, unknown>;
}

const FIELD_UPDATE_KINDS: readonly FieldUpdateKind[] = ["number", "string", "boolean", "date"];

/** Coerce a raw `updates` array from Claude into typed {@link FieldUpdate}s. */
export function parseFieldUpdates(raw: unknown): FieldUpdate[] {
  if (!Array.isArray(raw)) {
    throw new Error("interview: `updates` must be an array");
  }
  return raw.map((entry, i) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`interview: update[${i}] is not an object`);
    }
    const rec = entry as Record<string, unknown>;
    const path = rec.path;
    const kind = rec.kind;
    const value = rec.value;
    if (typeof path !== "string") {
      throw new Error(`interview: update[${i}].path must be a string`);
    }
    if (typeof kind !== "string" || !(FIELD_UPDATE_KINDS as readonly string[]).includes(kind)) {
      throw new Error(
        `interview: update[${i}].kind must be one of ${FIELD_UPDATE_KINDS.join("|")}`,
      );
    }
    if (
      value !== null &&
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
      throw new Error(`interview: update[${i}].value must be a scalar or null`);
    }
    return { path, kind: kind as FieldUpdateKind, value };
  });
}

/** Coerce a raw `outOfScope` array from Claude into known {@link ScopeCode}s (unknown codes dropped). */
export function parseScopeCodes(raw: unknown): ScopeCode[] {
  if (!Array.isArray(raw)) return [];
  const known = new Set<string>(SCOPE_CODES);
  return raw.filter((c): c is ScopeCode => typeof c === "string" && known.has(c));
}
