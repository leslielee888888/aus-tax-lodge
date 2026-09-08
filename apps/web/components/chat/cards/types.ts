import type { ComponentType } from "react";

import type { AssistantCardTurn, ConversationState } from "../../../lib/conversation";

/**
 * The card-body registry (PRD §7, Q4).
 *
 * `ChatTranscript` renders a `kind:"card"` turn by looking its `card.type`
 * ({@link import("../../../lib/conversation").CardRef}) up in
 * {@link import("./registry").CARD_COMPONENTS}. A registered component renders
 * the real interactive body; an unregistered type falls back to the plain
 * `CardPlaceholder` shell. This lets each later task add its card without
 * touching `ChatTranscript`:
 *
 * ```tsx
 * // cards/registry.tsx
 * export const CARD_COMPONENTS: CardComponentMap = {
 *   "upload-prefill": UploadPrefillCard,   // T4
 *   "income-checkpoint": IncomeCheckpointCard, // T5
 *   // "confirm-figure": …  T5
 *   // "upload-or-tell": …  T6
 *   // "reconcile": …       T6
 *   // "out-of-scope": …    T7
 *   // "review-summary": …  T8
 * };
 * ```
 *
 * Every card component is a Client Component and receives {@link CardProps}: the
 * return id + the revision to send with the next write, the card turn itself
 * (its `card.payload` carries the card-specific data), whether the conversation
 * is read-only, and an {@link CardResult} callback to hand `ChatScreen` the
 * server's updated conversation once the card has done its work.
 */
export interface CardResult {
  readonly conversation: ConversationState;
  /** The `revision` the next {@link import("../../../app/returns/[returnId]/actions").sendMessage} should send. */
  readonly revision: number;
  /**
   * FR-14 — the card's step hit Claude's rate limit: a resumable pause, not a
   * hard error. `ChatScreen` shows a calm "paused" note and keeps the composer
   * live; the user retries shortly.
   */
  readonly rateLimited?: boolean;
}

export interface CardProps {
  readonly returnId: string;
  readonly revision: number;
  readonly turn: AssistantCardTurn;
  readonly readOnly: boolean;
  /** The card produced a result — a server write returned a fresh conversation. */
  readonly onResult: (result: CardResult) => void;
}

export type CardComponent = ComponentType<CardProps>;

export type CardComponentMap = Partial<Record<AssistantCardTurn["card"]["type"], CardComponent>>;
