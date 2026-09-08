"use server";

import { redirect } from "next/navigation";

import type { ReturnModel } from "@aus-tax-lodge/model";

import { getClaudeClient } from "../../../lib/ai/client";
import {
  confirmFieldAtPath,
  editFieldAtPath,
  firstUnresolvedConfirmation,
  recomputePendingConfirmations,
} from "../../../lib/confirmations";
import {
  appendTurn,
  emptyConversation,
  type ConversationState,
  type PendingConfirmation,
} from "../../../lib/conversation";
import { confirmProposedIncome } from "../../../lib/income-summary";
import { applyUserTurn, nextTurn } from "../../../lib/interview";
import { applyInterviewStep } from "../../../lib/interview-loop";
import {
  ConversationReadOnlyError,
  getReturnRepository,
  loadConversation,
  saveConversation,
  type LoadedConversation,
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
  review:
    "We're at the review stage now — use the review summary above to approve or reopen a line.",
  exported:
    "This return's lodgement package is already built, so there's nothing left to change here.",
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
  // Recompute which figures are still doubtful (PRD FR-5) after the update, so
  // `nextTurn` can raise a `confirm-figure` card and T8's review reads it.
  const pendingConfirmations = recomputePendingConfirmations(
    nextModel,
    conversation.pendingConfirmations,
  );
  const withUserPending: ConversationState = { ...withUser, pendingConfirmations };

  let step: Awaited<ReturnType<typeof nextTurn>>;
  try {
    step = await nextTurn({ model: nextModel, conversation: withUserPending, client });
  } catch {
    return persist(
      appendTurn(withUserPending, {
        role: "assistant",
        kind: "message",
        text: "I've noted that — send another message and I'll carry on with the next question.",
      }),
      nextModel,
    );
  }

  return persist(
    applyInterviewStep(withUserPending, step, { model: nextModel, pendingConfirmations }),
    nextModel,
  );
}

// ---------------------------------------------------------------------------
// Inline card actions (PRD FR-5) — the income checkpoint + a flagged figure
// ---------------------------------------------------------------------------

/** Income figures the "Something's off" flow may correct inline. */
const INCOME_CORRECTION_PATH =
  /^income\.(salaryWages\[\d+\]\.(grossSalaryWages|paygWithheld)|interestAccounts\[\d+\]\.grossInterest|dividends\[\d+\]\.(unfranked|franked|frankingCredits)|governmentAllowances)$/;

/** One inline income correction from the income-checkpoint card. */
export interface IncomeCorrection {
  readonly modelPath: string;
  readonly value: number;
}

/** The user's decision on one `confirm-figure` card. */
export interface ResolveConfirmationInput {
  /** `true` = "Yes, that's right"; `false` = "Edit" with {@link value}. */
  readonly accept: boolean;
  /** The corrected value — required when `accept` is `false`. */
  readonly value?: number;
}

type CardGate = { readonly loaded: LoadedConversation } | { readonly error: SendMessageResult };

/** Load a return for a card write and check it is an editable, in-interview return. */
async function loadForCard(returnId: string): Promise<CardGate> {
  let loaded: LoadedConversation;
  try {
    loaded = await loadConversation(returnId);
  } catch {
    return {
      error: {
        conversation: emptyConversation(),
        revision: 0,
        error: "Couldn't load this return. Reload the page and try again.",
      },
    };
  }
  if (loaded.readOnly) {
    return {
      error: {
        conversation: loaded.conversation,
        revision: loaded.envelope.revision,
        error: "This return is locked and can't be changed.",
      },
    };
  }
  if (loaded.conversation.phase !== "interview") {
    return {
      error: {
        conversation: loaded.conversation,
        revision: loaded.envelope.revision,
        error: "That step isn't available right now.",
      },
    };
  }
  return { loaded };
}

