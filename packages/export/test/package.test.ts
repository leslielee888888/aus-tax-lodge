import { assess } from "@aus-tax-lodge/engine";
import { toEngineInput } from "@aus-tax-lodge/model";
import { walkProvenancedFields } from "@aus-tax-lodge/validation";
import { describe, expect, it } from "vitest";

import { assembleExportPackage } from "../src/assemble";
import { buildReturnJson } from "../src/json";
import { buildLodgeInstructions } from "../src/lodge-instructions";
import { buildReturnPdf } from "../src/pdf";
import { renderReturnPdfText } from "../src/pdf-text";
import { buildSourceIndex, renderSourceIndexText } from "../src/source-index";
import {
  buildValidationReport,
  issueId,
  renderValidationReportText,
} from "../src/validation-report";
import { buildReturnView } from "../src/view";
import { inputFor, noRentalReturn, rentalReturn, returnWithWarning } from "./fixtures";

const CASES = [
  { name: "no-rental return", model: noRentalReturn },
  { name: "rental return", model: rentalReturn },
] as const;

describe.each(CASES)("$name", ({ model: makeModel }) => {
  const input = inputFor(makeModel());
  const view = buildReturnView(input);
  const json = buildReturnJson(input);
  const pdfText = renderReturnPdfText(input);

  it("emits every in-scope label in myTax section order, in both the PDF and the JSON", () => {
    const sectionIndex = new Map(input.taxonomy.myTaxSectionOrder.map((s, i) => [s, i]));
    let lastOrder = -1;
    for (const section of view.sections) {
      const order = sectionIndex.get(section.section) ?? 99;
      expect(order).toBeGreaterThanOrEqual(lastOrder);
      lastOrder = order;

      for (const label of section.labels) {
        expect(pdfText).toContain(label.code);
        expect(pdfText).toContain(label.name);
        expect(json.labels[label.code]).toBeDefined();
        expect(json.labels[label.code]!.amount).toBe(label.amount);
      }
    }
  });

  it("JSON figures equal the confirmed model figures and the engine assessment", () => {
    const assessment = assess(toEngineInput(makeModel()));

    // Salary & wages label 1 == sum of confirmed employer gross.
    expect(json.labels["1"]!.amount).toBe(90_000);
    // PAYG withheld.
    expect(json.labels["1.taxWithheld"]!.amount).toBe(20_000);
    // Franking credits.
    expect(json.labels["11U"]!.amount).toBe(300);

    // Assessment block mirrors the engine exactly.
    expect(json.assessment.taxableIncome).toBe(assessment.taxableIncome);
    expect(json.assessment.taxOnTaxableIncome).toBe(assessment.taxOnTaxableIncome);
    expect(json.assessment.medicareLevy).toBe(assessment.medicareLevy);
    expect(json.assessment.outcomeKind).toBe(assessment.outcome.kind);
    expect(json.assessment.outcomeAmount).toBe(assessment.outcome.amount);

    if (input.model.rental.present) {
      expect(json.labels["21"]!.amount).toBe(assessment.assessableIncome.netRental);
      expect(json.rentalSchedule).not.toBeNull();
      expect(json.rentalSchedule!.netRentalResult).toBe(assessment.assessableIncome.netRental);
    } else {
      expect(json.labels["21"]).toBeUndefined();
      expect(json.rentalSchedule).toBeNull();
    }
  });

  it("source index has a resolvable-origin entry for every dollar figure on the return", () => {
    const index = buildSourceIndex(input);
    const byPath = new Map(index.entries.map((e) => [e.path, e]));

    const numericPaths: string[] = [];
    walkProvenancedFields(input.model, "", (path, field) => {
      if (typeof field.value === "number") numericPaths.push(path);
    });

    expect(numericPaths.length).toBeGreaterThan(5);
    for (const path of numericPaths) {
      const entry = byPath.get(path);
      expect(entry, `missing source-index entry for ${path}`).toBeDefined();
      expect(entry!.origin.kind).not.toBe("none");
    }

    // The edited salary figure keeps its "proposed X, changed to Y" lineage (FR-22).
    const salary = byPath.get("income.salaryWages[0].grossSalaryWages")!;
    expect(salary.value).toBe(90_000);
    expect(salary.proposedValue).toBe(88_000);
    expect(salary.edits).toHaveLength(1);
    expect(salary.origin.kind).toBe("document");
    const text = renderSourceIndexText(index);
    expect(text).toContain("Proposed $88,000.00, changed to $90,000.00");
    expect(text).toContain("No information in this return was transmitted to the ATO.");
  });

  it("validation report lists acknowledged warnings and stated assumptions", () => {
    const assumption = "Spouse taxable income is an estimate the user entered.";
    const report = buildValidationReport(
      inputFor(makeModel(), { statedAssumptions: [assumption] }),
    );
    expect(report.statedAssumptions).toContain(assumption);
    expect(report.exportBlocked).toBe(false);
    expect(report.checks.every((c) => c.status === "passed")).toBe(true);

    const text = renderValidationReportText(report);
    expect(text).toContain(assumption);
    expect(text).toContain("All export-blocking checks passed.");
    expect(text).toContain("No information in this return was transmitted to the ATO.");
  });

  it("how-to-lodge note mentions myGov and that nothing is sent to the ATO", () => {
    const instructions = buildLodgeInstructions(input);
    expect(instructions).toContain("myGov");
    expect(instructions).toContain("not sent to the ATO");
  });

  it("assembles four artifacts with attachment-ready filenames and content", async () => {
    const pkg = await assembleExportPackage(input);
    expect(pkg.pdf.filename).toBe(`return-summary-${input.targetYear}.pdf`);
    expect(pkg.json.filename).toBe(`return-data-${input.targetYear}.json`);
    expect(pkg.validationReport.filename).toBe(`validation-report-${input.targetYear}.txt`);
    expect(pkg.sourceIndex.filename).toBe(`source-index-${input.targetYear}.txt`);

    expect(Buffer.from(pkg.pdf.bytes.subarray(0, 5)).toString()).toBe("%PDF-");
    expect(pkg.pdf.bytes.length).toBeGreaterThan(1000);

    const parsed = JSON.parse(Buffer.from(pkg.json.bytes).toString("utf8"));
    expect(parsed.meta.atoTransmission).toBe("none");
    expect(parsed.labels["1"].amount).toBe(90_000);
  });

  it("produces a valid PDF document", async () => {
    const bytes = await buildReturnPdf(input);
    const asString = Buffer.from(bytes).toString("latin1");
    expect(asString.startsWith("%PDF-")).toBe(true);
    expect(asString).toContain("%%EOF");
  });
});

describe("warnings acknowledgement", () => {
  it("marks a warning acknowledged when its id is in acknowledgedWarningIds", () => {
    const model = returnWithWarning();
    const bare = buildValidationReport(inputFor(model));
    expect(bare.warnings.length).toBeGreaterThan(0);
    const warning = bare.warnings[0]!;
    expect(warning.acknowledged).toBe(false);

    const acked = buildValidationReport(inputFor(model, { acknowledgedWarningIds: [warning.id] }));
    expect(acked.warnings[0]!.acknowledged).toBe(true);
    expect(acked.exportBlocked).toBe(false);

    const text = renderValidationReportText(acked);
    expect(text).toContain("Acknowledged by the taxpayer.");
  });

  it("issueId is stable and path-qualified", () => {
    expect(
      issueId({ code: "franking-credit-implausible", path: "income.dividends[0].frankingCredits" }),
    ).toBe("franking-credit-implausible@income.dividends[0].frankingCredits");
    expect(issueId({ code: "tfn-invalid" })).toBe("tfn-invalid");
  });
});
