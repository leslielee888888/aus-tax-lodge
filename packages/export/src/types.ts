/**
 * Shared shapes for the lodgement export package (PRD FR-14, FR-22).
 *
 * Everything here is plain data — no filesystem, no framework, no store. The
 * web layer (`apps/web/lib/export`) loads the model + documents, computes the
 * assessment the same way the estimate screen does, and hands this package a
 * fully-resolved {@link ExportPackageInput}.
 */
import type { FullAssessment } from "@aus-tax-lodge/engine";
import type { ReturnModel } from "@aus-tax-lodge/model";
import type { LabelTaxonomy, MyTaxSection } from "@aus-tax-lodge/params";

/** One uploaded source document, named so the source index / archive can refer to it. */
export interface ExportDocumentRef {
  readonly docId: string;
  readonly filename: string;
}

/** The fully-resolved input to every builder in this package. */
export interface ExportPackageInput {
  readonly model: ReturnModel;
  /** The engine assessment for `model` — `assess(toEngineInput(model))`, exactly as the estimate screen computes it (PRD FR-14 "figures must match"). */
  readonly assessment: FullAssessment;
  /** The label taxonomy for `targetYear` — `getTaxonomy(targetYear)`. */
  readonly taxonomy: LabelTaxonomy;
  /** Curated tax-parameter dataset version the return was built against (PRD FR-15). */
  readonly paramsVersion: string;
  /** ATO income year, e.g. `"2025-26"`. */
  readonly targetYear: string;
  /** Every uploaded source document (metadata only). */
  readonly documents: readonly ExportDocumentRef[];
  /**
   * Ids ({@link issueId}) of the validation warnings the user has acknowledged
   * on the export screen. Listed in the validation report (PRD FR-14 c).
   */
  readonly acknowledgedWarningIds: readonly string[];
  /**
   * Every stated assumption, in plain English (e.g. "Spouse taxable income is
   * an estimate the user entered"). Listed in the validation report.
   */
  readonly statedAssumptions: readonly string[];
  /** ISO-8601 instant the package was produced. Defaults to `new Date()`. */
  readonly generatedAt?: string;
}

// ---------------------------------------------------------------------------
// Return view — the single label-keyed source both the PDF and JSON read from
// ---------------------------------------------------------------------------

/** One line of sub-detail under a label (a per-employer amount, a rental expense). */
export interface ReturnViewDetailLine {
  readonly label: string;
  readonly amount: number | null;
  readonly display: string;
}

/** One myTax item / label with its resolved value for this return. */
export interface ReturnViewLabel {
  /** ATO code, e.g. `"1"`, `"10L"`, `"D9"`, `"M2"`, `"IT6"`. */
  readonly code: string;
  readonly name: string;
  readonly section: MyTaxSection;
  /** `"main"` return or `"supplement"`. */
  readonly form: "main" | "supplement";
  /** Resolved dollar amount, or `null` when the label is nil / not applicable / non-monetary. */
  readonly amount: number | null;
  /** `amount` formatted for transcription (`"$1,234.56"`), or a word (`"Nil"`, `"—"`). */
  readonly display: string;
  /** `true` when the app computed this label rather than transcribing it from a document. */
  readonly computed: boolean;
  /** Sub-detail lines (per employer, per holding, per rental expense). */
  readonly detail: readonly ReturnViewDetailLine[];
  /** Short qualifier shown after the value ("estimated", "nil"). */
  readonly note?: string;
}

/** One myTax on-screen section with its labels, in on-screen order. */
export interface ReturnViewSection {
  readonly section: MyTaxSection;
  readonly title: string;
  readonly labels: readonly ReturnViewLabel[];
}

export interface ReturnViewTaxpayer {
  readonly fullName: string | null;
  readonly dateOfBirth: string | null;
  readonly address: string | null;
  /** Full TFN — this is the lodgement package (PRD FR-17: the records archive is the protection). */
  readonly taxFileNumber: string | null;
  readonly refundBsb: string | null;
  readonly refundAccountNumber: string | null;
  readonly refundAccountName: string | null;
  readonly residency: string | null;
  readonly spouse: {
    readonly hasSpouse: boolean;
    readonly name: string | null;
    readonly dateOfBirth: string | null;
    /** Always an estimate the user entered (PRD FR-1). */
    readonly estimatedTaxableIncome: number | null;
    readonly privateHospitalCoverDays: number | null;
  };
  readonly holdsStudyLoan: boolean | null;
  readonly privateHospitalCoverDays: number | null;
}

export interface ReturnViewRentalExpense {
  readonly key: string;
  readonly name: string;
  readonly paperLabel: string;
  readonly amount: number | null;
  readonly display: string;
}

export interface ReturnViewRentalSchedule {
  readonly property: {
    readonly address: string | null;
    readonly firstEarnedIncomeOn: string | null;
  };
  readonly grossRent: number;
  readonly otherRentalIncome: number;
  readonly expenses: readonly ReturnViewRentalExpense[];
  readonly totalDeductions: number;
  readonly netRentalResult: number;
}

export interface ReturnViewEstimate {
  readonly assessableIncome: number;
  readonly deductionsTotal: number;
  readonly taxableIncome: number;
  readonly taxOnTaxableIncome: number;
  readonly medicareLevy: number;
  readonly medicareLevySurcharge: number;
  readonly studyLoanRepayment: number;
  readonly totalOffsets: number;
  readonly totalCredits: number;
  readonly outcomeKind: "refund" | "payable";
  readonly outcomeAmount: number;
}

export interface ReturnView {
  readonly targetYear: string;
  readonly paramsVersion: string;
  readonly generatedAt: string;
  readonly taxpayer: ReturnViewTaxpayer;
  readonly sections: readonly ReturnViewSection[];
  readonly rentalSchedule: ReturnViewRentalSchedule | null;
  readonly estimate: ReturnViewEstimate;
}

// ---------------------------------------------------------------------------
// Assembled package
// ---------------------------------------------------------------------------

/** One file in the export package (PRD FR-14 a–d). */
export interface ExportArtifact {
  readonly filename: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
}

/** The four export-package artifacts (PRD FR-14). */
export interface ExportPackage {
  readonly pdf: ExportArtifact;
  readonly json: ExportArtifact;
  readonly validationReport: ExportArtifact;
  readonly sourceIndex: ExportArtifact;
}
