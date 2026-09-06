import type { Metadata } from "next";
import Link from "next/link";
import type { ComponentType, SVGProps } from "react";
import { notFound, redirect } from "next/navigation";

import { buildLodgeInstructionsData, buildValidationReport } from "@aus-tax-lodge/export";

import { Badge } from "../../../../components/Badge";
import { buttonClassName } from "../../../../components/Button";
import { Card, CardBody, CardHeader, CardTitle } from "../../../../components/Card";
import {
  AlertTriangleIcon,
  CheckIcon,
  ClipboardCheckIcon,
  DownloadIcon,
  FileIcon,
  InfoIcon,
  ListIcon,
} from "../../../../components/icons";
import { PurgedDocumentsNotice } from "../../../../components/PurgedDocumentsNotice";
import { TopBar } from "../../../../components/TopBar";
import { WizardSteps } from "../../../../components/WizardSteps";
import { readAcknowledgedWarningIds } from "../../../../lib/export/acknowledgements";
import { buildExportInput, loadExportContext } from "../../../../lib/export/context";
import { readExportManifest } from "../../../../lib/export/persist";
import { formatIncomeYear } from "../../../../lib/format";
import { RecordsArchive } from "./RecordsArchive";
import { WarningAck } from "./WarningAck";

export const metadata: Metadata = { title: "Validate and export · Return Assistant" };
export const dynamic = "force-dynamic";

interface PackageFile {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly Icon: ComponentType<SVGProps<SVGSVGElement>>;
}

const PACKAGE_FILES: readonly PackageFile[] = [
  {
    slug: "pdf",
    title: "Return summary (PDF)",
    description: "Every figure, laid out in myTax on-screen order — ready to transcribe",
    Icon: FileIcon,
  },
  {
    slug: "json",
    title: "Return data (JSON)",
    description: "The full return keyed by label",
    Icon: FileIcon,
  },
  {
    slug: "report",
    title: "Validation report",
    description: "Checks passed, warnings acknowledged, and every stated assumption",
    Icon: ClipboardCheckIcon,
  },
  {
    slug: "source-index",
    title: "Source index",
    description: "Every dollar traced to a document + page, or to an answer you gave",
    Icon: ListIcon,
  },
];

function DownloadRow({
  file,
  returnId,
  enabled,
}: {
  readonly file: PackageFile;
  readonly returnId: string;
  readonly enabled: boolean;
}) {
  const { Icon } = file;
  return (
    <div className="flex items-center gap-3 py-2.5">
      <span
        className="flex size-[26px] shrink-0 items-center justify-center rounded-[7px] bg-surface-2 text-muted"
        aria-hidden="true"
      >
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold text-text">{file.title}</div>
        <div className="text-[11px] text-muted">{file.description}</div>
      </div>
      {enabled ? (
        <a
          href={`/api/returns/${returnId}/export/${file.slug}`}
          className={buttonClassName({ variant: "default", size: "sm" })}
          download
        >
          <DownloadIcon className="size-3.5" aria-hidden="true" />
          Download
        </a>
      ) : (
        <span
          aria-disabled="true"
          className={`${buttonClassName({ variant: "default", size: "sm" })} pointer-events-none opacity-50`}
        >
          Download
        </span>
      )}
    </div>
  );
}

function LodgeNoteCard({
  headline,
  steps,
  notice,
}: {
  readonly headline: string;
  readonly steps: readonly { readonly heading: string; readonly body: string }[];
  readonly notice: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>How to lodge this in myTax</CardTitle>
      </CardHeader>
      <CardBody className="pt-3">
        <p className="text-xs text-muted">{headline}</p>
        <ol className="mt-3 flex flex-col gap-2.5">
          {steps.map((step) => (
            <li key={step.heading} className="text-[12.5px]">
              <span className="font-medium text-text">{step.heading}</span>
              <p className="mt-0.5 text-[11.5px] text-muted">{step.body}</p>
            </li>
          ))}
        </ol>
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2.5 text-[11px] text-muted">
          <InfoIcon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          {notice}
        </p>
      </CardBody>
    </Card>
  );
}

const STATIC_LODGE_STEPS = [
  {
    heading: "1. Sign in to ATO myTax through myGov",
    body: "Go to my.gov.au, sign in to myGov, and open the ATO service. Nothing here is sent to the ATO — you lodge it yourself.",
  },
  {
    heading: "2. Work through the return label by label using the PDF",
    body: "The return summary lists every figure in the order myTax asks for them. Labels marked [computed] are worked out by myTax / the ATO.",
  },
  {
    heading: "3. Reconcile against myTax pre-fill, then check the estimate and submit",
    body: "Where myTax pre-fill differs, the source index shows which document each figure came from — you decide which to keep. Check the myTax estimate against this one, then submit.",
  },
];

