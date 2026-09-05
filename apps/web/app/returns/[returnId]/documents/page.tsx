import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { buttonClassName } from "../../../../components/Button";
import { TopBar } from "../../../../components/TopBar";
import { WizardSteps } from "../../../../components/WizardSteps";
import { formatIncomeYear } from "../../../../lib/format";
import { loadReturnModel } from "../../../../lib/returns";

export const metadata: Metadata = { title: "Documents · Return Assistant" };
export const dynamic = "force-dynamic";

/**
 * Placeholder for step 2 of the wizard (PRD §7 step 4 / FR-2, FR-3). T16
 * replaces this with the real upload-and-classify screen. It exists now so
 * T15's "Save and continue" has somewhere in-scope to land.
 */
export default async function DocumentsPage({
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
      <WizardSteps current="documents" />

      <main className="mx-auto max-w-3xl px-6 py-10 md:px-10">
        <h1 className="text-pretty font-serif text-2xl">Upload documents</h1>
        <p className="mt-2 text-sm text-muted">
          Drag-and-drop upload, classification and extraction — coming in T16.
        </p>
        <Link
          href={`/returns/${returnId}/details`}
          className={`mt-6 ${buttonClassName({ variant: "default" })}`}
        >
          Back to your details
        </Link>
      </main>
    </>
  );
}
