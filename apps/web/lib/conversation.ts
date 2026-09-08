import { randomUUID } from "node:crypto";

import type { ReturnModel } from "@aus-tax-lodge/model";

/**
 * v2's conversation state (PRD FR-12), carried on `envelope.data` alongside the
 * real {@link ReturnModel} fields under the key {@link CONVERSATION_STATE_KEY} —
 * the same ride-along trick T16's {@link import("./extraction-scratch")} and
 * T26's {@link import("./scope-content-scratch")} use, and for the same reason:
 * `@aus-tax-lodge/store` round-trips `ReturnEnvelope.data` verbatim as opaque
 * JSON, so the chat transcript, the assistant's place in the interview and the
 * figures flagged for the final review persist and resume without a new store,
 * a database, or a change to `@aus-tax-lodge/model` (a hard v1/v2 constraint).
 *
 * This module is the envelope, the turn ordering and the defensive
 * read/write helpers only. T2 (the interview agent) drives `phase`/`place` and
 * appends turns; T3 (the chat UI) renders `turns`; T4–T8 firm up the
 * currently-`unknown` card payload and `PendingConfirmation.detail` slots.
 */
export const CONVERSATION_STATE_KEY = "__conversation" as const;

/** Bump when {@link ConversationState} changes shape incompatibly. */
export const CONVERSATION_STATE_VERSION = 1;

// ---------------------------------------------------------------------------
// Turns — the ordered transcript
// ---------------------------------------------------------------------------

/**
 * The structured-input cards the assistant can ask for (PRD §7, Q4). T4–T8 each
 * own one card's payload shape; T1 leaves {@link AssistantCard.payload} loose.
 */
export type CardRef =
  | "upload-prefill"
  | "income-checkpoint"
  | "confirm-figure"
  | "upload-or-tell"
  | "reconcile"
  | "review-summary"
  | "out-of-scope";

export interface AssistantCard {
  readonly type: CardRef;
  /**
   * Typed payload for the card — value + source for `confirm-figure`, the
   * income lines for `income-checkpoint`, etc. Left `unknown` until the task
   * that renders each card (T4–T8) firms up its shape.
   */
  readonly payload?: unknown;
}

interface TurnBase {
  /** Collision-safe id — see {@link newTurnId}. */
  readonly id: string;
  /** ISO-8601 timestamp the turn was recorded. */
  readonly at: string;
}

/** A plain assistant message — streamed text the user answers in the composer. */
export interface AssistantMessageTurn extends TurnBase {
  readonly role: "assistant";
  readonly kind: "message";
  readonly text: string;
}

/** The assistant asked for a structured input; the card is rendered inline. */
export interface AssistantCardTurn extends TurnBase {
  readonly role: "assistant";
  readonly kind: "card";
  readonly card: AssistantCard;
}

/** A user's typed reply. */
export interface UserMessageTurn extends TurnBase {
  readonly role: "user";
  readonly kind: "message";
  readonly text: string;
}

/** A user dropped a document into the chat — rendered as a file chip. */
export interface UserFileTurn extends TurnBase {
  readonly role: "user";
  readonly kind: "file";
  readonly filename: string;
  /** The `docId` the encrypted document store assigned the upload. */
  readonly docId: string;
}

/** The user acted on a card ({@link AssistantCardTurn.id} in `cardId`). */
export interface UserCardResponseTurn extends TurnBase {
  readonly role: "user";
  readonly kind: "card-response";
  readonly cardId: string;
  /** The card's result — shape owned by the card's task (T4–T8). */
  readonly response: unknown;
}

export type ConversationTurn =
  AssistantMessageTurn | AssistantCardTurn | UserMessageTurn | UserFileTurn | UserCardResponseTurn;

export type AssistantTurn = AssistantMessageTurn | AssistantCardTurn;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A turn as handed to {@link appendTurn} — `id` and `at` are generated if omitted. */
export type ConversationTurnInput = DistributiveOmit<ConversationTurn, "id" | "at"> & {
  readonly id?: string;
  readonly at?: string;
};

