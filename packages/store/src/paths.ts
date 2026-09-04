import { join } from "node:path";

/**
 * On-disk layout under `config.dataDir` (PRD FR-16 / §8):
 *
 *   <dataDir>/returns/<returnId>/
 *     return.json            ← encrypted return state (T13 owns this file)
 *     documents/<docId>       ← encrypted document blob
 *     documents/<docId>.meta  ← encrypted DocumentMetadata JSON
 */

/** Path segment that is safe to place in a filesystem path (no traversal). */
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export function assertSafeId(kind: "returnId" | "docId", value: string): void {
  if (!SAFE_SEGMENT.test(value)) {
    throw new Error(
      `invalid ${kind} ${JSON.stringify(value)} — must match ${String(SAFE_SEGMENT)}`,
    );
  }
}

export function returnsRoot(dataDir: string): string {
  return join(dataDir, "returns");
}

export function returnDir(dataDir: string, returnId: string): string {
  assertSafeId("returnId", returnId);
  return join(returnsRoot(dataDir), returnId);
}

/** Reserved for T13 — the encrypted `return.json`. */
export function returnJsonPath(dataDir: string, returnId: string): string {
  return join(returnDir(dataDir, returnId), "return.json");
}

export function documentsDir(dataDir: string, returnId: string): string {
  return join(returnDir(dataDir, returnId), "documents");
}

export function documentBlobPath(dataDir: string, returnId: string, docId: string): string {
  assertSafeId("docId", docId);
  return join(documentsDir(dataDir, returnId), docId);
}

export function documentMetaPath(dataDir: string, returnId: string, docId: string): string {
  return `${documentBlobPath(dataDir, returnId, docId)}.meta`;
}
