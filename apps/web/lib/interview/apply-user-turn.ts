/**
 * `applyUserTurn` — turn a plain-English reply into concrete return fields
 * (PRD FR-4).
 *
 * Claude maps the reply to a list of field updates (or asks to clarify); **T2**
 * applies them to the model with `user-entered` provenance, gated by the closed
 * allow-list in {@link import("./fields")}. A path outside that list is a prompt
 * bug, not user input, and throws {@link InterviewFieldError} — it is never
 * silently written.
 *
 * Scope detection then runs over the updated model
 * ({@link detectOutOfScope}), combined with anything Claude flagged in the free
 * text (a CGT / business / foreign-income mention has no model field to catch
 * it). Any finding is returned on {@link ApplyResult.outOfScope}; T2 only
 * detects and reports — the caller (T7) renders the hard stop and does not
 * persist the update.
 */
import type { ReturnModel } from "@aus-tax-lodge/model";
import {
  detectOutOfScope,
  scopeFinding,
  type OutOfScopeFinding,
} from "@aus-tax-lodge/scope";

import type { ConversationState } from "../conversation";
import { applyInterviewField } from "./fields";
import {
  APPLY_TURN_MAX_TOKENS,
  APPLY_TURN_SYSTEM,
  buildApplyTurnPrompt,
  parseFieldUpdates,
  parseJsonObject,
  parseScopeCodes,
} from "./prompts";
import type { ApplyResult, InterviewClient } from "./types";

export interface ApplyUserTurnInput {
  readonly model: ReturnModel;
  readonly conversation: ConversationState;
  /** The user's typed reply, in the interview phase. */
  readonly text: string;
  readonly client: InterviewClient;
}

/** Map the reply onto fields, apply the allowed ones, and run scope detection. */
export async function applyUserTurn(input: ApplyUserTurnInput): Promise<ApplyResult> {
  const { model, conversation, text, client } = input;

  const raw = await client.ask(buildApplyTurnPrompt(model, conversation, text), {
    system: APPLY_TURN_SYSTEM,
    maxTokens: APPLY_TURN_MAX_TOKENS,
  });
  const reply = parseJsonObject(raw);
  const claudeScope = parseScopeCodes(reply.outOfScope);

  // --- Ambiguous / un-splittable reply → clarify, model untouched -----------
  if (typeof reply.clarify === "string" && reply.clarify.trim() !== "") {
    const findings = collectFindings(model, claudeScope);
    return {
      model,
      clarify: reply.clarify.trim(),
      appliedPaths: [],
      ...(findings.length > 0 ? { outOfScope: findings } : {}),
    };
  }

  // --- Apply the field updates --------------------------------------------
  const updates = parseFieldUpdates(reply.updates);
  const appliedPaths: string[] = [];
  let next = model;
  for (const update of updates) {
    // A path outside the closed allow-list is a prompt bug, not user input:
    // `applyInterviewField` throws `InterviewFieldError` and nothing is
    // persisted (we never return `next` on the throw path).
    next = applyInterviewField(next, update);
    appliedPaths.push(update.path);
  }

  const findings = collectFindings(next, claudeScope);
  return {
    model: next,
    appliedPaths,
    ...(findings.length > 0 ? { outOfScope: findings } : {}),
  };
}

/** Deterministic model detection + Claude's free-text flags, de-duplicated by code. */
function collectFindings(
  model: ReturnModel,
  claudeScope: readonly OutOfScopeFinding["code"][],
): OutOfScopeFinding[] {
  const findings: OutOfScopeFinding[] = [...detectOutOfScope({ model })];
  const seen = new Set(findings.map((f) => f.code));
  for (const code of claudeScope) {
    if (!seen.has(code)) {
      seen.add(code);
      findings.push(scopeFinding(code, "answer"));
    }
  }
  return findings;
}
