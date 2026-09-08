/**
 * `nextTurn` — pick and phrase the assistant's next move (PRD FR-3).
 *
 * Claude is given the return model, the recent transcript and the topic list,
 * and returns a JSON step. When Claude says the interview is `done`, T2
 * **re-checks deterministically**: the interview is complete only when
 * `isReadyForEstimate(model)` is true AND `validateReturn(model)` has no
 * `severity:"error"` issues. If either fails, the `done` is overridden to an
 * `ask` about the first outstanding thing — the deterministic gate decides
 * completeness, not Claude (PRD FR-3).
 */
import { isReadyForEstimate, type ReturnModel } from "@aus-tax-lodge/model";
import { validateReturn } from "@aus-tax-lodge/validation";

import type { CardRef, ConversationState } from "../conversation";
import { readExtractionScratch } from "../extraction-scratch";
import { firstUnresolvedReconciliation } from "../reconciliation";
import {
  buildNextTurnPrompt,
  NEXT_TURN_MAX_TOKENS,
  NEXT_TURN_SYSTEM,
  parseJsonObject,
} from "./prompts";
import { topicsOutstanding } from "./topics";
import type { InterviewClient, InterviewStep } from "./types";

/**
 * The card types `nextTurn` may emit. `out-of-scope` is deliberately **absent**:
 * a scope hard stop is decided deterministically (`detectOutOfScope`, run in
 * `apply-user-turn` and `lib/scope-check`), never by Claude. A Claude reply
 * naming `"out-of-scope"` fails `parseStep` and is caught → safe fallback,
 * rather than producing a card without `phase:"stopped"` (PRD FR-9, FR-20).
 */
const CARD_REFS: readonly CardRef[] = [
  "upload-prefill",
  "income-checkpoint",
  "confirm-figure",
  "upload-or-tell",
  "reconcile",
  "review-summary",
];

export interface NextTurnInput {
  readonly model: ReturnModel;
  readonly conversation: ConversationState;
  readonly client: InterviewClient;
}

/** Decide the assistant's next move. */
export async function nextTurn(input: NextTurnInput): Promise<InterviewStep> {
  const { model, conversation, client } = input;

  // Deterministic short-circuit (PRD FR-7, following the `deterministicallyComplete`
  // precedent): an unresolved source disagreement blocks progress on that figure
  // exactly like a pending confirmation, and which source is right is the user's
  // call — never Claude's and never a silent default. Raise the `reconcile` card
  // before spending a Claude turn.
  if (firstUnresolvedReconciliation(readExtractionScratch(model))) {
    return { kind: "card", card: "reconcile" };
  }

  const raw = await client.ask(buildNextTurnPrompt(model, conversation), {
    system: NEXT_TURN_SYSTEM,
    maxTokens: NEXT_TURN_MAX_TOKENS,
  });
  const step = parseStep(parseJsonObject(raw));

  if (step.kind === "done" && !deterministicallyComplete(model)) {
    return { kind: "ask", text: firstOutstandingQuestion(model) };
  }
  return step;
}

/** The FR-3 completeness gate — both checks must pass. */
export function deterministicallyComplete(model: ReturnModel): boolean {
  if (!isReadyForEstimate(model)) return false;
  return !validateReturn(model).some((issue) => issue.severity === "error");
}

function parseStep(obj: Record<string, unknown>): InterviewStep {
  const kind = obj.kind;
  switch (kind) {
    case "ask":
    case "say": {
      if (typeof obj.text !== "string" || obj.text.trim() === "") {
        throw new Error(`interview: a "${kind}" step needs non-empty text`);
      }
      return { kind, text: obj.text.trim() };
    }
    case "card": {
      const card = obj.card;
      if (typeof card !== "string" || !(CARD_REFS as readonly string[]).includes(card)) {
        throw new Error(`interview: unknown card type ${JSON.stringify(card)}`);
      }
      const text =
        typeof obj.text === "string" && obj.text.trim() !== "" ? obj.text.trim() : undefined;
      return text
        ? { kind: "card", card: card as CardRef, text }
        : { kind: "card", card: card as CardRef };
    }
    case "done":
      return { kind: "done" };
    default:
      throw new Error(`interview: unknown step kind ${JSON.stringify(kind)}`);
  }
}

/** A plain question about the first thing the deterministic gate says is missing. */
function firstOutstandingQuestion(model: ReturnModel): string {
  const topics = topicsOutstanding(model);
  if (topics.length > 0) {
    return `Before I can finish, there's still one thing to sort out: ${topics[0]}. Can you tell me about that?`;
  }
  const firstError = validateReturn(model).find((issue) => issue.severity === "error");
  if (firstError) {
    return `Before I can finish, I need to resolve this: ${firstError.message}`;
  }
  // Unreachable while `deterministicallyComplete` is false, but keep it total.
  return "Before I can finish, there's still something outstanding on the return — can you tell me a bit more about your situation?";
}
