/**
 * The source index (PRD FR-14 d, FR-22) — every dollar figure on the return
 * mapped to its lineage: the source document + page + snippet, the
 * questionnaire answer, or the computed roll-up it came from, plus the
 * originally proposed value and any edits ("proposed X, changed to Y").
 *
 * Reuses `@aus-tax-lodge/validation`'s {@link walkProvenancedFields} (every
 * provenanced field, structurally) and {@link collectInScopeFields} (which of
 * them are in scope for this return) rather than re-walking the model.
 */
import type { FieldEdit, FieldOrigin } from "@aus-tax-lodge/model";
import { collectInScopeFields, walkProvenancedFields } from "@aus-tax-lodge/validation";

import { formatDollars } from "./money";
import type { ExportPackageInput } from "./types";

export type SourceIndexOrigin =
  | {
      readonly kind: "document";
      readonly docId: string;
      readonly filename: string;
      readonly page: number;
      readonly snippet: string;
      readonly confidence: "high" | "medium" | "low" | "unverified";
    }
  | { readonly kind: "user-answer" }
  | { readonly kind: "computed"; readonly from: string }
  | { readonly kind: "none" };

export interface SourceIndexEntry {
  /** Dot/bracket path into the model, e.g. `income.salaryWages[0].grossSalaryWages`. */
  readonly path: string;
  /** Best-effort human label for the figure. */
  readonly label: string;
  readonly value: number;
  readonly display: string;
  readonly status: "unset" | "proposed" | "confirmed" | "not-applicable";
  readonly inScope: boolean;
  readonly origin: SourceIndexOrigin;
  /** The value first proposed, when it differs from the current value or there were edits (FR-22). */
  readonly proposedValue: number | null;
  readonly edits: readonly { readonly at: string; readonly from: number | null; readonly to: number | null }[];
}

export interface SourceIndex {
  readonly generatedAt: string;
  readonly targetYear: string;
  readonly entries: readonly SourceIndexEntry[];
  readonly atoTransmission: "none";
}

const KNOWN_LABELS: Readonly<Record<string, string>> = {
  "income.governmentAllowances": "Australian Government allowances (item 5)",
  "income.reportableFringeBenefits": "Reportable fringe benefits (IT1)",
  "income.reportableEmployerSuper": "Reportable employer super contributions (IT2)",
  "context.privateHospitalCoverDays": "Days with private hospital cover",
  "context.dependentChildren": "Number of dependent children (IT8)",
  "rental.grossRent": "Gross rent (item 21, label P)",
  "rental.otherRentalIncome": "Other rental-related income (item 21, label P)",
  "privateHealth.premiumsEligibleForRebate": "Private health — premiums eligible for rebate",
  "privateHealth.rebateReceived": "Private health — rebate received",
  "privateHealth.oldestCoveredPersonAge": "Private health — age of oldest person covered",
  "privateHealth.coverDays": "Private health — days of cover",
  "context.spouse.estimatedTaxableIncome": "Spouse estimated taxable income (estimate)",
  "context.spouse.privateHospitalCoverDays": "Spouse days with private hospital cover",
};

function humanisePath(path: string): string {
  if (KNOWN_LABELS[path]) return KNOWN_LABELS[path]!;
  return path
    .replace(/\[(\d+)\]/g, " #$1")
    .split(".")
    .map((seg) => seg.replace(/([a-z])([A-Z])/g, "$1 $2"))
    .join(" — ")
    .replace(/\b\w/, (c) => c.toUpperCase());
}

function resolveOrigin(
  origin: FieldOrigin | null,
  documentsByDocId: ReadonlyMap<string, string>,
): SourceIndexOrigin {
  if (!origin) return { kind: "none" };
  if (origin.kind === "document") {
    return {
      kind: "document",
      docId: origin.docId,
      filename: documentsByDocId.get(origin.docId) ?? "an uploaded document",
      page: origin.page,
      snippet: origin.snippet,
      confidence: origin.confidence,
    };
  }
  if (origin.kind === "user-answer") return { kind: "user-answer" };
  return { kind: "computed", from: origin.from };
}

/** Build the machine-readable source index for `input` (PRD FR-14 d, FR-22). */
export function buildSourceIndex(input: ExportPackageInput): SourceIndex {
  const documentsByDocId = new Map(input.documents.map((d) => [d.docId, d.filename]));
  const inScopePaths = new Set(collectInScopeFields(input.model).map((f) => f.path));
  const entries: SourceIndexEntry[] = [];

  walkProvenancedFields(input.model, "", (path, field) => {
    if (typeof field.value !== "number") return;
    const value = field.value;
    const edits = (field.edits as readonly FieldEdit<number>[]).map((e) => ({
      at: e.at,
      from: e.from,
      to: e.to,
    }));
    const proposed = field.proposedValue as number | null;
    entries.push({
      path,
      label: humanisePath(path),
      value,
      display: formatDollars(value),
      status: field.status,
      inScope: inScopePaths.has(path),
      origin: resolveOrigin(field.origin, documentsByDocId),
      proposedValue: proposed !== value || edits.length > 0 ? proposed : null,
      edits,
    });
  });

  entries.sort((a, b) => a.path.localeCompare(b.path));

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    targetYear: input.targetYear,
    entries,
    atoTransmission: "none",
  };
}

function renderOrigin(origin: SourceIndexOrigin): string[] {
  switch (origin.kind) {
    case "document":
      return [
        `    Source: ${origin.filename}, page ${origin.page} (confidence: ${origin.confidence})`,
        `    Snippet: "${origin.snippet}"`,
      ];
    case "user-answer":
      return ["    Source: an answer you gave in the questionnaire"];
    case "computed":
      return [`    Source: computed — ${origin.from}`];
    case "none":
      return ["    Source: entered directly (no document or questionnaire origin recorded)"];
  }
}

/** Plain-text rendering of the source index for the records archive. */
export function renderSourceIndexText(index: SourceIndex): string {
  const out: string[] = [];
  out.push(`Source index — tax return ${index.targetYear}`);
  out.push(`Generated ${index.generatedAt.slice(0, 10)}`);
  out.push("");
  out.push("Every dollar figure on the return, traced to where it came from (PRD FR-22).");
  out.push("");
  for (const entry of index.entries) {
    out.push(`${entry.label}  =  ${entry.display}${entry.inScope ? "" : "  (not in scope)"}`);
    out.push(`    Path: ${entry.path}  ·  Status: ${entry.status}`);
    out.push(...renderOrigin(entry.origin));
    if (entry.proposedValue !== null && entry.proposedValue !== entry.value) {
      out.push(
        `    Proposed ${formatDollars(entry.proposedValue)}, changed to ${entry.display}`,
      );
    }
    for (const edit of entry.edits) {
      out.push(
        `    Edited ${edit.at.slice(0, 10)}: ${formatDollars(edit.from)} -> ${formatDollars(edit.to)}`,
      );
    }
    out.push("");
  }
  out.push("No information in this return was transmitted to the ATO.");
  return out.join("\n");
}