// ---------------------------------------------------------------------------
// The state
// ---------------------------------------------------------------------------

/** Where the conversation is (PRD §7 states, FR-9). */
export type ConversationPhase = "upload" | "interview" | "review" | "exported" | "stopped";

/**
 * A figure flagged for the final review checkpoint (PRD FR-5). T5 fills these
 * in as the interview runs; T1 only defines the slot and persists it.
 */
export interface PendingConfirmation {
  /** Stable id for the flagged item. */
  readonly id: string;
  /** The model path / label the figure lives at (loose until T5). */
  readonly modelPath?: string;
  /** Why it was flagged — `medium`/`low`/`unverified` confidence, a `validateReturn` warning, user-corrected. */
  readonly reason?: string;
  /** Card-specific detail for the review summary — shape owned by T5/T8. */
  readonly detail?: unknown;
}

export interface ConversationState {
  /** {@link CONVERSATION_STATE_VERSION} this block was written against. */
  readonly version: number;
  /** The ordered transcript. */
  readonly turns: readonly ConversationTurn[];
  readonly phase: ConversationPhase;
  /**
   * A short human label for the current interview topic ("work-from-home
   * deductions") — the returns list's "up to: <topic>" (PRD FR-13 / T9).
   * `null` outside the interview or before the first topic.
   */
  readonly place: string | null;
  /** Figures flagged for the final review (PRD FR-5). */
  readonly pendingConfirmations: readonly PendingConfirmation[];
  /** Set when `phase === "stopped"` — the out-of-scope item that ended the interview (PRD FR-9). */
  readonly stoppedReason: string | null;
}

export type ModelWithConversation = ReturnModel & {
  readonly [CONVERSATION_STATE_KEY]?: ConversationState;
};

/** A fresh, empty conversation — the state a return that predates FR-12 reads as. */
export function emptyConversation(): ConversationState {
  return {
    version: CONVERSATION_STATE_VERSION,
    turns: [],
    phase: "upload",
    place: null,
    pendingConfirmations: [],
    stoppedReason: null,
  };
}

// ---------------------------------------------------------------------------
// Defensive read
// ---------------------------------------------------------------------------

const PHASES: readonly ConversationPhase[] = [
  "upload",
  "interview",
  "review",
  "exported",
  "stopped",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPhase(value: unknown): value is ConversationPhase {
  return typeof value === "string" && (PHASES as readonly string[]).includes(value);
}

/** A structurally-valid turn — anything that fails this is dropped, never thrown on. */
function isTurn(value: unknown): value is ConversationTurn {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || typeof value.at !== "string") return false;
  if (value.role === "assistant") {
    if (value.kind === "message") return typeof value.text === "string";
    if (value.kind === "card") {
      return isRecord(value.card) && typeof value.card.type === "string";
    }
    return false;
  }
  if (value.role === "user") {
    if (value.kind === "message") return typeof value.text === "string";
    if (value.kind === "file") {
      return typeof value.filename === "string" && typeof value.docId === "string";
    }
    if (value.kind === "card-response") return typeof value.cardId === "string";
    return false;
  }
  return false;
}

function isPendingConfirmation(value: unknown): value is PendingConfirmation {
  return isRecord(value) && typeof value.id === "string";
}

/**
 * Coerce whatever is stored under {@link CONVERSATION_STATE_KEY} into a valid
 * {@link ConversationState}. Never throws:
 * - missing / non-object / wrong-version block → a fresh empty state;
 * - a valid-version block → its fields, with every unparseable turn or
 *   confirmation dropped and every scalar defaulted.
 */
