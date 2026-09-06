import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { assess, PARAMS_VERSION } from "@aus-tax-lodge/engine";
import { isReadyForEstimate, MissingFiguresError, toEngineInput } from "@aus-tax-lodge/model";

import { buttonClassName } from "../../../../components/Button";
import { InfoIcon } from "../../../../components/icons";
import { TopBar } from "../../../../components/TopBar";
import { WizardSteps } from "../../../../components/WizardSteps";
import { buildEstimateBreakdown } from "../../../../lib/estimate/breakdown";
import { formatIncomeYear } from "../../../../lib/format";
import { loadReturnModel } from "../../../../lib/returns";
import { ContinueToExport } from "./ContinueToExport";
import { EstimateBreakdownCard } from "./EstimateBreakdownCard";

export const metadata: Metadata = { title: "Estimate · Return Assistant" };
// The model can change from the review / questions steps (another tab, or a
// step back in this one). Reading it fresh on every request and recomputing the
// assessment here — no client-side engine call — is what makes the estimate
// "recompute on edit" (PRD FR-12): any saved edit shows up the next time this
// page is opened.
export const dynamic = "force-dynamic";

/**
 * Step 5 of the wizard (PRD FR-12, FR-15, FR-23, FR-24, §7 step 7) — the
 * refund / amount-owing estimate and its plain-English breakdown.
 *
 * **Gating:** the estimate only makes sense once every in-scope figure is
 * confirmed and the questionnaire is answered. A non-read-only return that
 * isn't {@link isReadyForEstimate} is redirected back to `/review` (mirroring
 * how `questions/page.tsx` gates on `buildReviewData(...).canContinue`). A
 * read-only (retired-param-year) return still shows its estimate — it's
 * informational and the screen has no inputs to edit anyway.
 *
 * If `toEngineInput` still throws despite the gate passing (it shouldn't), the
 * page shows a friendly "missing a few figures" panel rather than crashing.
 */
export default async function EstimatePage({ params }: { params: Promise<{ returnId: string }> }) {
  const { returnId } = await params;

  let loaded: Awaited<ReturnType<typeof loadReturnModel>>;
  try {
    loaded = await loadReturnModel(returnId);
  } catch {
    notFound();
  }
  const { envelope, readOnly, model } = loaded;

  if (!readOnly && !isReadyForEstimate(model)) {
    redirect(`/returns/${returnId}/review`);
  }

  const context = `${model.taxpayer.fullName.value ?? "New return"} · ${formatIncomeYear(envelope.targetYear)}`;

  const header = (
    <>
      <TopBar context={context}>
        <Link href="/" className={buttonClassName({ variant: "ghost", size: "sm" })}>
          Save &amp; exit
        </Link>
      </TopBar>
      <WizardSteps current="estimate" />
    </>
  );

  let missingFigures: readonly string[] | null = null;
  let breakdown: ReturnType<typeof buildEstimateBreakdown> | null = null;
  try {
    const assessment = assess(toEngineInput(model));
    breakdown = buildEstimateBreakdown(model, assessment, returnId);
  } catch (err) {
    if (err instanceof MissingFiguresError) {
      missingFigures = err.fields;
    } else {
      throw err;
    }
  }

  if (missingFigures) {
    return (
      <>
        {header}
        <main className="mx-auto max-w-3xl px-6 py-10 md:px-10">
          <h1 className="text-pretty font-serif text-2xl">We&rsquo;re missing a few figures</h1>
          <p className="mt-2 text-sm text-muted">
            The estimate needs every figure confirmed first. Go back to the review step and confirm
            these, then return here.
          </p>
          <ul className="mt-4 list-disc pl-5 text-sm text-text">
            {missingFigures.map((field) => (
              <li key={field}>{field}</li>
            ))}
          </ul>
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

  // `breakdown` is non-null here — the only `catch` path that leaves it null
  // sets `missingFigures` and returns above.
  const data = breakdown!;

  return (
    <>
      {header}
      <main className="mx-auto max-w-2xl px-6 py-8 md:px-10">
        <h1 className="text-pretty font-serif text-2xl">Your estimate</h1>
        <p className="mt-1 text-xs text-muted">
          Based on the figures you confirmed. This is an estimate — the ATO&rsquo;s assessment is
          the final word.
        </p>

        <div className="mt-5">
          <EstimateBreakdownCard breakdown={data} />
        </div>

        <div className="mt-3 flex items-start gap-2 text-[11px] text-muted">
          <InfoIcon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          <p className="text-pretty">
            Every line links back to the figures behind it. This is an estimate, not the ATO&rsquo;s
            assessment: the ATO may hold information this tool doesn&rsquo;t — prior-year losses,
            PAYG instalments, HELP indexation timing, other income — and its notice of assessment is
            the final figure.
            {data.rentalLossAddBack ? (
              <>
                {" "}
                Your rental loss lowers your taxable income, but it is <em>added back</em> for the
                income tests that set your Medicare levy surcharge, study/training loan repayment
                and private health rebate tier — so those are worked out as if the loss hadn&rsquo;t
                happened.
              </>
            ) : null}
          </p>
        </div>

        <div className="mt-6 flex items-center justify-between gap-3">
          <Link
            href={`/returns/${returnId}/questions`}
            className={buttonClassName({ variant: "ghost" })}
          >
            Back
          </Link>
          {readOnly ? (
            <Link
              href={`/returns/${returnId}/export`}
              className={buttonClassName({ variant: "primary" })}
            >
              Continue to export
            </Link>
          ) : (
            <ContinueToExport returnId={returnId} revision={envelope.revision} />
          )}
        </div>

        <p className="mt-4 text-[10.5px] text-muted">
          Calculated against tax-parameter set {PARAMS_VERSION}.
        </p>
      </main>
    </>
  );
}
