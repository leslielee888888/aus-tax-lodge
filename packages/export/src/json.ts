/**
 * The structured JSON export (PRD FR-14 b) — "the full return keyed by label".
 *
 * Machine-readable: every figure is a plain number, keyed by its ATO label
 * code, alongside the taxpayer/context block, the rental schedule, and the
 * full engine assessment. Derived from the same {@link buildReturnView} the PDF
 * uses, so the two can never disagree.
 */
import { buildReturnView } from "./view";
import type { ExportPackageInput } from "./types";

export interface ReturnJsonLabel {
  readonly name: string;
  readonly section: string;
  readonly form: "main" | "supplement";
  readonly amount: number | null;
  readonly display: string;
  readonly computed: boolean;
  readonly note?: string;
  readonly detail: readonly { readonly label: string; readonly amount: number | null }[];
}

export interface ReturnJson {
  readonly meta: {
    readonly kind: "aus-tax-lodge/return-export";
    readonly version: 1;
    readonly targetYear: string;
    readonly paramsVersion: string;
    readonly generatedAt: string;
    readonly disclaimer: string;
    readonly atoTransmission: "none";
  };
  readonly taxpayer: ReturnView["taxpayer"];
  readonly labels: Readonly<Record<string, ReturnJsonLabel>>;
  readonly rentalSchedule: ReturnView["rentalSchedule"];
  readonly assessment: ReturnView["estimate"];
}

type ReturnView = ReturnType<typeof buildReturnView>;

const DISCLAIMER =
  "Prepared with a self-hosted assistant. Not tax advice. The figures are an " +
  "estimate, not the ATO's assessment. You are responsible for what you lodge. " +
  "No information was transmitted to the ATO.";

/** Build the label-keyed JSON object (PRD FR-14 b). */
export function buildReturnJson(input: ExportPackageInput): ReturnJson {
  const view = buildReturnView(input);

  const labels: Record<string, ReturnJsonLabel> = {};
  for (const section of view.sections) {
    for (const label of section.labels) {
      labels[label.code] = {
        name: label.name,
        section: label.section,
        form: label.form,
        amount: label.amount,
        display: label.display,
        computed: label.computed,
        note: label.note,
        detail: label.detail.map((d) => ({ label: d.label, amount: d.amount })),
      };
    }
  }

  return {
    meta: {
      kind: "aus-tax-lodge/return-export",
      version: 1,
      targetYear: view.targetYear,
      paramsVersion: view.paramsVersion,
      generatedAt: view.generatedAt,
      disclaimer: DISCLAIMER,
      atoTransmission: "none",
    },
    taxpayer: view.taxpayer,
    labels,
    rentalSchedule: view.rentalSchedule,
    assessment: view.estimate,
  };
}
