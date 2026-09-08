import type { ReturnModel } from "@aus-tax-lodge/model";

import { firstUnresolvedConfirmation } from "./confirmations";
import { appendTurn, type ConversationState, type PendingConfirmation } from "./conversation";
import { readExtractionScratch } from "./extraction-scratch";
import { incomeCheckpointLines } from "./income-summary";
import type { InterviewStep } from "./interview";
import { firstUnresolvedReconciliation } from "./reconciliation";

/**
 * Extra context {@link applyInterviewStep} needs to build a card's real payload
 * (PRD FR-5) — the card components only ever get `CardProps`, never the model,
 * so a card's data has to be baked into its turn here:
 *
 * - `income-checkpoint` → `{ lines }` from {@link incomeCheckpointLines}.
 * - `confirm-figure` → `{ confirmation }`, the first unresolved
 *   {@link PendingConfirmation}.
 * - `reconcile` (T6) → `{ reconciliation }`, the first unresolved
 *   {@link import("@aus-tax-lodge/extraction").PendingReconciliation} from the
 *   `__t16Extraction` scratch on `context.model`.
 * - `upload-or-tell` (T6) → nothing beyond `payload.lead` (the assistant's lead
 *   text is the whole ask).
 *
 * Optional so the three call sites (the `sendMessage` action, the `prefill`
 * route and the `interview-document` route) pass only what they have; a `done`
 * step or a plain `ask` / `say` needs none of it.
 */
export interface InterviewStepContext {
  readonly model?: ReturnModel;
  readonly pendingConfirmations?: readonly PendingConfirmation[];
}

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
 *   above the card body. `income-checkpoint` / `confirm-figure` additionally
 *   carry their card data from `context`; T6–T8 own the other card payloads.
 * - `done` → the interview is complete: move to the `review` phase and drop in
 *   the `review-summary` card (T8 gives it a body).
 *
 * Pure — returns a new state, never mutates the input.
 */
export function applyInterviewStep(
  conversation: ConversationState,
  step: InterviewStep,
  context: InterviewStepContext = {},
): ConversationState {
  switch (step.kind) {
    case "ask":
    case "say":
      return appendTurn(conversation, { role: "assistant", kind: "message", text: step.text });
    case "card": {
      // A scope hard stop is deterministic (`detectOutOfScope`), never Claude's
      // call — `nextTurn`'s `CARD_REFS` no longer lists `out-of-scope`, so this
      // branch is unreachable for that type. Guard anyway: an `out-of-scope`
      // card here would render a hard stop WITHOUT `phase:"stopped"`, leaving
      // the composer live (PRD FR-9). Fall through to a no-op instead.
      if (step.card === "out-of-scope") return conversation;
      const payload: Record<string, unknown> = step.text ? { lead: step.text } : {};
      if (step.card === "income-checkpoint") {
        payload.lines = context.model ? incomeCheckpointLines(context.model) : [];
      } else if (step.card === "confirm-figure") {
        payload.confirmation = firstUnresolvedConfirmation(context.pendingConfirmations ?? []);
      } else if (step.card === "reconcile") {
        // T6: the first unresolved source disagreement from T16's scratch — the
        // card names both values + sources and asks which is right (PRD FR-7).
        payload.reconciliation = context.model
          ? firstUnresolvedReconciliation(readExtractionScratch(context.model))
          : null;
      }
      // `upload-or-tell` (T6) needs nothing beyond `payload.lead` — the assistant's
      // lead text is the whole ask (one topic, two paths; never a checklist).
      return appendTurn(conversation, {
        role: "assistant",
        kind: "card",
        card: { type: step.card, payload },
      });
    }
    case "done":
      return appendTurn(
        { ...conversation, phase: "review" },
        { role: "assistant", kind: "card", card: { type: "review-summary", payload: {} } },
      );
  }
}
