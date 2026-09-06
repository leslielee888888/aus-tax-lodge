/**
 * The validation report (PRD FR-14 c) — "checks passed, warnings acknowledged,
 * and every stated assumption".
 *
 * Runs the FR-13 gate ({@link validateReturn}) itself so the report is always
 * consistent with what blocked (or didn't block) the export. The acknowledged
 * warnings come in on {@link ExportPackageInput.acknowledgedWarningIds} (the
 * export screen collects them); the stated assumptions on
 * {@link ExportPackageInput.statedAssumptions}.
 */
import { isExportBlocked, validateReturn, type ValidationIssue } from "@aus-tax-lodge/validation";

import type { ExportPackageInput } from "./types";

/**
 * Stable id for a validation issue — used to match a warning against the
 * user's acknowledgements. The web layer builds the same id from the same
 * `validateReturn` output.
 */
export function issueId(issue: Pick<ValidationIssue, "code" | "path">): string {
  return issue.path ? `${issue.code}@${issue.path}` : issue.code;
}

type CheckStatus = "passed" | "warning" | "failed";

interface CheckDef {
  readonly id: string;
  readonly description: string;
  /** Exact issue codes, or a prefix ending in `:`, that fail / warn this check. */
  readonly codes: readonly string[];
}

const CHECKS: readonly CheckDef[] = [
  {
    id: "mandatory-labels",
    description: "Every mandatory label confirmed or marked not applicable",
    codes: ["mandatory-label-missing", "unconfirmed-field"],
  },
  {
    id: "arithmetic",
    description: "Arithmetic internally consistent — no disallowed negative amounts",
    codes: ["negative-amount"],
  },
  {
    id: "identifiers",
    description: "Tax file number and BSB well-formed",
    codes: ["tfn-invalid", "bsb-invalid"],
  },
  {
    id: "franking-credit-range",
    description: "Franking credits within the expected range of the franked dividend",
    codes: ["franking-credit-implausible"],
  },
  {
    id: "payg-plausible",
    description: "PAYG tax withheld plausible against salary and wages",
    codes: ["payg-withheld-implausible"],
  },
  {
    id: "no-unverified",
    description: "No unverified figures remain",
    codes: ["unverified-figure"],
  },
  {
    id: "in-scope",
    description: "No out-of-scope items detected",
    codes: ["out-of-scope:"],
  },
  {
    id: "rental-plausible",
    description: "Rental figures plausible (capital works, loan interest)",
    codes: ["capital-works-implausible", "loan-interest-implausible"],
  },
  {
    id: "rental-repairs",
    description: "Any large rental repairs line confirmed a genuine repair, not a capital improvement",
    codes: ["rental-repairs-unconfirmed"],
  },
];

function matches(issue: ValidationIssue, def: CheckDef): boolean {
  return def.codes.some((code) =>
    code.endsWith(":") ? issue.code.startsWith(code) : issue.code === code,
  );
}

export interface ValidationReportIssue {
  readonly id: string;
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}

export interface ValidationReportWarning extends ValidationReportIssue {
  readonly acknowledged: boolean;
}

export interface ValidationReportCheck {
  readonly id: string;
  readonly description: string;
  readonly status: CheckStatus;
}

export interface ValidationReport {
  readonly generatedAt: string;
  readonly targetYear: string;
  readonly paramsVersion: string;
  readonly exportBlocked: boolean;
  readonly checks: readonly ValidationReportCheck[];
  readonly errors: readonly ValidationReportIssue[];
  readonly warnings: readonly ValidationReportWarning[];
  readonly statedAssumptions: readonly string[];
  readonly atoTransmission: "none";
}

/** Run the FR-13 gate and assemble the report (PRD FR-14 c). */
export function buildValidationReport(input: ExportPackageInput): ValidationReport {
  const issues = validateReturn(input.model, input.assessment);
  const acknowledged = new Set(input.acknowledgedWarningIds);

  const errors = issues
    .filter((i) => i.severity === "error")
    .map((i) => ({ id: issueId(i), code: i.code, message: i.message, path: i.path }));
  const warnings = issues
    .filter((i) => i.severity === "warning")
    .map((i) => ({
      id: issueId(i),
      code: i.code,
      message: i.message,
      path: i.path,
      acknowledged: acknowledged.has(issueId(i)),
    }));

  const checks = CHECKS.map<ValidationReportCheck>((def) => {
    const hits = issues.filter((i) => matches(i, def));
    if (hits.length === 0) return { id: def.id, description: def.description, status: "passed" };
    const status: CheckStatus = hits.some((i) => i.severity === "error") ? "failed" : "warning";
    return { id: def.id, description: def.description, status };
  });

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    targetYear: input.targetYear,
    paramsVersion: input.paramsVersion,
    exportBlocked: isExportBlocked(issues),
    checks,
    errors,
    warnings,
    statedAssumptions: input.statedAssumptions,
    atoTransmission: "none",
  };
}

const CHECK_MARK: Readonly<Record<CheckStatus, string>> = {
  passed: "[PASS]",
  warning: "[WARN]",
  failed: "[FAIL]",
};

/** Plain-text rendering of the validation report for the records archive. */
export function renderValidationReportText(report: ValidationReport): string {
  const out: string[] = [];
  out.push(`Validation report — tax return ${report.targetYear}`);
  out.push(`Generated ${report.generatedAt.slice(0, 10)} · tax-parameter set ${report.paramsVersion}`);
  out.push("");
  out.push(
    report.exportBlocked
      ? "EXPORT BLOCKED — one or more checks failed. Resolve the errors below before lodging."
      : "All export-blocking checks passed.",
  );
  out.push("");
  out.push("Checks");
  for (const check of report.checks) {
    out.push(`  ${CHECK_MARK[check.status]} ${check.description}`);
  }
  out.push("");

  if (report.errors.length > 0) {
    out.push("Errors (must be fixed before lodging)");
    for (const error of report.errors) out.push(`  - ${error.message}`);
    out.push("");
  }

  out.push(report.warnings.length > 0 ? "Warnings" : "Warnings: none");
  for (const warning of report.warnings) {
    out.push(`  - ${warning.message}`);
    out.push(`    ${warning.acknowledged ? "Acknowledged by the taxpayer." : "NOT acknowledged."}`);
  }
  out.push("");

  out.push(report.statedAssumptions.length > 0 ? "Stated assumptions" : "Stated assumptions: none");
  for (const assumption of report.statedAssumptions) out.push(`  - ${assumption}`);
  out.push("");

  out.push("No information in this return was transmitted to the ATO.");
  return out.join("\n");
}
