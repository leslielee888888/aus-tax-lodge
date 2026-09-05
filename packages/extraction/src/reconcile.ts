/**
 * `resolveReconciliation` — the resolution mechanism for FR-21's pending
 * mismatches: once the user has picked a side for a `modelPath` two or more
 * documents disagreed on, this applies that pick to the model.
 *
 * This module never picks on the user's behalf. `suggestDefaultChoice` is a
 * UI-default helper only — it computes what a picker screen should
 * pre-select, but nothing in this module calls it; a `ReconciliationChoice`
 * only ever reaches {@link resolveReconciliation} via an explicit user pick
 * (T17's job).
 */
import { documentOrigin, type FieldConfidence, type ReturnModel } from "@aus-tax-lodge/model";

import { applyFigureToModel } from "./model-paths";
import type { PendingReconciliation, ReconciliationChoice } from "./types";

export type { ReconciliationChoice } from "./types";

export interface ResolveReconciliationResult {
  readonly model: ReturnModel;
  /** Every `pending` entry with no matching choice — the model is left untouched at these paths. */
  readonly unresolved: readonly PendingReconciliation[];
}

/**
 * Applies the user's `choices` to `model`. For each `pending` entry with a
 * matching choice, the chosen candidate's value is proposed at its
 * `modelPath` against *that candidate's own* `documentOrigin` — the user's
 * pick wins, and provenance records the document it actually came from,
 * never a different candidate's origin. This still lands via `propose()`
 * (PRD FR-7): a resolved field is `proposed`, not `confirmed` — the user
 * confirms it like any other figure in the review step.
 *
 * A `pending` entry with no matching choice is returned in `unresolved` and
 * the model is left untouched at that path — there is no auto-pick, even
 * when one candidate is the ATO pre-fill report (PRD FR-21).
 */
export function resolveReconciliation(
  model: ReturnModel,
  pending: readonly PendingReconciliation[],
  choices: readonly ReconciliationChoice[],
): ResolveReconciliationResult {
  const choiceByPath = new Map(choices.map((choice) => [choice.modelPath, choice]));
  const unresolved: PendingReconciliation[] = [];
  let result = model;

  for (const entry of pending) {
    const choice = choiceByPath.get(entry.modelPath);
    if (choice === undefined) {
      unresolved.push(entry);
      continue;
    }

    const candidate = entry.candidates[choice.chosenIndex];
    if (candidate === undefined) {
      throw new Error(
        `reconciliation: chosenIndex ${choice.chosenIndex} out of range for "${entry.modelPath}" (${entry.candidates.length} candidates)`,
      );
    }

    result = applyFigureToModel(
      result,
      entry.modelPath,
      candidate.value,
      documentOrigin(candidate.docId, candidate.page, candidate.snippet, candidate.confidence),
    );
  }

  return { model: result, unresolved };
}

const CONFIDENCE_RANK: Record<FieldConfidence, number> = {
  high: 3,
  medium: 2,
  low: 1,
  unverified: 0,
};

/**
 * A UI-default suggestion for one {@link PendingReconciliation} — never
 * invoked by {@link resolveReconciliation} or anywhere else that would
 * auto-apply it. Picks the ATO pre-fill-report candidate when present (PRD
 * FR-2's "pre-fill report is the default spine" — FR-21); otherwise picks the
 * highest-confidence candidate. The user still has to confirm the pick (or
 * choose differently) — this never auto-wins a conflict.
 */
export function suggestDefaultChoice(pending: PendingReconciliation): ReconciliationChoice {
  const prefillIndex = pending.candidates.findIndex(
    (candidate) => candidate.documentType === "ato-prefill-report",
  );
  if (prefillIndex !== -1) {
    return { modelPath: pending.modelPath, chosenIndex: prefillIndex };
  }

  let bestIndex = 0;
  let bestRank = -1;
  pending.candidates.forEach((candidate, index) => {
    const rank = CONFIDENCE_RANK[candidate.confidence];
    if (rank > bestRank) {
      bestRank = rank;
      bestIndex = index;
    }
  });

  return { modelPath: pending.modelPath, chosenIndex: bestIndex };
}

/** `true` when any entry in `pending` still needs the user's pick. */
export function hasUnresolvedMismatches(pending: readonly PendingReconciliation[]): boolean {
  return pending.length > 0;
}
