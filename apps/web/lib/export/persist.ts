import { mkdir, readFile, writeFile } from "node:fs/promises";

import type { ExportPackage } from "@aus-tax-lodge/export";
import {
  decrypt,
  decryptJson,
  encrypt,
  encryptJson,
  exportArtifactPath,
  exportDir,
} from "@aus-tax-lodge/store";

import { getReturnRepository } from "../returns";
import { getServerConfig } from "../server-config";

/**
 * Persistence for the export-package artifacts (PRD FR-14, FR-16). The four
 * plaintext artifacts (PDF + JSON + validation report + source index) are
 * written **AES-encrypted at rest** into `<return>/export/` so a read-only past
 * return can re-download its existing export without recomputing against a
 * retired parameter set (FR-16). The records-archive zip itself is *not*
 * persisted — it carries the user's password-derived encryption and is
 * regenerated on demand.
 */
const MANIFEST_NAME = "manifest.json";

export interface ExportManifestEntry {
  readonly key: keyof ExportPackage;
  readonly filename: string;
  readonly contentType: string;
}

export interface ExportManifest {
  readonly generatedAt: string;
  readonly paramsVersion: string;
  readonly artifacts: readonly ExportManifestEntry[];
  /**
   * ISO-8601 instant the lazy retention sweep (PRD FR-18) deleted this return's
   * source documents. Set only when the per-instance purge toggle is on and the
   * export is older than its window. The return, its `return.json` and these
   * persisted export artifacts are all kept — only the original uploads go.
   */
  readonly sourceDocumentsPurgedAt?: string;
}

const ARTIFACT_KEYS: readonly (keyof ExportPackage)[] = [
  "pdf",
  "json",
  "validationReport",
  "sourceIndex",
];

/** Persist the four export artifacts (encrypted) and record that the return was exported. */
export async function persistExportArtifacts(
  returnId: string,
  pkg: ExportPackage,
  meta: { readonly generatedAt: string; readonly paramsVersion: string },
): Promise<ExportManifest> {
  const config = getServerConfig();
  await mkdir(exportDir(config.dataDir, returnId), { recursive: true });

  const artifacts: ExportManifestEntry[] = [];
  for (const key of ARTIFACT_KEYS) {
    const artifact = pkg[key];
    await writeFile(
      exportArtifactPath(config.dataDir, returnId, artifact.filename),
      encrypt(config.encryptionKey, Buffer.from(artifact.bytes)),
    );
    artifacts.push({ key, filename: artifact.filename, contentType: artifact.contentType });
  }

  const manifest: ExportManifest = {
    generatedAt: meta.generatedAt,
    paramsVersion: meta.paramsVersion,
    artifacts,
  };
  await writeFile(
    exportArtifactPath(config.dataDir, returnId, MANIFEST_NAME),
    encryptJson(config.encryptionKey, manifest),
  );

  await markReturnExported(returnId);
  return manifest;
}

function isManifest(value: unknown): value is ExportManifest {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { artifacts?: unknown }).artifacts)
  );
}

/** The persisted export manifest, or `null` when this return has never been exported. */
export async function readExportManifest(returnId: string): Promise<ExportManifest | null> {
  const config = getServerConfig();
  let blob: Buffer;
  try {
    blob = await readFile(exportArtifactPath(config.dataDir, returnId, MANIFEST_NAME));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  try {
    const parsed = decryptJson<unknown>(config.encryptionKey, blob);
    return isManifest(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export interface PersistedArtifact {
  readonly filename: string;
  readonly contentType: string;
  readonly bytes: Buffer;
}

/** Read one persisted (encrypted) artifact back, decrypted. `null` if it is not on disk. */
export async function readPersistedArtifact(
  returnId: string,
  key: keyof ExportPackage,
): Promise<PersistedArtifact | null> {
  const manifest = await readExportManifest(returnId);
  const entry = manifest?.artifacts.find((a) => a.key === key);
  if (!entry) return null;

  const config = getServerConfig();
  let blob: Buffer;
  try {
    blob = await readFile(exportArtifactPath(config.dataDir, returnId, entry.filename));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  return {
    filename: entry.filename,
    contentType: entry.contentType,
    bytes: decrypt(config.encryptionKey, blob),
  };
}

/**
 * Record on the persisted export manifest that this return's source documents
 * were purged by the FR-18 retention sweep, and when. Returns the updated
 * manifest, or `null` if there is no manifest to stamp.
 */
export async function markSourceDocumentsPurged(
  returnId: string,
  purgedAt: string,
): Promise<ExportManifest | null> {
  const manifest = await readExportManifest(returnId);
  if (!manifest) return null;
  const updated: ExportManifest = { ...manifest, sourceDocumentsPurgedAt: purgedAt };
  const config = getServerConfig();
  await writeFile(
    exportArtifactPath(config.dataDir, returnId, MANIFEST_NAME),
    encryptJson(config.encryptionKey, updated),
  );
  return updated;
}

/** Stamp the return `status: "exported"` (PRD FR-14). No-op if already exported or read-only. */
export async function markReturnExported(returnId: string): Promise<void> {
  const repository = getReturnRepository();
  const { envelope, readOnly } = await repository.loadReturn(returnId);
  if (readOnly || envelope.status === "exported") return;
  await repository.saveReturn(returnId, { data: envelope.data, status: "exported" });
}
