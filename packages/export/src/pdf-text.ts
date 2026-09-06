/**
 * The text content of the lodgement PDF (PRD FR-14 a), as an ordered list of
 * styled lines. {@link buildReturnPdf} lays these out verbatim, so asserting
 * against {@link renderReturnPdfText} in a test is asserting against exactly
 * what the PDF says.
 *
 * Layout follows the myTax on-screen section order (from the taxonomy), so a
 * user can transcribe the return top to bottom.
 */
import { formatDollars } from "./money";
import type { ExportPackageInput, ReturnView } from "./types";
import { buildReturnView } from "./view";

export type PdfLineStyle = "title" | "h1" | "h2" | "label" | "detail" | "body" | "spacer";

export interface PdfLine {
  readonly text: string;
  readonly style: PdfLineStyle;
}

const DISCLAIMER_LINES = [
  "Not a registered tax agent. This is a self-preparation aid, not tax advice.",
  "The estimate is not the ATO's assessment. You are responsible for what you lodge.",
  "Nothing in this package was transmitted to the ATO — you lodge it yourself in myTax.",
];

function push(lines: PdfLine[], style: PdfLineStyle, text = ""): void {
  lines.push({ text, style });
}

function taxpayerBlock(lines: PdfLine[], view: ReturnView): void {
  const t = view.taxpayer;
  push(lines, "h2", "Taxpayer");
  push(lines, "body", `Name: ${t.fullName ?? "—"}`);
  push(lines, "body", `Date of birth: ${t.dateOfBirth ?? "—"}`);
  push(lines, "body", `Postal address: ${t.address ?? "—"}`);
  push(lines, "body", `Tax file number: ${t.taxFileNumber ?? "—"}`);
  push(
    lines,
    "body",
    `Refund account: BSB ${t.refundBsb ?? "—"}, account ${t.refundAccountNumber ?? "—"} (${t.refundAccountName ?? "—"})`,
  );
  push(
    lines,
    "body",
    `Study/training support loan: ${t.holdsStudyLoan == null ? "—" : t.holdsStudyLoan ? "Yes" : "No"}`,
  );
  push(lines, "body", `Days with private hospital cover: ${t.privateHospitalCoverDays ?? "—"}`);
  if (t.spouse.hasSpouse) {
    push(
      lines,
      "body",
      `Spouse: ${t.spouse.name ?? "—"}, DOB ${t.spouse.dateOfBirth ?? "—"}, estimated taxable income ${formatDollars(t.spouse.estimatedTaxableIncome)} (estimated), ${t.spouse.privateHospitalCoverDays ?? "—"} days cover`,
    );
  }
  push(lines, "spacer");
}

function rentalScheduleBlock(lines: PdfLine[], view: ReturnView): void {
  const r = view.rentalSchedule;
  if (!r) return;
  push(lines, "h1", "Item 21 — Rental property schedule");
  push(lines, "body", `Property: ${r.property.address ?? "—"}`);
  push(lines, "body", `First earned rental income: ${r.property.firstEarnedIncomeOn ?? "—"}`);
  push(lines, "spacer");
  push(lines, "label", `Gross rent (label P)                 ${formatDollars(r.grossRent)}`);
  if (r.otherRentalIncome !== 0) {
    push(lines, "detail", `Other rental-related income        ${formatDollars(r.otherRentalIncome)}`);
  }
  for (const expense of r.expenses) {
    if (expense.amount == null || expense.amount === 0) continue;
    push(
      lines,
      "detail",
      `${expense.name} (label ${expense.paperLabel})`.padEnd(38) + expense.display,
    );
  }
  push(lines, "label", `Total rental deductions              ${formatDollars(r.totalDeductions)}`);
  push(
    lines,
    "label",
    `Net rent (label 21, net)             ${formatDollars(r.netRentalResult)}${r.netRentalResult < 0 ? "  (a loss)" : ""}`,
  );
  push(lines, "spacer");
}

function estimateBlock(lines: PdfLine[], view: ReturnView): void {
  const e = view.estimate;
  push(lines, "h1", "Estimated assessment");
  push(lines, "body", "An estimate only — the ATO's notice of assessment is the final figure.");
  push(lines, "spacer");
  push(lines, "detail", `Total assessable income            ${formatDollars(e.assessableIncome)}`);
  push(lines, "detail", `less Total deductions              ${formatDollars(-e.deductionsTotal)}`);
  push(lines, "label", `Taxable income                     ${formatDollars(e.taxableIncome)}`);
  push(lines, "detail", `Tax on taxable income              ${formatDollars(e.taxOnTaxableIncome)}`);
  push(lines, "detail", `less Tax offsets applied           ${formatDollars(-e.totalOffsets)}`);
  push(lines, "detail", `plus Medicare levy                 ${formatDollars(e.medicareLevy)}`);
  push(lines, "detail", `plus Medicare levy surcharge       ${formatDollars(e.medicareLevySurcharge)}`);
  if (e.studyLoanRepayment > 0) {
    push(lines, "detail", `plus Study/training loan repayment ${formatDollars(e.studyLoanRepayment)}`);
  }
  push(lines, "detail", `less Credits (PAYG + franking)     ${formatDollars(-e.totalCredits)}`);
  push(
    lines,
    "label",
    `${e.outcomeKind === "refund" ? "Estimated refund" : "Estimated amount owing"}                   ${formatDollars(e.outcomeAmount)}`,
  );
  push(lines, "spacer");
}

/** Build the ordered, styled line list for the PDF. */
export function renderReturnPdfLines(input: ExportPackageInput): PdfLine[] {
  const view = buildReturnView(input);
  const lines: PdfLine[] = [];

  push(lines, "title", `Tax return ${view.targetYear} — lodgement summary`);
  push(
    lines,
    "body",
    `Prepared ${view.generatedAt.slice(0, 10)} · tax-parameter set ${view.paramsVersion}`,
  );
  push(lines, "spacer");
  for (const line of DISCLAIMER_LINES) push(lines, "body", line);
  push(lines, "spacer");

  taxpayerBlock(lines, view);

  push(lines, "h1", "Return figures, in myTax on-screen order");
  push(
    lines,
    "body",
    "Transcribe each figure into the matching myTax label. Computed labels are worked out by myTax / the ATO — check them against yours.",
  );
  push(lines, "spacer");

  for (const section of view.sections) {
    push(lines, "h2", section.title);
    for (const label of section.labels) {
      const value = label.display && label.display.length > 0 ? label.display : "—";
      push(
        lines,
        "label",
        `${label.code}  ${label.name}`.padEnd(56) + value + (label.computed ? "  [computed]" : ""),
      );
      if (label.note) push(lines, "detail", `   ${label.note}`);
      for (const d of label.detail) {
        const suffix = d.display && d.display.length > 0 ? `  ${d.display}` : "";
        push(lines, "detail", `   • ${d.label}${suffix}`);
      }
    }
    push(lines, "spacer");
  }

  rentalScheduleBlock(lines, view);
  estimateBlock(lines, view);

  push(lines, "body", "End of lodgement summary.");
  return lines;
}

/** The full PDF text, one line per `\n` — what {@link buildReturnPdf} renders. */
export function renderReturnPdfText(input: ExportPackageInput): string {
  return renderReturnPdfLines(input)
    .map((line) => line.text)
    .join("\n");
}
