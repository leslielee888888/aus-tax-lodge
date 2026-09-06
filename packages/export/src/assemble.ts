/**
 * Assembles the four export-package artifacts (PRD FR-14 a–d) as
 * `{ filename, contentType, bytes }` entries. Deterministic and
 * filesystem-free — the web layer persists them (encrypted at rest) and streams
 * them to the browser.
 */
import { buildReturnJson } from "./json";
import { buildReturnPdf } from "./pdf";
import { buildSourceIndex, renderSourceIndexText } from "./source-index";
import type { ExportArtifact, ExportPackage, ExportPackageInput } from "./types";
import { buildValidationReport, renderValidationReportText } from "./validation-report";

const ENCODER = new TextEncoder();

function textArtifact(filename: string, contentType: string, text: string): ExportArtifact {
  return { filename, contentType, bytes: ENCODER.encode(text) };
}

/** Base filename stem for a given year, e.g. `2025-26`. */
function stem(targetYear: string): string {
  return targetYear;
}

export function returnPdfFilename(targetYear: string): string {
  return `return-summary-${stem(targetYear)}.pdf`;
}
export function returnJsonFilename(targetYear: string): string {
  return `return-data-${stem(targetYear)}.json`;
}
export function validationReportFilename(targetYear: string): string {
  return `validation-report-${stem(targetYear)}.txt`;
}
export function sourceIndexFilename(targetYear: string): string {
  return `source-index-${stem(targetYear)}.txt`;
}
export function lodgeInstructionsFilename(targetYear: string): string {
  return `how-to-lodge-in-myTax-${stem(targetYear)}.txt`;
}

/** Build all four artifacts of the export package (PRD FR-14). */
export async function assembleExportPackage(input: ExportPackageInput): Promise<ExportPackage> {
  const resolved: ExportPackageInput = {
    ...input,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
  };

  const pdfBytes = await buildReturnPdf(resolved);
  const json = buildReturnJson(resolved);
  const validationReport = buildValidationReport(resolved);
  const sourceIndex = buildSourceIndex(resolved);

  return {
    pdf: {
      filename: returnPdfFilename(resolved.targetYear),
      contentType: "application/pdf",
      bytes: pdfBytes,
    },
    json: textArtifact(
      returnJsonFilename(resolved.targetYear),
      "application/json",
      `${JSON.stringify(json, null, 2)}\n`,
    ),
    validationReport: textArtifact(
      validationReportFilename(resolved.targetYear),
      "text/plain; charset=utf-8",
      renderValidationReportText(validationReport),
    ),
    sourceIndex: textArtifact(
      sourceIndexFilename(resolved.targetYear),
      "text/plain; charset=utf-8",
      renderSourceIndexText(sourceIndex),
    ),
  };
}
