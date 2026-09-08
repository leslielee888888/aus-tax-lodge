"use server";

import { appendTurn, emptyConversation, type ConversationState } from "../../../lib/conversation";
import {
  ConversationReadOnlyError,
  loadConversation,
  saveConversation,
} from "../../../lib/returns";

/**
 * T3 stub. Proves the append → persist → re-render round-trip end to end.
 *
 * T4 replaces the placeholder assistant turn below with the real
 * `nextTurn(model, conversation, deps)` call from `lib/interview/**` (T2): same
 * shape — load, append the user turn, produce the assistant turn(s), save.
 */
const PLACEHOLDER_ASSISTANT_REPLY = "(the interview agent responds here — wired in T4)";

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

/**
 * Append the user's message and a placeholder assistant reply, then persist
 * (PRD FR-1, FR-12). Reads the current stored conversation rather than trusting
 * a client-supplied one; `expectedRevision` drives conflict detection.
 */
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

  let next = appendTurn(loaded.conversation, { role: "user", kind: "message", text: trimmed });
  next = appendTurn(next, {
    role: "assistant",
    kind: "message",
    text: PLACEHOLDER_ASSISTANT_REPLY,
  });

  let result: Awaited<ReturnType<typeof saveConversation>>;
  try {
    result = await saveConversation(returnId, {
      model: loaded.model,
      conversation: next,
      expectedRevision,
    });
  } catch (error) {
    if (error instanceof ConversationReadOnlyError) {
      return {
        conversation: loaded.conversation,
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
}
