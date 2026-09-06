import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { buttonClassName } from "../../../../components/Button";
import { TopBar } from "../../../../components/TopBar";
import { WizardSteps } from "../../../../components/WizardSteps";
import { formatIncomeYear } from "../../../../lib/format";
import { loadReturnModel } from "../../../../lib/returns";

export const metadata: Metadata = { title: "Estimate · Return Assistant" };
export const dynamic = "force-dynamic";

/**
 * Placeholder for step 5 of the wizard (PRD FR-12, §7 step 7) — the
 * assessment estimate. A later task (T19, which calls `@aus-tax-lodge/engine`
 * `assess()` via `toEngineInput`) replaces this with the real screen. It
 * exists now so T18's "See your estimate" has somewhere in-scope to land once
 * the gap questionnaire is answered.
 *
 * That later task can read "questionnaire complete" straight off the model
 * with `isReadyForEstimate(model)` (PRD FR-6, FR-24) — by the time a return
 * reaches this step every in-scope label, including the synthetic
 * questionnaire rows, is settled. `envelope.currentStep` is `"estimate"` once
 * T18 has advanced a return past the questionnaire.
 */
export default async function EstimatePage({
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
      <WizardSteps current="estimate" />

      <main className="mx-auto max-w-3xl px-6 py-10 md:px-10">
        <h1 className="text-pretty font-serif text-2xl">Estimate — coming next</h1>
        <p className="mt-2 text-sm text-muted">
          The refund/owing estimate and its plain-English breakdown are built in a later task.
        </p>
        <Link
          href={`/returns/${returnId}/questions`}
          className={`mt-6 ${buttonClassName({ variant: "default" })}`}
        >
          Back to questions
        </Link>
      </main>
    </>
  );
}