function coerceConversation(raw: unknown): ConversationState {
  if (!isRecord(raw) || raw.version !== CONVERSATION_STATE_VERSION) {
    return emptyConversation();
  }
  return {
    version: CONVERSATION_STATE_VERSION,
    turns: Array.isArray(raw.turns) ? raw.turns.filter(isTurn) : [],
    phase: isPhase(raw.phase) ? raw.phase : "upload",
    place: typeof raw.place === "string" ? raw.place : null,
    pendingConfirmations: Array.isArray(raw.pendingConfirmations)
      ? raw.pendingConfirmations.filter(isPendingConfirmation)
      : [],
    stoppedReason: typeof raw.stoppedReason === "string" ? raw.stoppedReason : null,
  };
}

/**
 * The conversation state stored on a model, or a fresh empty one for a return
 * that predates it. Defensive: a bare {@link ReturnModel} with no
 * `__conversation` key, `null`/`undefined` data, or a block written against an
 * older/unknown {@link CONVERSATION_STATE_VERSION} all yield a fresh state
 * rather than an exception (PRD Q7 — v1 wizard-shaped returns must not crash v2).
 */
export function readConversation(model: ReturnModel | null | undefined): ConversationState {
  const raw = isRecord(model)
    ? (model as ModelWithConversation)[CONVERSATION_STATE_KEY]
    : undefined;
  return coerceConversation(raw);
}

// ---------------------------------------------------------------------------
// Write helpers
// ---------------------------------------------------------------------------

/**
 * A copy of `model` with its conversation block replaced — every other field
 * untouched (mirrors `withExtractionScratch`). The result is still a valid
 * {@link ReturnModel} for `@aus-tax-lodge/*`, which ignore the extra key.
 */
export function withConversation(
  model: ReturnModel,
  state: ConversationState,
): ModelWithConversation {
  return { ...model, [CONVERSATION_STATE_KEY]: state };
}

/** A collision-safe turn id. */
export function newTurnId(): string {
  return randomUUID();
}

/**
 * Pure: a new state with `turn` appended, its `id` and `at` generated when not
 * supplied. The input state and its `turns` array are not mutated.
 */
export function appendTurn(
  state: ConversationState,
  turn: ConversationTurnInput,
): ConversationState {
  const full = {
    ...turn,
    id: turn.id ?? newTurnId(),
    at: turn.at ?? new Date().toISOString(),
  } as ConversationTurn;
  return { ...state, turns: [...state.turns, full] };
}

// ---------------------------------------------------------------------------
// Accessors (the returns list / chat UI want these)
// ---------------------------------------------------------------------------

/** The most recent assistant turn (message or card), or `null` if the assistant hasn't spoken. */
export function lastAssistantTurn(state: ConversationState): AssistantTurn | null {
  for (let i = state.turns.length - 1; i >= 0; i -= 1) {
    const turn = state.turns[i];
    if (turn && turn.role === "assistant") return turn;
  }
  return null;
}

/**
 * `true` when the conversation is waiting on the user — the last turn is the
 * assistant's (or there are no turns yet, i.e. awaiting the pre-fill upload) and
 * the conversation is neither stopped nor exported.
 */
export function isAwaitingUser(state: ConversationState): boolean {
  if (state.phase === "stopped" || state.phase === "exported") return false;
  const last = state.turns[state.turns.length - 1];
  return last === undefined || last.role === "assistant";
}

/**
 * The one-line status for the returns list (PRD FR-13) — "up to: <place>" while
 * interviewing with a known topic, and a sensible phase-specific fallback
 * otherwise.
 */
export function conversationSummaryLine(state: ConversationState): string {
  switch (state.phase) {
    case "upload":
      return "Waiting for your pre-fill report";
    case "interview":
      return state.place ? `up to: ${state.place}` : "Interview in progress";
    case "review":
      return "Reviewing your return";
    case "exported":
      return "Lodgement package ready";
    case "stopped":
      return state.stoppedReason ? `Stopped — ${state.stoppedReason}` : "Stopped";
    default:
      return "In progress";
  }
}
