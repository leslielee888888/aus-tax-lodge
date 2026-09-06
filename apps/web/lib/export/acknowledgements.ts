import { mkdir, readFile, writeFile } from "node:fs/promises";

import { decryptJson, encryptJson, exportArtifactPath, exportDir } from "@aus-tax-lodge/store";

import { getServerConfig } from "../server-config";

/**
 * Per-return, per-export acknowledgement of the FR-13 validation *warnings*
 * (PRD FR-14 c — "warnings acknowledged"). Stored AES-encrypted at rest at
 * `<return>/export/acknowledgements.json`, like everything else on the volume
 * (PRD FR-17). Separate from the instance-level FR-19 acknowledgement.
 */
interface AcknowledgementFile {
  readonly acknowledgedWarningIds: readonly string[];
  readonly updatedAt: string;
}

const FILE_NAME = "acknowledgements.json";

function isAcknowledgementFile(value: unknown): value is AcknowledgementFile {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { acknowledgedWarningIds?: unknown }).acknowledgedWarningIds)
  );
}

/** The warning ids the user has acknowledged on the export screen for this return. */
export async function readAcknowledgedWarningIds(returnId: string): Promise<string[]> {
  const config = getServerConfig();
  let blob: Buffer;
  try {
    blob = await readFile(exportArtifactPath(config.dataDir, returnId, FILE_NAME));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  try {
    const parsed = decryptJson<unknown>(config.encryptionKey, blob);
    return isAcknowledgementFile(parsed) ? [...parsed.acknowledgedWarningIds] : [];
  } catch {
    return [];
  }
}

/** Add `warningIds` to the acknowledged set (idempotent). Returns the full set. */
export async function acknowledgeWarnings(
  returnId: string,
  warningIds: readonly string[],
): Promise<string[]> {
  const config = getServerConfig();
  const existing = await readAcknowledgedWarningIds(returnId);
  const next = [...new Set([...existing, ...warningIds])].sort();
  const file: AcknowledgementFile = {
    acknowledgedWarningIds: next,
    updatedAt: new Date().toISOString(),
  };
  await mkdir(exportDir(config.dataDir, returnId), { recursive: true });
  await writeFile(
    exportArtifactPath(config.dataDir, returnId, FILE_NAME),
    encryptJson(config.encryptionKey, file),
  );
  return next;
}
