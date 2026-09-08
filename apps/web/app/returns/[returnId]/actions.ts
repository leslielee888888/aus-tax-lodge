"use server";

import type { ReturnModel } from "@aus-tax-lodge/model";

import { getClaudeClient } from "../../../lib/ai/client";
import {
  appendTurn,
  emptyConversation,
  type ConversationState,
} from "../../../lib/conversation";
import { applyUserTurn, nextTurn } from "../../../lib/interview";
import { applyInterviewStep } from "../../../lib/interview-loop";
import {
  ConversationReadOnlyError,
  loadConversation,
  saveConversation,
} from "../../../lib/returns";

/**
 * The chat's send round-trip (PRD FR-1, FR-3, FR-4, FR-9, FR-12).
 *
 * `loadConversation` is the source of truth — the client-supplied conversation
 * is ignored; `expectedRevision` drives last-write-wins conflict detection.
 * What happens to the typed message depends on `conversation.phase`:
 *
 * - **`interview`** — run the interview loop: `applyUserTurn` maps the reply to
 *   fields, then either an out-of-scope hard stop (`phase:"stopped"`, the model
 *   is NOT persisted past the stop), a clarifying follow-up (model unchanged),
 *   or `nextTurn` picks the assistant's next move (T2). `done` → `phase:"review"`.
 * - **`upload`** — the user typed instead of uploading: nudge them to the drop
 *   zone.
 * - **`stopped` / `review` / `exported`** — the chat isn't taking free input;
 *   say so.
 *
 * A Claude/scope throw is caught and turned into a plain "try again" message
 * with the confirmed model untouched — T10 hardens this further.
 */

const PROBLEM_REPLY =
  "I hit a problem working through that just now — send it again and I'll pick it back up.";

const PHASE_CLOSED_REPLY: Partial<Record<ConversationState["phase"], string>> = {
  review: "We're at the review stage now — use the review summary above to approve or reopen a line.",
  exported: "This return's lodgement package is already built, so there's nothing left to change here.",
  stopped: "This conversation has stopped and can't continue.",
};

export interface SendMessageResult {
  /** The conversation to render now — the saved one on success, the server's current one otherwise. */
  readonly conversation: ConversationState;
  /** The revision the caller should send with its next {@link sendMessage}. */
  readonly revision: number;
  /** The save was refused because the return changed elsewhere (last-write-wins). */
  readonly conflict?: boolean;
  /** A plain-language problem to show inline; the conversation is unchanged. */
  readonly error?: string;
}

export async function sendMessage(
  returnId: string,
  expectedRevision: number,
  text: string,
): Promise<SendMessageResult> {
  const trimmed = text.trim();

  let loaded: Awaited<ReturnType<typeof loadConversation>>;
  try {
    loaded = await loadConversation(returnId);
  } catch {
    return {
      conversation: emptyConversation(),
      revision: expectedRevision,
      error: "Couldn't load this return. Reload the page and try again.",
    };
  }

  if (!trimmed) {
    return {
      conversation: loaded.conversation,
      revision: loaded.envelope.revision,
      error: "Type a message first.",
    };
  }

  if (loaded.readOnly) {
    return {
      conversation: loaded.conversation,
      revision: loaded.envelope.revision,
      error: "This return is locked and can't be changed.",
    };
  }

  const { conversation, model } = loaded;
  const withUser = appendTurn(conversation, { role: "user", kind: "message", text: trimmed });

  /** Persist `next` (+ `nextModel`) and shape the result, handling read-only + conflict. */
  const persist = async (
    next: ConversationState,
    nextModel: ReturnModel,
  ): Promise<SendMessageResult> => {
    let result: Awaited<ReturnType<typeof saveConversation>>;
    try {
      result = await saveConversation(returnId, {
        model: nextModel,
        conversation: next,
        expectedRevision,
      });
    } catch (error) {
      if (error instanceof ConversationReadOnlyError) {
        return {
          conversation,
          revision: loaded.envelope.revision,
          error: "This return is locked and can't be changed.",
        };
      }
      throw error;
    }

    if (result.conflict) {
      const fresh = await loadConversation(returnId);
      return {
        conversation: fresh.conversation,
        revision: fresh.envelope.revision,
        conflict: true,
        error: "This return changed in another tab — reload to see the latest version.",
      };
    }

    return { conversation: next, revision: result.envelope.revision };
  };

  // --- Not the interview: a short, phase-appropriate reply --------------------
  if (conversation.phase !== "interview") {
    const reply =
      conversation.phase === "upload"
        ? "Before we start, I need your ATO pre-fill report — upload it with the panel above. " +
          "You can get it from myGov → ATO → Tax → Lodgments → Income tax → Pre-fill."
        : (PHASE_CLOSED_REPLY[conversation.phase] ??
          "The conversation isn't taking free input right now.");
    return persist(
      appendTurn(withUser, { role: "assistant", kind: "message", text: reply }),
      model,
    );
  }

  // --- The interview loop ----------------------------------------------------
  const client = getClaudeClient();

  let applied: Awaited<ReturnType<typeof applyUserTurn>>;
  try {
    applied = await applyUserTurn({ model, conversation, text: trimmed, client });
  } catch {
    return persist(
      appendTurn(withUser, { role: "assistant", kind: "message", text: PROBLEM_REPLY }),
      model,
    );
  }

  if (applied.outOfScope && applied.outOfScope.length > 0) {
    const findings = applied.outOfScope;
    let stopped = appendTurn(withUser, {
      role: "assistant",
      kind: "card",
      card: { type: "out-of-scope", payload: { findings } },
    });
    stopped = { ...stopped, phase: "stopped", stoppedReason: findings[0]!.item };
    // The model is NOT persisted past the stop (PRD FR-9) — save the loaded one.
    return persist(stopped, model);
  }

  if (applied.clarify) {
    return persist(
      appendTurn(withUser, { role: "assistant", kind: "message", text: applied.clarify }),
      model, // unchanged on a clarify
    );
  }

  const nextModel = applied.model;
  let step: Awaited<ReturnType<typeof nextTurn>>;
  try {
    step = await nextTurn({ model: nextModel, conversation: withUser, client });
  } catch {
    return persist(
      appendTurn(withUser, {
        role: "assistant",
        kind: "message",
        text: "I've noted that — send another message and I'll carry on with the next question.",
      }),
      nextModel,
    );
  }

  return persist(applyInterviewStep(withUser, step), nextModel);
}
