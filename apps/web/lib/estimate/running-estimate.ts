/**
 * The running estimate a user can ask for mid-interview (PRD FR-10).
 *
 * When the user asks something like "what's my refund looking like so far?"
 * during the interview, {@link maybeRunningEstimate} returns a plain-English
 * reply built **entirely from the deterministic engine** — Claude never states a
 * computed figure (PRD FR-3, "LLM boundary"). The caller (`sendMessage`) checks
 * this before the field-mapping loop; a `null` result means the message wasn't a
 * request for an estimate and should go through the normal interview flow.
 *
 * If the engine can't run yet ({@link MissingFiguresError}) the reply says so
 * and names what is still outstanding ({@link topicsOutstanding}); if it can run
 * but the return isn't ready, the figure is given with the same caveat.
 */
import { assess, type FullAssessment } from "@aus-tax-lodge/engine";
import {
  isReadyForEstimate,
  MissingFiguresError,
  toEngineInput,
  type ReturnModel,
} from "@aus-tax-lodge/model";

import { buildEstimateBreakdown } from "./breakdown";
import { topicsOutstanding } from "../interview/topics";

/** A dollar-ish thing the user might be asking about. */
const ESTIMATE_SUBJECT =
  /\b(refund|owe|owing|tax bill|get back|getting back|estimate|estimated|balance|position|pay back|payable)\b/i;

/** Phrasing that makes it a question / a "where am I" check rather than a statement of fact. */
const ESTIMATE_QUESTION =
  /\?|\b(what|what's|whats|hows|how's|how much|how big|where|do i|will i|am i|would i|could you|can you|give me|roughly|rough|ballpark|so far|so-far|yet|right now|at this point|at the moment|currently|looking like|shaping up|on track)\b/i;

/**
 * `true` when `text` reads as a request for a running estimate. A heuristic: a
 * false negative just routes the message through the normal interview loop; a
 * false positive hands the user an (accurate, engine-computed) figure early,
 * which is harmless.
 */
export function isRunningEstimateRequest(text: string): boolean {
  return ESTIMATE_SUBJECT.test(text) && ESTIMATE_QUESTION.test(text);
}

function outstandingList(model: ReturnModel): string {
  const topics = topicsOutstanding(model);
  if (topics.length === 0) return "a few remaining details";
  const shown = topics.slice(0, 5);
  const more = topics.length - shown.length;
  return shown.join("; ") + (more > 0 ? `; and ${more} more` : "");
}

function headlineSentence(assessment: FullAssessment, model: ReturnModel): string {
  const breakdown = buildEstimateBreakdown(model, assessment, "");
  const { headline } = breakdown;
  return headline.kind === "refund"
    ? `Right now the numbers point to a refund of about ${headline.displayAmount}.`
    : `Right now the numbers point to about ${headline.displayAmount} to pay.`;
}

/**
 * Build the running-estimate reply for `text`, or `null` when `text` isn't
 * asking for one.
 */
export function maybeRunningEstimate(model: ReturnModel, text: string): string | null {
  if (!isRunningEstimateRequest(text)) return null;

  let assessment: FullAssessment | null = null;
  try {
    assessment = assess(toEngineInput(model));
  } catch (err) {
    if (err instanceof MissingFiguresError) {
      return (
        "I can't give you a reliable estimate yet — I still need to sort out " +
        `${outstandingList(model)}. Once we've worked through those I can run the numbers for you.`
      );
    }
    throw err;
  }

  const headline = headlineSentence(assessment, model);
  if (isReadyForEstimate(model)) {
    return (
      `${headline} That's based on everything you've confirmed so far, and the deterministic ` +
      "tax engine does the maths — not me. We'll do a full review before you lodge."
    );
  }

  return (
    `${headline} Treat that as rough — I still need to cover ${outstandingList(model)}, ` +
    "so the figure will move as we go. The tax engine does the maths, not me."
  );
}
