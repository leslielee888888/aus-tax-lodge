import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  DEFAULT_INSTANCE_SETTINGS,
  normalizeInstanceSettings,
  type InstanceSettings,
} from "./instance-settings.shared";
import { getServerConfig } from "./server-config";

/**
 * Per-instance settings (PRD FR-18). There is no settings database — this is a
 * single JSON file at `<config.dataDir>/instance-settings.json`, mirroring
 * `acknowledgement.ts`. Server-only. A missing or corrupt file reads back as
 * {@link DEFAULT_INSTANCE_SETTINGS}.
 *
 * The only setting so far is the optional "purge source documents N days after
 * export" toggle (FR-18). It is **off by default** and is never auto-enabled —
 * enabling it is an explicit, warned, confirmed user action on the settings
 * screen. Disabling it takes effect immediately.
 */
export {
  DEFAULT_INSTANCE_SETTINGS,
  normalizeInstanceSettings,
  PURGE_MAX_DAYS,
  PURGE_MIN_DAYS,
  type InstanceSettings,
  type PurgeSourceDocumentsSetting,
} from "./instance-settings.shared";

const FILE_NAME = "instance-settings.json";

/** Read the instance settings from `dataDir`, or the defaults when absent/corrupt. */
export async function readInstanceSettingsAt(dataDir: string): Promise<InstanceSettings> {
  let raw: string;
  try {
    raw = await readFile(join(dataDir, FILE_NAME), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return DEFAULT_INSTANCE_SETTINGS;
    throw err;
  }
  try {
    return normalizeInstanceSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_INSTANCE_SETTINGS;
  }
}

/** Write the instance settings to `dataDir` (normalised first). Returns what was written. */
export async function writeInstanceSettingsAt(
  dataDir: string,
  settings: InstanceSettings,
): Promise<InstanceSettings> {
  const normalized = normalizeInstanceSettings(settings);
  await mkdir(dataDir, { recursive: true });
  await writeFile(join(dataDir, FILE_NAME), `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

/** Instance settings, bound to the configured data directory. */
export function readInstanceSettings(): Promise<InstanceSettings> {
  return readInstanceSettingsAt(getServerConfig().dataDir);
}

/** Persist the instance settings, bound to the configured data directory. */
export function writeInstanceSettings(settings: InstanceSettings): Promise<InstanceSettings> {
  return writeInstanceSettingsAt(getServerConfig().dataDir, settings);
}
