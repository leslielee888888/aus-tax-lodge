import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { buttonClassName } from "../../../../components/Button";
import { TopBar } from "../../../../components/TopBar";
import { WizardSteps } from "../../../../components/WizardSteps";
import { formatIncomeYear } from "../../../../lib/format";
import { loadReturnModel } from "../../../../lib/returns";

export const metadata: Metadata = { title: "Export · Return Assistant" };
export const dynamic = "force-dynamic";

/**
 * Placeholder for step 6 of the wizard (PRD §7 step 8) — the export / lodgement
 * pack. T20 replaces this with the real screen. It exists now so T19's
 * "Continue to export" has somewhere in-scope to land.
 */
export default async function ExportPage({ params }: { params: Promise<{ returnId: string }> }) {
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
      <WizardSteps current="export" />

      <main className="mx-auto max-w-3xl px-6 py-10 md:px-10">
        <h1 className="text-pretty font-serif text-2xl">Export — coming next</h1>
        <p className="mt-2 text-sm text-muted">
          The lodgement pack and myTax transcription checklist are built in a later task.
        </p>
        <Link
          href={`/returns/${returnId}/estimate`}
          className={`mt-6 ${buttonClassName({ variant: "default" })}`}
        >
          Back to estimate
        </Link>
      </main>
    </>
  );
}
