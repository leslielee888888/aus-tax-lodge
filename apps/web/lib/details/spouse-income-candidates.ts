/**
 * "Offer to copy a spouse's own return's taxable income" (PRD FR-1 / Q8): when
 * this instance holds another return whose taxpayer has a computed taxable
 * income, the details form can offer to copy that figure into the spouse
 * income field — never linking the two returns, just copying a number at this
 * moment.
 */
import { assessCore } from "@aus-tax-lodge/engine";
import { RETURN_MODEL_VERSION, toEngineInput, type ReturnModel } from "@aus-tax-lodge/model";
import type { ReturnRepository } from "@aus-tax-lodge/store";

export interface SpouseIncomeCandidate {
  /** The other return's taxpayer full name — matched against the spouse-name field. */
  readonly name: string;
  readonly taxableIncome: number;
}

function isReturnModel(data: unknown): data is ReturnModel {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { modelVersion?: unknown }).modelVersion === RETURN_MODEL_VERSION
  );
}

/**
 * Every other return in the instance that (a) isn't this one, (b) has a named
 * taxpayer, and (c) has enough confirmed income to compute a taxable income.
 * A return that isn't far enough along yet (still `unset`/`proposed` figures)
 * is silently skipped rather than erroring — this is an offer, not a
 * requirement.
 */
export async function findSpouseIncomeCandidates(
  repository: ReturnRepository,
  excludeReturnId: string,
): Promise<SpouseIncomeCandidate[]> {
  const summaries = await repository.listReturns();
  const candidates: SpouseIncomeCandidate[] = [];

  for (const summary of summaries) {
    if (summary.returnId === excludeReturnId) continue;
    let model: ReturnModel;
    try {
      const { envelope } = await repository.loadReturn(summary.returnId);
      if (!isReturnModel(envelope.data)) continue;
      model = envelope.data;
    } catch {
      continue; // unreadable / malformed — not this form's problem to surface
    }

    const name = model.taxpayer.fullName.value?.trim();
    if (!name) continue;

    try {
      const assessment = assessCore(toEngineInput(model));
      candidates.push({ name, taxableIncome: assessment.taxableIncome });
    } catch {
      // Not confirmed enough yet (MissingFiguresError) or out of the engine's
      // supported residency (FR-20) — no figure to offer yet; not an error for
      // this form.
    }
  }

  return candidates;
}
