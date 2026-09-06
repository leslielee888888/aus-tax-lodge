import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { buttonClassName } from "../../../../components/Button";
import { TopBar } from "../../../../components/TopBar";
import { WizardSteps } from "../../../../components/WizardSteps";
import { readExtractionScratch } from "../../../../lib/extraction-scratch";
import { formatIncomeYear } from "../../../../lib/format";
import {
  detailsHoldsStudyLoan,
  detailsResidentFullYear,
  initialQuestionsFormValues,
  rentalAddressLabel,
  unsettledJointAccounts,
} from "../../../../lib/questions/form";
import { buildReviewData } from "../../../../lib/review/build-sections";
import { loadReturnModel } from "../../../../lib/returns";
import { getDocumentStore } from "../../../../lib/store";
import { QuestionsForm } from "./QuestionsForm";
import { QuestionsReadOnly } from "./QuestionsReadOnly";

export const metadata: Metadata = { title: "Questions · Return Assistant" };
// The model can change from another step/tab — always read fresh.
export const dynamic = "force-dynamic";

/**
 * Step 4 of the wizard (PRD FR-6, §7 step 6) — the structured gap
 * questionnaire for facts no document carries: residency (cross-check),
 * joint-account shares, study loan (cross-check), private-cover dates, the
 * WFH double-claim guard, and — for a rental — the scope gate.
 *
 * **Gating choice:** this only makes sense once review is settled (every
 * in-scope figure confirmed, no unresolved mismatches, no outstanding rental
 * repairs confirmation) — `T17`'s "Continue to questions" button already
 * checks exactly this via `buildReviewData(...).canContinue` before it will
 * link here. A direct visit to this URL before that point re-runs the same
 * check and redirects back to `/review` rather than rendering a form against
 * figures that aren't confirmed yet — `isReadyForEstimate` isn't usable for
 * this gate because it also requires the questionnaire itself to be
 * answered, which is circular for the page whose job *is* answering it.
 * A read-only (past, retired-year) return skips the gate entirely and always
 * renders the read-only view.
 */
export default async function QuestionsPage({
  params,
}: {
  params: Promise<{ returnId: string }>;
}) {
  const { returnId } = await params;

  let loaded: Awaited<ReturnType<typeof loadReturnModel>>;
  let documents: Awaited<ReturnType<ReturnType<typeof getDocumentStore>["listDocuments"]>>;
  try {
    loaded = await loadReturnModel(returnId);
    documents = await getDocumentStore().listDocuments(returnId);
  } catch {
    notFound();
  }
  const { envelope, readOnly, model } = loaded;

  if (!readOnly) {
    const documentsByDocId = Object.fromEntries(documents.map((d) => [d.docId, d.filename]));
    const scratch = readExtractionScratch(model);
    const { canContinue } = buildReviewData(model, scratch.pendingReconciliation, documentsByDocId);
    if (!canContinue) {
      redirect(`/returns/${returnId}/review`);
    }
  }

  const context = `${model.taxpayer.fullName.value ?? "New return"} · ${formatIncomeYear(envelope.targetYear)}`;

  return (
    <>
      <TopBar context={context}>
        <Link href="/" className={buttonClassName({ variant: "ghost", size: "sm" })}>
          Save &amp; exit
        </Link>
      </TopBar>
      <WizardSteps current="questions" />

      <main className="mx-auto max-w-3xl px-6 py-8 md:px-10">
        <h1 className="text-pretty font-serif text-2xl">A few more questions</h1>
        <p className="mt-2 text-sm text-muted">
          These aren&rsquo;t in any document. Your answers are recorded on the return as entered by
          you.
        </p>

        <div className="mt-5">
          {readOnly ? (
            <QuestionsReadOnly model={model} targetYear={envelope.targetYear} />
          ) : (
            <QuestionsForm
              returnId={returnId}
              expectedRevision={envelope.revision}
              initialValues={initialQuestionsFormValues(model)}
              jointAccounts={unsettledJointAccounts(model)}
              rentalPresent={model.rental.present}
              rentalAddressLabel={rentalAddressLabel(model)}
              detailsResidentFullYear={detailsResidentFullYear(model)}
              detailsHoldsStudyLoan={detailsHoldsStudyLoan(model)}
            />
          )}
        </div>
      </main>
    </>
  );
}
