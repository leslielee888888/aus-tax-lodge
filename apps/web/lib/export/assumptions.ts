import type { FullAssessment } from "@aus-tax-lodge/engine";
import type { ReturnModel } from "@aus-tax-lodge/model";

/**
 * Every stated assumption behind the return, in plain English (PRD FR-14 c —
 * "every stated assumption, e.g. the estimated spouse income"). Listed in the
 * validation report and shown as a callout on the export screen.
 */
export function deriveStatedAssumptions(model: ReturnModel, assessment: FullAssessment): string[] {
  const assumptions: string[] = [];

  if (model.context.spouse.status.value === "had-spouse") {
    assumptions.push(
      "Spouse taxable income is an estimate you entered, not a figure from a document — the family Medicare levy, surcharge and private-health rebate tests use it.",
    );
  }

  if (model.rental.present && assessment.assessableIncome.netRental < 0) {
    assumptions.push(
      "The net rental loss lowers taxable income but is added back for the study/training loan, Medicare levy surcharge and private-health rebate income tests (FR-23).",
    );
  }

  if (model.rental.present) {
    const qsBacked =
      model.rental.expenses.capitalWorks.source === "qs-schedule" ||
      model.rental.expenses.declineInValue.source === "qs-schedule";
    if (!qsBacked) {
      assumptions.push(
        "Capital works and decline-in-value were entered by hand rather than from a quantity surveyor's schedule — you may be under-claiming depreciation.",
      );
    }
  }

  if (model.privateHealth.held.value === true) {
    assumptions.push(
      "The private health insurance rebate is reconciled from the tax statement against your rebate-tier income — the ATO recalculates it on assessment and may differ.",
    );
  }

  assumptions.push(
    "This is an estimate, not the ATO's assessment. The ATO may hold information this tool does not — prior-year losses, PAYG instalments, HELP indexation timing, other income.",
  );

  return assumptions;
}
