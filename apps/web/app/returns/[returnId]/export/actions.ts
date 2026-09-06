"use server";

import {
  acknowledgeWarnings,
  readAcknowledgedWarningIds,
} from "../../../../lib/export/acknowledgements";
import { loadExportContext } from "../../../../lib/export/context";

export interface AcknowledgeWarningResult {
  readonly ok: boolean;
  readonly acknowledgedWarningIds?: readonly string[];
  readonly error?: string;
}

/**
 * Record the user's acknowledgement of one or more FR-13 validation warnings
 * for this return's export (PRD FR-14 c). Per-return, per-export — stored
 * encrypted at rest alongside the export artifacts, separate from the
 * instance-level FR-19 acknowledgement. A client button calls this with plain
 * args (no `FormData`), mirroring the review screen's action style.
 */
export async function acknowledgeExportWarnings(
  returnId: string,
  warningIds: readonly string[],
): Promise<AcknowledgeWarningResult> {
  if (
    warningIds.length === 0 ||
    warningIds.some((id) => typeof id !== "string" || id.length === 0)
  ) {
    return { ok: false, error: "No warning to acknowledge." };
  }

  const { readOnly } = await loadExportContext(returnId);
  if (readOnly) {
    return {
      ok: false,
      error: "This return is read-only — it was built against a retired tax year.",
    };
  }

  const acknowledgedWarningIds = await acknowledgeWarnings(returnId, warningIds);
  return { ok: true, acknowledgedWarningIds };
}

/** Read back the acknowledged-warning ids for this return (used after a client refresh). */
export async function getAcknowledgedExportWarnings(returnId: string): Promise<readonly string[]> {
  return readAcknowledgedWarningIds(returnId);
}
