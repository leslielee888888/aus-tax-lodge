import { getReturnRepository } from "./returns";
import { readInstanceSettings, type PurgeSourceDocumentsSetting } from "./instance-settings";
import { markSourceDocumentsPurged, readExportManifest } from "./export/persist";
import { getDocumentStore } from "./store";

/**
 * Lazy retention sweep (PRD FR-18). There is no cron in a single Next.js
 * container, so the optional "purge source documents N days after export"
 * setting is enforced opportunistically: {@link maybePurgeExportedDocuments} is
 * called from cheap, frequently-hit server reads (the home page, the returns
 * list) and, at most once every {@link SWEEP_INTERVAL_MS}, scans returns and
 * deletes the **source documents only** from any exported return whose export
 * is older than the configured window.
 *
 * It never deletes a return, its `return.json`, or its persisted export
 * artifacts — the records archive the user downloaded is their retention copy.
 * The setting is off by default and is only ever turned on by an explicit,
 * confirmed action on the settings screen.
 */

const SWEEP_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const DAY_MS = 24 * 60 * 60 * 1000;

/** Process-wide dedupe stamp. `0` = never run. */
let lastSweepAt = 0;

export interface PurgeSweepResult {
  readonly ran: boolean;
  readonly scanned: number;
  readonly purgedReturnIds: readonly string[];
  readonly errors: number;
}

const SKIPPED: PurgeSweepResult = { ran: false, scanned: 0, purgedReturnIds: [], errors: 0 };

function isDue(now: number, setting: PurgeSourceDocumentsSetting, generatedAt: string): boolean {
  const exportedAt = Date.parse(generatedAt);
  if (Number.isNaN(exportedAt)) return false;
  return now - exportedAt >= setting.afterDays * DAY_MS;
}

async function purgeReturnDocuments(returnId: string, now: number): Promise<boolean> {
  const store = getDocumentStore();
  const documents = await store.listDocuments(returnId);
  for (const doc of documents) {
    try {
      await store.deleteDocument(returnId, doc.docId);
    } catch {
      // A document already gone is fine — keep going.
    }
  }
  await markSourceDocumentsPurged(returnId, new Date(now).toISOString());
  return true;
}

/**
 * Run the sweep if it is enabled and hasn't run recently. Cheap and safe to
 * call on every request: returns immediately when the setting is off or the
 * dedupe window hasn't elapsed. One bad return never aborts the rest.
 *
 * @param force  ignore the dedupe window (used by tests and the settings screen).
 */
export async function maybePurgeExportedDocuments({
  force = false,
}: { force?: boolean } = {}): Promise<PurgeSweepResult> {
  const now = Date.now();
  if (!force && now - lastSweepAt < SWEEP_INTERVAL_MS) return SKIPPED;

  let settings;
  try {
    settings = await readInstanceSettings();
  } catch {
    return SKIPPED;
  }
  const setting = settings.purgeSourceDocuments;
  if (!setting.enabled) {
    lastSweepAt = now;
    return SKIPPED;
  }

  lastSweepAt = now;

  let summaries;
  try {
    summaries = await getReturnRepository().listReturns();
  } catch {
    return { ran: true, scanned: 0, purgedReturnIds: [], errors: 1 };
  }

  const purgedReturnIds: string[] = [];
  let errors = 0;
  let scanned = 0;

  for (const summary of summaries) {
    if (summary.status !== "exported") continue;
    scanned += 1;
    try {
      const manifest = await readExportManifest(summary.returnId);
      if (!manifest || manifest.sourceDocumentsPurgedAt) continue;
      if (!isDue(now, setting, manifest.generatedAt)) continue;
      await purgeReturnDocuments(summary.returnId, now);
      purgedReturnIds.push(summary.returnId);
    } catch {
      errors += 1;
    }
  }

  return { ran: true, scanned, purgedReturnIds, errors };
}

/** Test seam — reset the process-wide dedupe stamp. */
export function resetPurgeSweepStamp(): void {
  lastSweepAt = 0;
}
