import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { buttonClassName } from "../../../../components/Button";
import { FileIcon } from "../../../../components/icons";
import { PurgedDocumentsNotice } from "../../../../components/PurgedDocumentsNotice";
import { TopBar } from "../../../../components/TopBar";
import { WizardSteps } from "../../../../components/WizardSteps";
import { readExportManifest } from "../../../../lib/export/persist";
import { readExtractionScratch } from "../../../../lib/extraction-scratch";
import { formatIncomeYear } from "../../../../lib/format";
import { loadReturnModel } from "../../../../lib/returns";
import { getDocumentStore } from "../../../../lib/store";
import { DocumentsPanel } from "./DocumentsPanel";
import { DocumentsReadOnly } from "./DocumentsReadOnly";

export const metadata: Metadata = { title: "Documents · Return Assistant" };
// Documents and the model can change from another tab/step — always read fresh.
export const dynamic = "force-dynamic";

/**
 * Step 2 of the wizard (PRD FR-2, FR-3, §7 step 4). Loads the return's current
 * documents and model, then hands off to {@link DocumentsPanel} for the
 * interactive upload / classify / extract flow, or {@link DocumentsReadOnly}
 * for a return that's read-only under FR-16.
 */
export default async function DocumentsPage({ params }: { params: Promise<{ returnId: string }> }) {
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
  const scratch = readExtractionScratch(model);
  const purgedAt = (await readExportManifest(returnId).catch(() => null))?.sourceDocumentsPurgedAt;

  return (
    <>
      <TopBar
        context={`${model.taxpayer.fullName.value ?? "New return"} · ${formatIncomeYear(envelope.targetYear)}`}
      >
        <Link href="/" className={buttonClassName({ variant: "ghost", size: "sm" })}>
          Save &amp; exit
        </Link>
      </TopBar>
      <WizardSteps current="documents" />

      <main className="mx-auto max-w-4xl px-6 py-8 md:px-10">
        <h1 className="text-pretty font-serif text-2xl">Upload your documents</h1>
        <p className="mt-2 text-sm text-muted">
          Drag files in below. We read each one and propose the figures — you confirm them next.
        </p>

        {purgedAt ? (
          <div className="mt-5">
            <PurgedDocumentsNotice purgedAt={purgedAt} />
          </div>
        ) : null}

        <div className="mt-5 flex items-start gap-3 rounded-[10px] border border-border bg-accent-soft p-4">
          <span
            className="flex size-[30px] shrink-0 items-center justify-center rounded-[7px] border border-border bg-surface text-accent"
            aria-hidden="true"
          >
            <FileIcon className="size-4" />
          </span>
          <div>
            <p className="text-sm font-semibold">Start with your ATO pre-fill report</p>
            <p className="mt-0.5 text-xs text-muted">
              Download it from myGov → ATO → Tax → Lodgments → Income tax → Pre-fill. It carries
              most of your income in one file; every other document is checked against it.
            </p>
          </div>
        </div>

        <div className="mt-5">
          {readOnly ? (
            <DocumentsReadOnly documents={documents} />
          ) : (
            <DocumentsPanel
              returnId={returnId}
              expectedRevision={envelope.revision}
              initialDocuments={documents}
              rentalPresent={model.rental.present}
              initialExtracted={scratch.extracted}
            />
          )}
        </div>
      </main>
    </>
  );
}
