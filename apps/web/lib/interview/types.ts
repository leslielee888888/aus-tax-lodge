/**
 * Shared types for the interview-agent module (PRD FR-3, FR-4).
 *
 * The module is pure: every Claude call goes through an injected
 * {@link InterviewClient} (a structural subset of `@aus-tax-lodge/ai`'s
 * `ClaudeClient`), so the whole thing is unit-tested against scripted fixtures
 * with a mocked client. Claude only picks / phrases questions and parses plain
 * answers — it never does return arithmetic or states a computed figure
 * (PRD FR-3, "LLM boundary").
 */
import type { ClaudeClient } from "@aus-tax-lodge/ai";
import type { ReturnModel } from "@aus-tax-lodge/model";
import type { OutOfScopeFinding } from "@aus-tax-lodge/scope";

import type { CardRef } from "../conversation";

/**
 * The narrow Claude surface the interview needs — just `ask` (PRD §8 / Q6: one
 * Claude call per turn). A structural subset of `@aus-tax-lodge/ai`'s
 * `ClaudeClient` so tests can pass a bare `{ ask }` stub.
 */
export type InterviewClient = Pick<ClaudeClient, "ask">;

/**
 * One assistant move, as decided by {@link import("./next-turn").nextTurn}:
 * - `ask` — a plain question the user answers in the composer.
 * - `say` — a statement (an explanation, or "good, next…") with no question.
 * - `card` — a structured input is needed; `card` is the {@link CardRef} and
 *   `text` an optional lead-in. T4–T8 own each card's payload.
 * - `done` — the interview believes it is complete. `nextTurn` only ever
 *   returns this after the deterministic gate (`isReadyForEstimate` +
 *   a clean `validateReturn`) agrees (PRD FR-3).
 */
export type InterviewStep =
  | { readonly kind: "ask"; readonly text: string }
  | { readonly kind: "say"; readonly text: string }
  | { readonly kind: "card"; readonly card: CardRef; readonly text?: string }
  | { readonly kind: "done" };

/** The value type a parsed field update carries. */
export type FieldUpdateKind = "number" | "string" | "boolean" | "date";

/**
 * One field update Claude proposes from a user's plain-English reply
 * ({@link import("./apply-user-turn").applyUserTurn}). `path` must be on the
 * closed allow-list ({@link import("./fields").isInterviewFieldPath}); anything
 * else is a prompt bug and throws.
 */
export interface FieldUpdate {
  readonly path: string;
  readonly value: string | number | boolean | null;
  readonly kind: FieldUpdateKind;
}

/**
 * The result of processing one user turn in the interview phase (PRD FR-4).
 *
 * - `model` — the model with every allowed update applied (`user-entered`
 *   provenance). The caller decides whether to persist it — when `outOfScope`
 *   is set it must NOT (T7 renders the hard stop).
 * - `clarify` — set instead of applying anything when the reply was ambiguous
 *   or spanned fields Claude could not split confidently; `model` is unchanged.
 * - `outOfScope` — blocking out-of-scope findings (from `@aus-tax-lodge/scope`
 *   over the updated model, plus anything Claude flagged in the free text).
 * - `appliedPaths` — the model paths actually written this turn.
 */
export interface ApplyResult {
  readonly model: ReturnModel;
  readonly clarify?: string;
  readonly outOfScope?: readonly OutOfScopeFinding[];
  readonly appliedPaths: readonly string[];
}