/** Persist a card's resulting conversation + model, handling read-only + conflict. */
async function persistCardTurn(
  returnId: string,
  expectedRevision: number,
  loaded: LoadedConversation,
  next: ConversationState,
  model: ReturnModel,
): Promise<SendMessageResult> {
  let result: Awaited<ReturnType<typeof saveConversation>>;
  try {
    result = await saveConversation(returnId, { model, conversation: next, expectedRevision });
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

/**
 * Shared tail of every card action: recompute the flagged figures (PRD FR-5),
 * ask `nextTurn` for the assistant's next move, fold it into the transcript and
 * persist. `base` already carries the card-response turn (and any `resolved`
 * updates on `pendingConfirmations`).
 */
async function advanceInterview(
  returnId: string,
  expectedRevision: number,
  loaded: LoadedConversation,
  base: ConversationState,
  model: ReturnModel,
): Promise<SendMessageResult> {
  const pendingConfirmations = recomputePendingConfirmations(model, base.pendingConfirmations);
  const withPending: ConversationState = { ...base, pendingConfirmations };
  const client = getClaudeClient();

  let step: Awaited<ReturnType<typeof nextTurn>>;
  try {
    step = await nextTurn({ model, conversation: withPending, client });
  } catch {
    return persistCardTurn(
      returnId,
      expectedRevision,
      loaded,
      appendTurn(withPending, {
        role: "assistant",
        kind: "message",
        text: "Got it — send another message and I'll carry on with the next question.",
      }),
      model,
    );
  }

  return persistCardTurn(
    returnId,
    expectedRevision,
    loaded,
    applyInterviewStep(withPending, step, { model, pendingConfirmations }),
    model,
  );
}

/**
 * "Looks right" on the income checkpoint (PRD FR-5, checkpoint 1): bulk-confirm
 * every proposed income figure, record the card response, and carry on.
 */
export async function confirmIncome(
  returnId: string,
  expectedRevision: number,
  cardId: string,
): Promise<SendMessageResult> {
  const gate = await loadForCard(returnId);
  if ("error" in gate) return gate.error;
  const { loaded } = gate;

  const model = confirmProposedIncome(loaded.model);
  const base = appendTurn(loaded.conversation, {
    role: "user",
    kind: "card-response",
    cardId,
    response: { ok: true },
  });
  return advanceInterview(returnId, expectedRevision, loaded, base, model);
}

/**
 * "Something's off" on the income checkpoint (PRD FR-5): `edit()` each corrected
 * line (original kept visible), accept the rest, and record the response. Each
 * corrected figure lands `user-corrected` in `pendingConfirmations` for the
 * final review. With no specific corrections it just tells the assistant so it
 * can ask which line in the chat.
 */
export async function correctIncome(
  returnId: string,
  expectedRevision: number,
  cardId: string,
  corrections: readonly IncomeCorrection[],
): Promise<SendMessageResult> {
  const gate = await loadForCard(returnId);
  if ("error" in gate) return gate.error;
  const { loaded } = gate;

  const valid = corrections.filter(
    (c) => INCOME_CORRECTION_PATH.test(c.modelPath) && Number.isFinite(c.value),
  );

  if (valid.length === 0) {
    const base = appendTurn(loaded.conversation, {
      role: "user",
      kind: "message",
      text: "Something's off with my income.",
    });
    return advanceInterview(returnId, expectedRevision, loaded, base, loaded.model);
  }

  let model = loaded.model;
  try {
    for (const correction of valid) {
      model = editFieldAtPath(model, correction.modelPath, correction.value);
    }
  } catch {
    return {
      conversation: loaded.conversation,
      revision: loaded.envelope.revision,
      error: "I couldn't apply that change — try again.",
    };
  }
  model = confirmProposedIncome(model);

  const base = appendTurn(loaded.conversation, {
    role: "user",
    kind: "card-response",
    cardId,
    response: { ok: false, corrections: valid },
  });
  return advanceInterview(returnId, expectedRevision, loaded, base, model);
}

/**
 * Resolve one `confirm-figure` card (PRD FR-5, between the checkpoints): `Yes`
 * confirms the figure, `Edit` writes the new value (original kept). The
 * matching {@link PendingConfirmation} is marked `resolved`.
 */
export async function resolveConfirmation(
  returnId: string,
  expectedRevision: number,
  cardId: string,
  confirmationId: string,
  input: ResolveConfirmationInput,
): Promise<SendMessageResult> {
  const gate = await loadForCard(returnId);
  if ("error" in gate) return gate.error;
  const { loaded } = gate;

  if (!input.accept && !Number.isFinite(input.value)) {
    return {
      conversation: loaded.conversation,
      revision: loaded.envelope.revision,
      error: "Enter a number to correct that figure.",
    };
  }

  const confirmations = loaded.conversation.pendingConfirmations;
  const target =
    confirmations.find((c) => c.id === confirmationId) ??
    firstUnresolvedConfirmation(confirmations);
  if (!target) {
    return {
      conversation: loaded.conversation,
      revision: loaded.envelope.revision,
      error: "That figure isn't waiting for confirmation any more.",
    };
  }

  const newValue = input.accept ? target.value : Number(input.value);
  let model = loaded.model;
  try {
    model = input.accept
      ? confirmFieldAtPath(model, target.modelPath)
      : editFieldAtPath(model, target.modelPath, newValue as number);
  } catch {
    return {
      conversation: loaded.conversation,
      revision: loaded.envelope.revision,
      error: "I couldn't apply that just now — try again.",
    };
  }

  const resolved: PendingConfirmation[] = confirmations.map((c) =>
    c.id === target.id ? { ...c, resolved: true, value: newValue } : c,
  );
  const base: ConversationState = {
    ...appendTurn(loaded.conversation, {
      role: "user",
      kind: "card-response",
      cardId,
      response: { confirmationId: target.id, accepted: input.accept, value: newValue },
    }),
    pendingConfirmations: resolved,
  };
  return advanceInterview(returnId, expectedRevision, loaded, base, model);
}

// ---------------------------------------------------------------------------
// Out-of-scope hard stop (PRD FR-9, FR-20) — the only way out of the chat
// ---------------------------------------------------------------------------

/**
 * Permanently delete a return and its documents, then send the user home
 * (PRD FR-9, FR-20). Invoked from the `out-of-scope` card — a hard-stopped
 * conversation offers this and a pointer to ATO myTax / a registered tax agent,
 * and nothing else. The store's `deleteReturn` recursively removes every
 * document and `return.json`.
 *
 * This is the v2 chat tree's own copy — v1's `review/actions.ts`
 * `deleteReturnAction` goes away with the `review/` directory in T11.
 */
export async function deleteReturn(returnId: string): Promise<void> {
  await getReturnRepository().deleteReturn(returnId);
  redirect("/");
}
