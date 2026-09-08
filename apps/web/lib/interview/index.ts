/**
 * `apps/web/lib/interview` — the interview-agent module (PRD FR-3, FR-4).
 *
 * Pure functions with an injected Claude client ({@link InterviewClient}).
 * Claude picks / phrases questions and parses answers; the deterministic gate
 * (`isReadyForEstimate` + a clean `validateReturn`) decides completeness, and
 * `@aus-tax-lodge/*` does every calculation. T3/T4 wire this into the chat
 * route and cards; T5–T9 build against the signatures here.
 */
export type {
  ApplyResult,
  FieldUpdate,
  FieldUpdateKind,
  InterviewClient,
  InterviewStep,
} from "./types";

export { nextTurn, deterministicallyComplete, type NextTurnInput } from "./next-turn";
export { applyUserTurn, type ApplyUserTurnInput } from "./apply-user-turn";
export { topicsOutstanding, INTERVIEW_TOPIC_AREAS } from "./topics";
export { renderModelForPrompt, renderTranscript } from "./render";
export {
  INTERVIEW_FIELD_PATHS,
  InterviewFieldError,
  applyInterviewField,
  isInterviewFieldPath,
} from "./fields";
export {
  NEXT_TURN_SYSTEM,
  APPLY_TURN_SYSTEM,
  buildNextTurnPrompt,
  buildApplyTurnPrompt,
} from "./prompts";
