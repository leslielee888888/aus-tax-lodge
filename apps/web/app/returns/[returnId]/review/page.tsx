import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { detectOutOfScope, isBlocked } from "@aus-tax-lodge/scope";

import { buttonClassName } from "../../../../components/Button";
import { PurgedDocumentsNotice } from "../../../../components/PurgedDocumentsNotice";
import { TopBar } from "../../../../components/TopBar";
import { WizardSteps } from "../../../../components/WizardSteps";
import { readExportManifest } from "../../../../lib/export/persist";
import { readExtractionScratch } from "../../../../lib/extraction-scratch";
import { formatIncomeYear } from "../../../../lib/format";
import { buildReviewData } from "../../../../lib/review/build-sections";
import { loadReturnModel } from "../../../../lib/returns";
import { getDocumentStore } from "../../../../lib/store";
import { OutOfScopeReviewStop } from "./OutOfScopeReviewStop";
import { ReviewReadOnly } from "./ReviewReadOnly";
import { ReviewSections } from "./ReviewSections";

export const metadata: Metadata = { title: "Review figures · Return Assistant" };
// The model, documents and reconciliation state can all change from another
// step/tab — always read fresh.
export const dynamic = "force-dynamic";

/**
 * Step 3 of the wizard (PRD FR-7, FR-20, FR-21, FR-24, §7 step 5) — the heart
 * of the app: every proposed figure is confirmed here before the return can
 * proceed. Runs `detectOutOfScope` first; a blocked return gets the hard-stop
 * screen instead of the review UI, with no way to continue (FR-20).
 *
 * `documents` (filename + detected type) are trivially at hand here and are
 * passed to the detector, but T11's Claude content-classification pass
 * (`checkDocumentForOutOfScopeContent` in `@aus-tax-lodge/scope`) is not yet
 * wired into the extraction pipeline, so `contentFindings` is not available —
 * a document whose *content* implies an out-of-scope item (e.g. a "dividend
 * statement" that's actually a trust distribution) is not yet caught here.
 * Follow-up for whichever task wires T11's extraction run to that check.
 */
export default async function ReviewPage({ params }: { params: Promise<{ returnId: string }> }) {
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

  const findings = detectOutOfScope({
    model,
    documents: documents.map((d) => ({
      docId: d.docId,
      detectedType: d.detectedType,
      filename: d.filename,
    })),
  });

  const context = `${model.taxpayer.fullName.value ?? "New return"} · ${formatIncomeYear(envelope.targetYear)}`;

  if (isBlocked(findings)) {
    return (
      <>
        <TopBar context={context}>
          <Link href="/" className={buttonClassName({ variant: "ghost", size: "sm" })}>
            Save &amp; exit
          </Link>
        </TopBar>
        <WizardSteps current="review" />
        <OutOfScopeReviewStop returnId={returnId} findings={findings} />
      </>
    );
  }

  const documentsByDocId = Object.fromEntries(documents.map((d) => [d.docId, d.filename]));
  const purgedAt = (await readExportManifest(returnId).catch(() => null))?.sourceDocumentsPurgedAt;

  return (
    <>
      <TopBar context={context}>
        <Link href="/" className={buttonClassName({ variant: "ghost", size: "sm" })}>
          Save &amp; exit
        </Link>
      </TopBar>
      <WizardSteps current="review" />

      <main className="mx-auto max-w-4xl px-6 py-8 md:px-10">
        <h1 className="text-pretty font-serif text-2xl">Review the figures</h1>
        <p className="mt-2 text-sm text-muted">
          Confirm every figure. Each one shows where it came from — open the source to check
          anything you&rsquo;re unsure of.
        </p>

        {purgedAt ? (
          <div className="mt-5">
            <PurgedDocumentsNotice purgedAt={purgedAt} />
          </div>
        ) : null}

        <div className="mt-5">
          {readOnly ? (
            <ReviewReadOnly
              data={buildReviewData(
                model,
                readExtractionScratch(model).pendingReconciliation,
                documentsByDocId,
              )}
            />
          ) : (
            <ReviewSections
              returnId={returnId}
              initialModel={model}
              initialRevision={envelope.revision}
              documentsByDocId={documentsByDocId}
            />
          )}
        </div>
      </main>
    </>
  );
}
