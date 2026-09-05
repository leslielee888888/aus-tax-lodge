import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { buttonClassName } from "../../../../components/Button";
import { TopBar } from "../../../../components/TopBar";
import { WizardSteps } from "../../../../components/WizardSteps";
import { formatIncomeYear } from "../../../../lib/format";
import { loadReturnModel } from "../../../../lib/returns";

export const metadata: Metadata = { title: "Review figures · Return Assistant" };
export const dynamic = "force-dynamic";

/**
 * Placeholder for step 3 of the wizard (PRD §7 step 5 / FR-7, FR-21, FR-22). A
 * later task replaces this with the real review-and-confirm screen — showing
 * every proposed figure with its source and confidence, and resolving the
 * `pendingReconciliation` T16 stashed on the model (see
 * `lib/extraction-scratch.ts`). It exists now so T16's "Extract figures" has
 * somewhere in-scope to land.
 */
export default async function ReviewPage({
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
      <WizardSteps current="review" />

      <main className="mx-auto max-w-3xl px-6 py-10 md:px-10">
        <h1 className="text-pretty font-serif text-2xl">Review your figures — coming next</h1>
        <p className="mt-2 text-sm text-muted">
          Confirming proposed figures, resolving mismatches between sources, and the rental
          schedule are built in a later task.
        </p>
        <Link
          href={`/returns/${returnId}/documents`}
          className={`mt-6 ${buttonClassName({ variant: "default" })}`}
        >
          Back to documents
        </Link>
      </main>
    </>
  );
}
