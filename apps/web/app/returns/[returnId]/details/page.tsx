import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { buttonClassName } from "../../../../components/Button";
import { TopBar } from "../../../../components/TopBar";
import { WizardSteps } from "../../../../components/WizardSteps";
import { detailsFormValuesFromModel } from "../../../../lib/details/form";
import { findSpouseIncomeCandidates } from "../../../../lib/details/spouse-income-candidates";
import { formatIncomeYear } from "../../../../lib/format";
import { getReturnRepository, loadReturnModel } from "../../../../lib/returns";
import { DetailsForm } from "./DetailsForm";
import { DetailsReadOnly } from "./DetailsReadOnly";

export const metadata: Metadata = { title: "Your details · Return Assistant" };

// The return may have just been created, or edited from another tab — always read fresh.
export const dynamic = "force-dynamic";

/**
 * Step 1 of the wizard (PRD FR-1, §7 step 3). Renders the editable form for an
 * in-progress return (empty on a fresh return, pre-filled when resuming) or a
 * values-only view for a return read-only under FR-16.
 */
export default async function DetailsPage({
  params,
}: {
  params: Promise<{ returnId: string }>;
}) {
  const { returnId } = await params;

  let loaded: Awaited<ReturnType<typeof loadReturnModel>>;
  try {
    loaded = await loadReturnModel(returnId);
  } catch {
    notFound();
  }
  const { envelope, readOnly, model } = loaded;

  const context = `${model.taxpayer.fullName.value ?? "New return"} · ${formatIncomeYear(envelope.targetYear)}`;
  const spouseIncomeCandidates = readOnly
    ? []
    : await findSpouseIncomeCandidates(getReturnRepository(), returnId);

  return (
    <>
      <TopBar context={context}>
        <Link href="/" className={buttonClassName({ variant: "ghost", size: "sm" })}>
          Save &amp; exit
        </Link>
      </TopBar>
      <WizardSteps current="details" />

      <main className="mx-auto max-w-3xl px-6 py-8 md:px-10">
        <h1 className="text-pretty font-serif text-2xl">Your details</h1>
        <p className="mt-2 text-sm text-muted">
          For the {formatIncomeYear(envelope.targetYear)} income year. These carry onto the
          return exactly as entered.
        </p>

        <div className="mt-6">
          {readOnly ? (
            <DetailsReadOnly model={model} targetYear={envelope.targetYear} />
          ) : (
            <DetailsForm
              returnId={returnId}
              expectedRevision={envelope.revision}
              initialValues={detailsFormValuesFromModel(model)}
              spouseIncomeCandidates={spouseIncomeCandidates}
            />
          )}
        </div>
      </main>
    </>
  );
}
