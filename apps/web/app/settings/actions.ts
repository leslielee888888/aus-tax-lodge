"use server";

import {
  PURGE_MAX_DAYS,
  PURGE_MIN_DAYS,
  readInstanceSettings,
  writeInstanceSettings,
  type InstanceSettings,
} from "../../lib/instance-settings";
import { maybePurgeExportedDocuments } from "../../lib/purge";

export interface SettingsActionResult {
  readonly ok: boolean;
  readonly settings?: InstanceSettings;
  readonly error?: string;
}

function validDays(afterDays: number): boolean {
  return (
    Number.isFinite(afterDays) &&
    Number.isInteger(afterDays) &&
    afterDays >= PURGE_MIN_DAYS &&
    afterDays <= PURGE_MAX_DAYS
  );
}

/**
 * Set the FR-18 "purge source documents N days after export" toggle. Plain-args
 * server action, mirroring `review/actions.ts`.
 *
 * Enabling it is a deliberate, destructive choice — the settings screen shows
 * the warning and a confirm step before it calls this with `enabled: true`.
 * Disabling is immediate. Turning it on kicks off the lazy sweep straight away
 * so an already-overdue return doesn't wait for the next home-page visit.
 */
export async function savePurgeSetting(
  enabled: boolean,
  afterDays: number,
): Promise<SettingsActionResult> {
  if (typeof enabled !== "boolean") {
    return { ok: false, error: "Invalid request." };
  }
  if (!validDays(afterDays)) {
    return {
      ok: false,
      error: `Enter a whole number of days between ${PURGE_MIN_DAYS} and ${PURGE_MAX_DAYS}.`,
    };
  }

  const settings = await writeInstanceSettings({
    purgeSourceDocuments: { enabled, afterDays },
  });

  if (enabled) {
    try {
      await maybePurgeExportedDocuments({ force: true });
    } catch {
      // The sweep also runs on the next home-page load — don't fail the save.
    }
  }

  return { ok: true, settings };
}

/** Current instance settings — used by the client form after a refresh. */
export async function getInstanceSettings(): Promise<InstanceSettings> {
  return readInstanceSettings();
}
