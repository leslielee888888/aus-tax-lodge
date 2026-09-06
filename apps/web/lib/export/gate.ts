import type { FullAssessment } from "@aus-tax-lodge/engine";
import { issueId } from "@aus-tax-lodge/export";
import type { ReturnModel } from "@aus-tax-lodge/model";
import { isExportBlocked, validateReturn } from "@aus-tax-lodge/validation";

/**
 * The FR-13/FR-14 export gate, shared by the export screen (to enable/disable
 * the download controls) and the route handlers (to refuse a bypassed
 * download): `error` issues block the package and archive outright; `warning`
 * issues must each be acknowledged before the downloads enable.
 */
export interface ExportGateIssue {
  readonly id: string;
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}

export interface ExportGateWarning extends ExportGateIssue {
  readonly acknowledged: boolean;
}

export interface ExportGate {
  readonly errors: readonly ExportGateIssue[];
  readonly warnings: readonly ExportGateWarning[];
  /** `true` when there is at least one blocking `error`. */
  readonly blocked: boolean;
  readonly allWarningsAcknowledged: boolean;
  /** `true` when the export package and records archive may be downloaded. */
  readonly downloadsEnabled: boolean;
}

export function computeExportGate(
  model: ReturnModel,
  assessment: FullAssessment | null,
  acknowledgedWarningIds: readonly string[],
): ExportGate {
  const issues = assessment ? validateReturn(model, assessment) : validateReturn(model);
  const acknowledged = new Set(acknowledgedWarningIds);

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

  const blocked = isExportBlocked(issues) || assessment === null;
  const allWarningsAcknowledged = warnings.every((w) => w.acknowledged);

  return {
    errors,
    warnings,
    blocked,
    allWarningsAcknowledged,
    downloadsEnabled: !blocked && allWarningsAcknowledged,
  };
}
