import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { buttonClassName } from "../../../../components/Button";
import { TopBar } from "../../../../components/TopBar";
import { WizardSteps } from "../../../../components/WizardSteps";
import { formatIncomeYear } from "../../../../lib/format";
import { loadReturnModel } from "../../../../lib/returns";

export const metadata: Metadata = { title: "Questions · Return Assistant" };
export const dynamic = "force-dynamic";

/**
 * Placeholder for step 4 of the wizard (PRD FR-6, §7 step 6) — the structured
 * gap questionnaire. A later task replaces this with the real screen. It
 * exists now so T17's "Continue to questions" has somewhere in-scope to land
 * once a return is fully reviewed.
 *
 * That later task can read "review is complete" straight off the model with
 * `isReadyForEstimate(model)` plus `hasUnresolvedMismatches(readExtractionScratch(model).pendingReconciliation)`
 * both settled, and no outstanding rental repairs confirmation
 * (`needsRepairsConfirmation(model.rental)` false) — the same three gates
 * `/review`'s "Continue" button checks. `envelope.currentStep` is `"questions"`
 * once T17 has advanced a return past review.
 */
export default async function QuestionsPage({
  params,
}: {
  params: Promise<{ returnId: string }>;
}) {
  const { returnId } = await params;

  let targetYear: string;
  try {
    const loaded = await loadReturnModel(returnId);
    targetYear = loaded.envelope.targetYear;
  } catch {
    notFound();
  }

  return (
    <>
      <TopBar context={`New return · ${formatIncomeYear(targetYear)}`}>
        <Link href="/" className={buttonClassName({ variant: "ghost", size: "sm" })}>
          Save &amp; exit
        </Link>
      </TopBar>
      <WizardSteps current="questions" />

      <main className="mx-auto max-w-3xl px-6 py-10 md:px-10">
        <h1 className="text-pretty font-serif text-2xl">Gap questionnaire — coming next</h1>
        <p className="mt-2 text-sm text-muted">
          The structured questions that fill in what your documents couldn&rsquo;t answer are built in a
          later task.
        </p>
        <Link
          href={`/returns/${returnId}/review`}
          className={`mt-6 ${buttonClassName({ variant: "default" })}`}
        >
          Back to review
        </Link>
      </main>
    </>
  );
}
