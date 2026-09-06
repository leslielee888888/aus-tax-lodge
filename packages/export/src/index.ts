/**
 * `@aus-tax-lodge/export` — deterministic, filesystem-free builders for the
 * lodgement export package (PRD FR-14) and its FR-22 source index.
 *
 * Zero framework deps. The web layer (`apps/web/lib/export`) loads the model +
 * documents, computes the assessment exactly as the estimate screen does, and
 * calls {@link assembleExportPackage} to get the PDF + JSON + validation report
 * + source index. The encrypted records archive (the four artifacts plus every
 * source document, in one AES-256 zip) is assembled in the web layer, which
 * has the document store and the zip library.
 */
export type {
  ExportArtifact,
  ExportDocumentRef,
  ExportPackage,
  ExportPackageInput,
  ReturnView,
  ReturnViewEstimate,
  ReturnViewLabel,
  ReturnViewRentalSchedule,
  ReturnViewSection,
  ReturnViewTaxpayer,
} from "./types";

export { formatDollars, sumToCents } from "./money";
export { buildReturnView } from "./view";

export { buildReturnJson, type ReturnJson, type ReturnJsonLabel } from "./json";

export {
  renderReturnPdfLines,
  renderReturnPdfText,
  type PdfLine,
  type PdfLineStyle,
} from "./pdf-text";
export { buildReturnPdf } from "./pdf";

export {
  buildValidationReport,
  renderValidationReportText,
  issueId,
  type ValidationReport,
  type ValidationReportCheck,
  type ValidationReportIssue,
  type ValidationReportWarning,
} from "./validation-report";

export {
  buildSourceIndex,
  renderSourceIndexText,
  type SourceIndex,
  type SourceIndexEntry,
  type SourceIndexOrigin,
} from "./source-index";

export {
  buildLodgeInstructions,
  buildLodgeInstructionsData,
  type LodgeInstructions,
  type LodgeStep,
} from "./lodge-instructions";

export {
  assembleExportPackage,
  returnPdfFilename,
  returnJsonFilename,
  validationReportFilename,
  sourceIndexFilename,
  lodgeInstructionsFilename,
} from "./assemble";
