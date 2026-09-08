/**
 * FR-14 — failure handling in the conversation.
 *
 * A single place that turns an *unknown* caught error — raised anywhere the
 * interview reaches for Claude (answer mapping, `nextTurn`, document extraction,
 * the out-of-scope scope check) — into a typed, user-facing outcome:
 *
 * > *"Given a document extraction fails, the Claude API errors or is
 * > rate-limited, or a scope check cannot complete, When it happens during the
 * > interview, Then the assistant says so in plain language, the return's
 * > confirmed state is untouched, and the user can retry the step — it never
 * > proceeds as if a failed step succeeded (the subscription-token rate limit
 * > is the common case)."*
 *
 * This module is pure: no Next imports, no I/O, no logging. It never surfaces a
 * stack trace, a provider message or any secret — only fixed, first-person copy
 * that tells the user their progress is saved and how to retry. The call sites
 * (`app/returns/[returnId]/actions.ts`, the `prefill` route and the
 * `interview-document` route) own persistence and are responsible for saving the
 * *pre-attempt* model unchanged on a failure.
 *
 * A **rate limit** is special: it is a resumable pause, not a hard error. The
 * conversation stays in its current phase, the composer stays live, and the
 * user just resends once the limit clears — `resumablePause` marks it so the UI
 * can show a calm "paused" note rather than a red error.
 *
 * Error classification deliberately lives here, in `apps/web`, not in
 * `@aus-tax-lodge/ai` (the Claude client stays a thin wrapper). A 429 surfaces
 * as `Anthropic.RateLimitError` (`err.status === 429`); it is detected both by
 * `instanceof` against the SDK's exported class and by a duck-typed
 * `status === 429` fallback, since the thrown value may be wrapped by the time
 * it reaches a catch.
 */
import { RateLimitError } from "@anthropic-ai/sdk";

/** What kind of failure was caught. */
export type ConversationFailureKind =
  "rate-limit" | "claude-error" | "extraction-failed" | "scope-check-incomplete" | "unknown";

/** How the user gets back on track after this failure. */
export type ConversationRetryHint = "resend-message" | "reupload-document" | "retry-step";

/** The step that was running when the failure was caught. */
export type ConversationFailureStep = "answer" | "document" | "card" | "scope-check" | "extraction";

export interface ConversationFailure {
  readonly kind: ConversationFailureKind;
  /**
   * Plain-language, first-person copy for a plain assistant message. Always
   * tells the user their progress is saved and how to retry the step. Carries
   * no stack, no provider text and no secret.
   */
  readonly assistantMessage: string;
  /** `true` only for a rate limit — a transient, resumable pause. */
  readonly resumablePause: boolean;
  readonly retryHint: ConversationRetryHint;
}

export interface ClassifyConversationFailureContext {
  readonly step: ConversationFailureStep;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** A 429 from Anthropic, however it reached this catch. */
function isRateLimit(error: unknown): boolean {
  if (error instanceof RateLimitError) return true;
  if (isRecord(error)) {
    if (error.status === 429 || error.statusCode === 429) return true;
    // The real error may be wrapped (a rethrow, an aggregate, a cause chain).
    const nested = [error.cause, error.error, error.originalError];
    for (const inner of nested) {
      if (inner instanceof RateLimitError) return true;
      if (isRecord(inner) && (inner.status === 429 || inner.statusCode === 429)) return true;
    }
  }
  return false;
}

const DOCUMENT_STEPS: ReadonlySet<ConversationFailureStep> = new Set(["document", "extraction"]);

function rateLimitMessage(step: ConversationFailureStep): string {
  const retry = DOCUMENT_STEPS.has(step) ? "upload it again" : "send your last message again";
  return (
    "I've hit the usage limit on my Claude access for now — everything you've told me so far is " +
    `saved. Give it a little while, then ${retry} and I'll carry on from here.`
  );
}

function retryHintFor(step: ConversationFailureStep): ConversationRetryHint {
  if (DOCUMENT_STEPS.has(step)) return "reupload-document";
  if (step === "answer") return "resend-message";
  return "retry-step";
}

/**
 * Classify a caught failure into a {@link ConversationFailure}. Never throws.
 *
 * - A **429 / rate limit** — whatever the step — is a `"rate-limit"` resumable
 *   pause.
 * - `step: "extraction"` (not a rate limit) → `"extraction-failed"`: the
 *   document couldn't be read; upload it again or type the figures.
 * - `step: "scope-check"` (not a rate limit) → `"scope-check-incomplete"`: the
 *   out-of-scope check couldn't finish, so the assistant does **not** proceed
 *   (it must not assume the return is in scope) — the user resends.
 * - anything else → `"claude-error"`: a generic reach-for-Claude failure; the
 *   user retries the step.
 */
export function classifyConversationFailure(
  error: unknown,
  context: ClassifyConversationFailureContext,
): ConversationFailure {
  const { step } = context;

  if (isRateLimit(error)) {
    return {
      kind: "rate-limit",
      assistantMessage: rateLimitMessage(step),
      resumablePause: true,
      retryHint: DOCUMENT_STEPS.has(step) ? "reupload-document" : "resend-message",
    };
  }

  if (step === "extraction") {
    return {
      kind: "extraction-failed",
      assistantMessage:
        "I couldn't read that file just now — nothing on your return has changed. " +
        "Upload it again, or just tell me the figures and I'll use those.",
      resumablePause: false,
      retryHint: "reupload-document",
    };
  }

  if (step === "scope-check") {
    return {
      kind: "scope-check-incomplete",
      assistantMessage:
        "I couldn't finish checking that for things this assistant can't handle — so I've not " +
        "moved on, and your progress is saved. Send it again and I'll re-check.",
      resumablePause: false,
      retryHint: "retry-step",
    };
  }

  return {
    kind: error === undefined || error === null ? "unknown" : "claude-error",
    assistantMessage:
      "Something went wrong on that step just now — your progress is saved and nothing's " +
      "changed on your return. Give it another try in a moment.",
    resumablePause: false,
    retryHint: retryHintFor(step),
  };
}
