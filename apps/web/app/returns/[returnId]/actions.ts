"use server";

import { redirect } from "next/navigation";

import type { ReturnModel } from "@aus-tax-lodge/model";

import { resolveReconciliation } from "@aus-tax-lodge/extraction";
import { buildLodgeInstructionsData } from "@aus-tax-lodge/export";

import { getClaudeClient } from "../../../lib/ai/client";
import { classifyConversationFailure, type ConversationFailure } from "../../../lib/ai/failure";
import { maybeRunningEstimate } from "../../../lib/estimate/running-estimate";
import {
  acknowledgeWarnings,
  readAcknowledgedWarningIds,
} from "../../../lib/export/acknowledgements";
import { MIN_ARCHIVE_PASSWORD_LENGTH } from "../../../lib/export/archive";
import { buildExportInput, loadExportContext } from "../../../lib/export/context";
import { computeExportGate } from "../../../lib/export/gate";
import { markReturnExported } from "../../../lib/export/persist";
import { topicsOutstanding } from "../../../lib/interview/topics";
import {
  reopenQuestionFor,
  reviewSummaryForModel,
  type ReviewSummary,
} from "../../../lib/review-summary";
import {
  confirmFieldAtPath,
  editFieldAtPath,
  firstUnresolvedConfirmation,
  recomputePendingConfirmations,
} from "../../../lib/confirmations";
import {
  mergePendingReconciliation,
  readExtractionScratch,
  withExtractionScratch,
} from "../../../lib/extraction-scratch";
import {
  appendTurn,
  emptyConversation,
  type AssistantCardTurn,
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
 * A Claude / scope-check / extraction throw is caught and classified by
 * {@link classifyConversationFailure} (FR-14) into a plain assistant message —
 * the confirmed model is persisted **unchanged**, so nothing proceeds as if a
 * failed step succeeded, and the user retries the step. A rate limit (429) is a
 * resumable pause: the exchange is still recorded, {@link SendMessageResult}
 * carries `rateLimited` so the UI shows a calm "paused" note, and the user just
 * resends once the limit clears.
 */

const RATE_LIMIT_INLINE_NOTE =
  "Paused — Claude's usage limit. Your progress is saved. Resend your message in a little while.";

const REVIEW_CANNED_REPLY =
  "We're at the review stage — use the summary above to approve your return or reopen a line. " +
  "If a figure is wrong, tell me the corrected number and I'll rebuild the summary.";

/**
 * {@link maybeRunningEstimate} re-throws an unexpected engine error; the chat
 * round-trip must never 500 on it (T10 hardens this generally). A `null` here
 * just routes the message through the normal flow.
 */
function safeRunningEstimate(model: ReturnModel, text: string): string | null {
  try {
    return maybeRunningEstimate(model, text);
  } catch {
    return null;
  }
}

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
  /**
   * FR-14 — the step hit Claude's rate limit. A resumable pause, distinct from a
   * hard error: the exchange is still recorded, the phase is unchanged, and the
   * user just resends shortly. The UI styles this as a calm "paused" note.
   */
  readonly rateLimited?: boolean;
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

  const say = (next: ConversationState, text: string): ConversationState =>
    appendTurn(next, { role: "assistant", kind: "message", text });

  /**
   * Persist a failed step (FR-14): the assistant's plain message is already on
   * `next`, and `failModel` is the pre-attempt model — persisted unchanged so
   * nothing proceeds as if the step succeeded. A rate limit also surfaces the
   * inline "paused" note + `rateLimited` flag.
   */
  const persistFailure = async (
    next: ConversationState,
    failModel: ReturnModel,
    failure: ConversationFailure,
  ): Promise<SendMessageResult> => {
    const result = await persist(next, failModel);
    if (result.conflict || !failure.resumablePause) return result;
    return { ...result, error: RATE_LIMIT_INLINE_NOTE, rateLimited: true };
  };

  // --- Review phase: a running-estimate question or a free-text correction ---
  // (PRD FR-10, FR-11). A clear correction re-issues the whole-return summary;
  // anything else points back to the summary already on screen.
  if (conversation.phase === "review") {
    const running = safeRunningEstimate(model, trimmed);
    if (running) return persist(say(withUser, running), model);

    const client = getClaudeClient();
    let applied: Awaited<ReturnType<typeof applyUserTurn>>;
    try {
      applied = await applyUserTurn({ model, conversation, text: trimmed, client });
    } catch (err) {
      const failure = classifyConversationFailure(err, { step: "answer" });
      return persistFailure(say(withUser, failure.assistantMessage), model, failure);
    }

    if (applied.outOfScope && applied.outOfScope.length > 0) {
      const findings = applied.outOfScope;
      const stopped: ConversationState = {
        ...appendTurn(withUser, {
          role: "assistant",
          kind: "card",
          card: { type: "out-of-scope", payload: { findings } },
        }),
        phase: "stopped",
        stoppedReason: findings[0]!.item,
      };
      // The model is NOT persisted past the stop (PRD FR-9) — save the loaded one.
      return persist(stopped, model);
    }

    if (applied.appliedPaths.length > 0 && !applied.clarify) {
      const nextModel = applied.model;
      let next = say(
        withUser,
        "I've updated that — here's the revised summary of your whole return.",
      );
      next = appendTurn(next, {
        role: "assistant",
        kind: "card",
        card: { type: "review-summary", payload: { summary: reviewSummaryForModel(nextModel) } },
      });
      return persist(next, nextModel);
    }

    return persist(say(withUser, applied.clarify ?? REVIEW_CANNED_REPLY), model);
  }

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
  // A "how's my refund looking?" question is answered from the deterministic
  // engine (PRD FR-10) before any field mapping — Claude never states a figure.
  const running = safeRunningEstimate(model, trimmed);
  if (running) return persist(say(withUser, running), model);

  const client = getClaudeClient();

  let applied: Awaited<ReturnType<typeof applyUserTurn>>;
  try {
    applied = await applyUserTurn({ model, conversation, text: trimmed, client });
  } catch (err) {
    // FR-14 — the answer step (field mapping + scope detection) failed. Persist
    // the loaded model unchanged; the user retries by resending.
    const failure = classifyConversationFailure(err, { step: "answer" });
    return persistFailure(say(withUser, failure.assistantMessage), model, failure);
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
  } catch (err) {
    // FR-14 — `applyUserTurn` succeeded (its field writes stand), but picking the
    // next question failed. Persist the applied model + the plain message; the
    // user resends to get the next question.
    const failure = classifyConversationFailure(err, { step: "answer" });
    return persistFailure(
      appendTurn(withUserPending, {
        role: "assistant",
        kind: "message",
        text: failure.assistantMessage,
      }),
      nextModel,
      failure,
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
 * FR-14 for the card path: persist a failed step's plain message with the
 * pre-attempt `model` unchanged, and flag a rate limit as a resumable pause.
 */
async function persistCardFailure(
  returnId: string,
  expectedRevision: number,
  loaded: LoadedConversation,
  next: ConversationState,
  model: ReturnModel,
  failure: ConversationFailure,
): Promise<SendMessageResult> {
  const result = await persistCardTurn(returnId, expectedRevision, loaded, next, model);
  if (result.conflict || !failure.resumablePause) return result;
  return { ...result, error: RATE_LIMIT_INLINE_NOTE, rateLimited: true };
}

/** A card-action failure that is shown inline only — the conversation is untouched. */
function cardInlineFailure(
  loaded: LoadedConversation,
  failure: ConversationFailure,
): SendMessageResult {
  return {
    conversation: loaded.conversation,
    revision: loaded.envelope.revision,
    error: failure.resumablePause ? RATE_LIMIT_INLINE_NOTE : failure.assistantMessage,
    ...(failure.resumablePause ? { rateLimited: true } : {}),
  };
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
  } catch (err) {
    // FR-14 — the card's write already stands on `model`; only picking the next
    // question failed. Persist the plain message + `model` unchanged.
    const failure = classifyConversationFailure(err, { step: "card" });
    return persistCardFailure(
      returnId,
      expectedRevision,
      loaded,
      appendTurn(withPending, {
        role: "assistant",
        kind: "message",
        text: failure.assistantMessage,
      }),
      model,
      failure,
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
  } catch (err) {
    return cardInlineFailure(loaded, classifyConversationFailure(err, { step: "card" }));
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
  } catch (err) {
    return cardInlineFailure(loaded, classifyConversationFailure(err, { step: "card" }));
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
// Mid-conversation documents (PRD FR-6, FR-7) — the `upload-or-tell` +
// `reconcile` cards T6 owns. The document upload itself is the
// `/api/returns/:id/interview-document` route; these handle the card buttons.
// ---------------------------------------------------------------------------

/**
 * "I'll just tell you" on an `upload-or-tell` card (PRD FR-6): the user would
 * rather type the figure than drop a document. Record the choice and hand the
 * turn back to the composer with a short nudge — `applyUserTurn` maps whatever
 * they type onto the right field via the allow-list. The interview is **not**
 * advanced here (that would re-ask); the user's next message drives it.
 */
export async function tellFigureInstead(
  returnId: string,
  expectedRevision: number,
  cardId: string,
): Promise<SendMessageResult> {
  const gate = await loadForCard(returnId);
  if ("error" in gate) return gate.error;
  const { loaded } = gate;

  const base = appendTurn(loaded.conversation, {
    role: "user",
    kind: "card-response",
    cardId,
    response: { tell: true },
  });
  const next = appendTurn(base, {
    role: "assistant",
    kind: "message",
    text: "No problem — type the figure here and I'll use that.",
  });
  return persistCardTurn(returnId, expectedRevision, loaded, next, loaded.model);
}

/**
 * A pick on a `reconcile` card (PRD FR-7): the user has chosen which source is
 * right for a figure two documents disagreed on. `resolveReconciliation`
 * applies the chosen candidate's value via `propose()` against its own
 * document origin (still confirmed later like any figure); the entry is removed
 * from the `__t16Extraction` scratch and the interview carries on.
 */
export async function resolveReconcile(
  returnId: string,
  expectedRevision: number,
  cardId: string,
  modelPath: string,
  chosenIndex: number,
): Promise<SendMessageResult> {
  const gate = await loadForCard(returnId);
  if ("error" in gate) return gate.error;
  const { loaded } = gate;

  if (!Number.isInteger(chosenIndex) || chosenIndex < 0) {
    return {
      conversation: loaded.conversation,
      revision: loaded.envelope.revision,
      error: "Pick one of the values to continue.",
    };
  }

  const scratch = readExtractionScratch(loaded.model);
  const target = scratch.pendingReconciliation.find((p) => p.modelPath === modelPath);
  if (!target || target.candidates[chosenIndex] === undefined) {
    return {
      conversation: loaded.conversation,
      revision: loaded.envelope.revision,
      error: "That disagreement isn't waiting to be resolved any more.",
    };
  }

  let model: ReturnModel;
  try {
    const { model: resolvedModel, unresolved } = resolveReconciliation(
      loaded.model,
      scratch.pendingReconciliation,
      [{ modelPath, chosenIndex }],
    );
    model = withExtractionScratch(resolvedModel, {
      ...scratch,
      pendingReconciliation: mergePendingReconciliation([], unresolved),
    });
  } catch (err) {
    return cardInlineFailure(loaded, classifyConversationFailure(err, { step: "card" }));
  }

  const base = appendTurn(loaded.conversation, {
    role: "user",
    kind: "card-response",
    cardId,
    response: { modelPath, chosenIndex },
  });
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

// ---------------------------------------------------------------------------
// The whole-return review checkpoint (PRD FR-5, FR-10, FR-11) — the
// `review-summary` card's two controls: reopen one line, or approve + export.
// ---------------------------------------------------------------------------

/** A rejected review line → a matcher for the `pendingConfirmation`s it should re-open. */
const REOPEN_LINE_MATCHERS: Readonly<Record<string, RegExp>> = {
  "salary-wages": /^income\.salaryWages/,
  "payg-withheld": /paygWithheld/,
  interest: /^income\.interestAccounts/,
  dividends: /^income\.dividends/,
  "government-allowances": /governmentAllowances/i,
  rental: /^rental\./,
  deductions: /^deductions\./,
  "private-health": /^privateHealth\./,
};

function reviewSummaryFromCard(
  conversation: ConversationState,
  cardId: string,
): ReviewSummary | null {
  const card = conversation.turns.find(
    (t): t is AssistantCardTurn => t.role === "assistant" && t.kind === "card" && t.id === cardId,
  );
  const payload = card?.card.payload;
  if (!payload || typeof payload !== "object") return null;
  const summary = (payload as { summary?: unknown }).summary;
  return summary && typeof summary === "object" ? (summary as ReviewSummary) : null;
}

/**
 * "That's not right" on one review line (PRD FR-5): drop back to the interview,
 * record the rejection, ask about that line again, and loosen any matching
 * `pendingConfirmation` so it is re-checked. The interview is **not** advanced
 * here — the assistant has asked its question and the user's next message
 * drives it (mirrors {@link tellFigureInstead}); advancing would let a still
 * deterministically-complete model bounce straight back to a fresh summary.
 */
export async function reopenLine(
  returnId: string,
  expectedRevision: number,
  cardId: string,
  lineKey: string,
): Promise<SendMessageResult> {
  let loaded: LoadedConversation;
  try {
    loaded = await loadConversation(returnId);
  } catch {
    return {
      conversation: emptyConversation(),
      revision: 0,
      error: "Couldn't load this return. Reload the page and try again.",
    };
  }
  if (loaded.readOnly) {
    return {
      conversation: loaded.conversation,
      revision: loaded.envelope.revision,
      error: "This return is locked and can't be changed.",
    };
  }
  if (loaded.conversation.phase !== "review") {
    return {
      conversation: loaded.conversation,
      revision: loaded.envelope.revision,
      error: "There's nothing to reopen — the review isn't open.",
    };
  }

  const summary = reviewSummaryFromCard(loaded.conversation, cardId);
  const label = summary?.lines.find((l) => l.lineKey === lineKey)?.label ?? lineKey;

  const matcher = REOPEN_LINE_MATCHERS[lineKey];
  const pendingConfirmations = matcher
    ? loaded.conversation.pendingConfirmations.map((c) =>
        matcher.test(c.modelPath) ? { ...c, resolved: false } : c,
      )
    : loaded.conversation.pendingConfirmations;

  let base: ConversationState = {
    ...loaded.conversation,
    phase: "interview",
    pendingConfirmations,
  };
  base = appendTurn(base, {
    role: "user",
    kind: "card-response",
    cardId,
    response: { rejected: lineKey, lineKey },
  });
  base = appendTurn(base, {
    role: "assistant",
    kind: "message",
    text: reopenQuestionFor(lineKey, label),
  });

  return persistCardTurn(returnId, expectedRevision, loaded, base, loaded.model);
}

/** The result of an {@link approveReturn} attempt (PRD FR-11, FR-14). */
export interface ApproveReturnResult {
  readonly ok: boolean;
  /** Validation warnings must be acknowledged before the package builds. */
  readonly needsWarningAck?: boolean;
  readonly warnings?: readonly { readonly id: string; readonly message: string }[];
  /** Blocking validation errors — the return can't be exported until they're fixed. */
  readonly blockedErrors?: readonly string[];
  /** `true` when the conversation moved to `exported` and the card should download the archive. */
  readonly archiveReady?: boolean;
  readonly conversation?: ConversationState;
  readonly revision?: number;
  readonly error?: string;
}

/**
 * "Approve" on the review summary (PRD FR-5, FR-11, FR-14): run the FR-13/FR-14
 * export gate, and on a pass move the conversation to `exported` and tell the
 * card to download the encrypted records archive. The archive itself is built
 * by `POST /api/returns/:id/export/archive` — this action never sees the file,
 * only gates it and advances the conversation. The password is validated for
 * length here and passed straight to that route by the card; it is never
 * logged, persisted or put in a query string.
 */
export async function approveReturn(
  returnId: string,
  expectedRevision: number,
  cardId: string,
  password: string,
  acknowledgeWarningIds?: readonly string[],
): Promise<ApproveReturnResult> {
  let loaded: LoadedConversation;
  try {
    loaded = await loadConversation(returnId);
  } catch {
    return { ok: false, error: "Couldn't load this return. Reload the page and try again." };
  }
  if (loaded.readOnly) {
    return { ok: false, error: "This return is locked and can't be changed." };
  }
  if (loaded.conversation.phase !== "review") {
    return { ok: false, error: "This return isn't at the review stage." };
  }

  if (typeof password !== "string" || password.length < MIN_ARCHIVE_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `Choose a records-archive password of at least ${MIN_ARCHIVE_PASSWORD_LENGTH} characters.`,
    };
  }

  let context: Awaited<ReturnType<typeof loadExportContext>>;
  try {
    context = await loadExportContext(returnId);
  } catch {
    return { ok: false, error: "Couldn't prepare the export for this return." };
  }
  if (!context.ready || !context.assessment) {
    const missing = topicsOutstanding(context.model);
    return {
      ok: false,
      error: `still missing: ${missing.length > 0 ? missing.join("; ") : "a few remaining details"}`,
    };
  }

  const requested = acknowledgeWarningIds ?? [];
  let gate = computeExportGate(
    context.model,
    context.assessment,
    await readAcknowledgedWarningIds(returnId),
  );
  if (gate.blocked) {
    return { ok: false, blockedErrors: gate.errors.map((e) => e.message) };
  }
  if (!gate.allWarningsAcknowledged) {
    const unacked = gate.warnings.filter((w) => !w.acknowledged).map((w) => w.id);
    const covered = unacked.every((id) => requested.includes(id));
    if (!covered) {
      return {
        ok: false,
        needsWarningAck: true,
        warnings: gate.warnings.map((w) => ({ id: w.id, message: w.message })),
      };
    }
    await acknowledgeWarnings(returnId, requested);
    gate = computeExportGate(
      context.model,
      context.assessment,
      await readAcknowledgedWarningIds(returnId),
    );
    if (!gate.downloadsEnabled) {
      return gate.blocked
        ? { ok: false, blockedErrors: gate.errors.map((e) => e.message) }
        : {
            ok: false,
            needsWarningAck: true,
            warnings: gate.warnings.map((w) => ({ id: w.id, message: w.message })),
          };
    }
  }

  const generatedAt = new Date().toISOString();
  const input = buildExportInput(context, await readAcknowledgedWarningIds(returnId), generatedAt);
  const firstSteps = buildLodgeInstructionsData(input)
    .steps.slice(0, 3)
    .map((step) => step.heading)
    .join(" ");
  const message =
    "Your lodgement package is ready — the encrypted archive will download now. " +
    `To lodge: ${firstSteps} ` +
    "Keep the archive password somewhere safe; it isn't stored.";

  let next: ConversationState = appendTurn(loaded.conversation, {
    role: "user",
    kind: "card-response",
    cardId,
    response: { approved: true },
  });
  next = appendTurn(next, { role: "assistant", kind: "message", text: message });
  next = { ...next, phase: "exported" };

  let result: Awaited<ReturnType<typeof saveConversation>>;
  try {
    result = await saveConversation(returnId, {
      model: loaded.model,
      conversation: next,
      expectedRevision,
    });
  } catch (error) {
    if (error instanceof ConversationReadOnlyError) {
      return { ok: false, error: "This return is locked and can't be changed." };
    }
    throw error;
  }
  if (result.conflict) {
    const fresh = await loadConversation(returnId);
    return {
      ok: false,
      error: "This return changed in another tab — reload to see the latest version.",
      conversation: fresh.conversation,
      revision: fresh.envelope.revision,
    };
  }

  await markReturnExported(returnId);

  return {
    ok: true,
    archiveReady: true,
    conversation: next,
    revision: result.envelope.revision,
  };
}