export default async function ExportPage({ params }: { params: Promise<{ returnId: string }> }) {
  const { returnId } = await params;

  let context: Awaited<ReturnType<typeof loadExportContext>>;
  try {
    context = await loadExportContext(returnId);
  } catch {
    notFound();
  }
  const { envelope, readOnly, model, assessment, missingFigures, ready } = context;

  const contextLabel = `${model.taxpayer.fullName.value ?? "New return"} · ${formatIncomeYear(envelope.targetYear)}`;
  const header = (
    <>
      <TopBar context={contextLabel}>
        <Link href="/" className={buttonClassName({ variant: "ghost", size: "sm" })}>
          Save &amp; exit
        </Link>
      </TopBar>
      <WizardSteps current="export" />
    </>
  );

  // --- Read-only past return (PRD FR-16): re-download the saved artifacts only ---
  if (readOnly) {
    const manifest = await readExportManifest(returnId);
    return (
      <>
        {header}
        <main className="mx-auto max-w-2xl px-6 py-8 md:px-10">
          <h1 className="text-pretty font-serif text-2xl">Your export package</h1>
          <p className="mt-1 text-xs text-muted">
            This return is read-only — it was built against a retired tax year. You can re-download
            the export it produced.
          </p>
          <div className="mt-5 flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Your export package</CardTitle>
              </CardHeader>
              <CardBody className="divide-y divide-border pt-1">
                {manifest ? (
                  PACKAGE_FILES.map((file) => (
                    <DownloadRow key={file.slug} file={file} returnId={returnId} enabled />
                  ))
                ) : (
                  <p className="py-3 text-xs text-muted">No export was saved for this return.</p>
                )}
              </CardBody>
            </Card>
            <LodgeNoteCard
              headline={`How to lodge your ${formatIncomeYear(envelope.targetYear)} return in myTax`}
              steps={STATIC_LODGE_STEPS}
              notice="This tool does not connect to the ATO. Your return is not sent to the ATO by this app. Lodgement happens only when you submit in myTax yourself."
            />
          </div>
        </main>
      </>
    );
  }

  // --- Not ready: mirror the estimate screen and send the user back to review ---
  if (!ready) {
    redirect(`/returns/${returnId}/review`);
  }

  if (missingFigures || !assessment) {
    return (
      <>
        {header}
        <main className="mx-auto max-w-3xl px-6 py-10 md:px-10">
          <h1 className="text-pretty font-serif text-2xl">We&rsquo;re missing a few figures</h1>
          <p className="mt-2 text-sm text-muted">
            The export needs every figure confirmed first. Go back to the review step, confirm
            these, then return here.
          </p>
          <ul className="mt-4 list-disc pl-5 text-sm text-text">
            {(missingFigures ?? []).map((field) => (
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

  const acknowledgedWarningIds = await readAcknowledgedWarningIds(returnId);
  const input = buildExportInput(context, acknowledgedWarningIds, new Date().toISOString());
  const report = buildValidationReport(input);
  const lodge = buildLodgeInstructionsData(input);
  const purgedAt = (await readExportManifest(returnId).catch(() => null))?.sourceDocumentsPurgedAt;

  const allWarningsAcknowledged = report.warnings.every((w) => w.acknowledged);
  const downloadsEnabled = !report.exportBlocked && allWarningsAcknowledged;
  const acknowledgedCount = report.warnings.filter((w) => w.acknowledged).length;

  const disabledReason = report.exportBlocked
    ? "Fix the errors above on the review step first."
    : !allWarningsAcknowledged
      ? "Acknowledge every warning above first."
      : undefined;

  return (
    <>
      {header}
      <main className="mx-auto max-w-2xl px-6 py-8 md:px-10">
        <h1 className="text-pretty font-serif text-2xl">Validate and export</h1>
        <p className="mt-1 text-xs text-muted">
          Last checks, then your package. Nothing is sent to the ATO — you lodge in myTax.
        </p>

        {purgedAt ? (
          <div className="mt-4">
            <PurgedDocumentsNotice purgedAt={purgedAt} />
          </div>
        ) : null}

        <div className="mt-5 flex flex-col gap-4">
          {/* --- Checks (PRD FR-13) --- */}
          <Card>
            <CardHeader className="justify-between">
              <CardTitle>Checks</CardTitle>
              {report.warnings.length > 0 ? (
                <span className="text-[11px] text-muted">
                  {acknowledgedCount} of {report.warnings.length} warning
                  {report.warnings.length === 1 ? "" : "s"} acknowledged
                </span>
              ) : null}
            </CardHeader>
            <CardBody className="flex flex-col gap-2 pt-3">
              {report.exportBlocked ? (
                <div className="rounded-lg border border-danger bg-danger-soft px-3 py-2.5 text-xs text-danger">
                  <p className="font-medium">These must be fixed before you can export:</p>
                  <ul className="mt-1.5 list-disc pl-4">
                    {report.errors.map((error) => (
                      <li key={error.id}>{error.message}</li>
                    ))}
                  </ul>
                  <Link
                    href={`/returns/${returnId}/review`}
                    className="mt-2 inline-block underline underline-offset-2"
                  >
                    Back to review
                  </Link>
                </div>
              ) : null}

              {report.checks.map((check) => (
                <div key={check.id} className="flex items-start gap-2 text-[13px]">
                  {check.status === "passed" ? (
                    <span
                      className="mt-px flex size-[17px] shrink-0 items-center justify-center rounded-full bg-ok text-white"
                      aria-hidden="true"
                    >
                      <CheckIcon className="size-2.5" />
                    </span>
                  ) : (
                    <span
                      className="mt-px flex size-[17px] shrink-0 items-center justify-center rounded-full bg-warn-soft text-warn"
                      aria-hidden="true"
                    >
                      <AlertTriangleIcon className="size-2.5" />
                    </span>
                  )}
                  <span className={check.status === "failed" ? "text-danger" : undefined}>
                    {check.description}
                    <span className="sr-only">
                      {" "}
                      — {check.status === "passed" ? "passed" : check.status}
                    </span>
                  </span>
                </div>
              ))}

              {report.warnings.length > 0 ? (
                <div className="mt-1 flex flex-col gap-2 border-t border-border pt-2">
                  {report.warnings.map((warning) => (
                    <div
                      key={warning.id}
                      className="flex flex-wrap items-start justify-between gap-2 rounded-lg bg-warn-soft px-3 py-2 text-[12px] text-warn"
                    >
                      <span className="min-w-0 flex-1">{warning.message}</span>
                      {warning.acknowledged ? (
                        <Badge tone="ok">Acknowledged</Badge>
                      ) : (
                        <WarningAck returnId={returnId} warningId={warning.id} />
                      )}
                    </div>
                  ))}
                </div>
              ) : null}
            </CardBody>
          </Card>

          {/* --- Stated assumptions (PRD FR-14 c) --- */}
          {report.statedAssumptions.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Stated assumptions</CardTitle>
              </CardHeader>
              <CardBody className="pt-3">
                <ul className="flex flex-col gap-2">
                  {report.statedAssumptions.map((assumption) => (
                    <li key={assumption} className="flex items-start gap-2 text-[12px] text-muted">
                      <InfoIcon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                      {assumption}
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}

          {/* --- Export package (PRD FR-14 a-d) --- */}
          <Card>
            <CardHeader>
              <CardTitle>Your export package</CardTitle>
            </CardHeader>
            <CardBody className="divide-y divide-border pt-1">
              {PACKAGE_FILES.map((file) => (
                <DownloadRow
                  key={file.slug}
                  file={file}
                  returnId={returnId}
                  enabled={downloadsEnabled}
                />
              ))}
              {!downloadsEnabled && disabledReason ? (
                <p className="pt-2.5 text-[11px] text-muted">{disabledReason}</p>
              ) : null}
            </CardBody>
          </Card>

          {/* --- Records archive (PRD FR-14, FR-18) --- */}
          <Card>
            <CardHeader>
              <CardTitle>Records archive</CardTitle>
            </CardHeader>
            <CardBody className="pt-3">
              <p className="mb-3 text-xs text-muted">
                One encrypted zip — the return, the PDF, the reports, and every source document —
                for your own records. The ATO expects you to keep these for 5 years.
              </p>
              <RecordsArchive
                returnId={returnId}
                targetYear={envelope.targetYear}
                disabled={!downloadsEnabled}
                disabledReason={disabledReason}
              />
            </CardBody>
          </Card>

          {/* --- How to lodge (PRD §7 step 8) --- */}
          <LodgeNoteCard
            headline={lodge.headline}
            steps={lodge.steps}
            notice={lodge.noTransmissionNotice}
          />
        </div>

        <div className="mt-6">
          <Link
            href={`/returns/${returnId}/estimate`}
            className={buttonClassName({ variant: "ghost" })}
          >
            Back to estimate
          </Link>
        </div>
      </main>
    </>
  );
}
