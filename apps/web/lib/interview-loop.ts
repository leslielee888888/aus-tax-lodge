import type { InterviewStep } from "./interview";
import { appendTurn, type ConversationState } from "./conversation";

/**
 * Fold one {@link InterviewStep} (from `nextTurn`, T2) into the conversation
 * transcript (PRD FR-3, §7). Shared by both entry points that run the interview
 * loop — the `sendMessage` server action (a typed reply) and the `prefill`
 * route (straight after the pre-fill upload) — so the step → turn mapping lives
 * in exactly one place:
 *
 * - `ask` / `say` → a plain assistant message the user answers in the composer.
 * - `card` → an assistant card turn; `step.text` (if any) rides along as
 *   `payload.lead`, which {@link import("./conversation").AssistantCard} renders
 *   above the card body. T5–T8 own each card's real payload shape.
 * - `done` → the interview is complete: move to the `review` phase and drop in
 *   the `review-summary` card (T8 gives it a body).
 *
 * Pure — returns a new state, never mutates the input.
 */
export function applyInterviewStep(
  conversation: ConversationState,
  step: InterviewStep,
): ConversationState {
  switch (step.kind) {
    case "ask":
    case "say":
      return appendTurn(conversation, { role: "assistant", kind: "message", text: step.text });
    case "card":
      return appendTurn(conversation, {
        role: "assistant",
        kind: "card",
        card: {
          type: step.card,
          payload: step.text ? { lead: step.text } : {},
        },
      });
    case "done":
      return appendTurn(
        { ...conversation, phase: "review" },
        { role: "assistant", kind: "card", card: { type: "review-summary", payload: {} } },
      );
  }
}
