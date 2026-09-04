import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";

import { PARAMS_VERSION, TARGET_YEAR } from "@aus-tax-lodge/params";

import { decryptJson, encryptJson } from "./crypto";
import { assertSafeId, returnDir, returnJsonPath, returnsRoot } from "./paths";
import { createDocumentStore } from "./store";
import type { DocumentStoreOptions } from "./types";

/**
 * Per-return state persistence (PRD FR-16). Each return is a directory under
 * `<dataDir>/returns/<returnId>/` holding one AES-256-GCM encrypted `return.json`
 * — the *envelope* below — plus its encrypted source documents (owned by the
 * document store). There is no database and no plaintext on disk.
 *
 * The envelope carries an opaque `data` payload: the field-level domain model
 * (labels, figures, provenance) is T6's, persisted here verbatim.
 *
 * Concurrency: this is a single-user app with no cross-process lock. Two writers
 * to one return (e.g. two browser tabs) resolve **last-write-wins** — each
 * {@link ReturnRepository.saveReturn} bumps `revision`; a caller that passes a
 * stale `expectedRevision` gets a conflict result and decides how to proceed.
 */

/** Bump when {@link ReturnEnvelope} changes shape incompatibly. */
export const RETURN_SCHEMA_VERSION = 1;

export type ReturnStatus = "in-progress" | "exported";

export interface ReturnEnvelope {
  /** Persistence-format version of this file. */
  readonly schemaVersion: number;
  readonly returnId: string;
  /** ATO income year the return targets (e.g. `2025-26`). */
  readonly targetYear: string;
  /** Curated tax-parameter dataset version the return was built against. */
  readonly paramsVersion: string;
  readonly status: ReturnStatus;
  /** Where the wizard resumes (PRD FR-16 — the current step survives a restart). */
  readonly currentStep: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Monotonic write counter; the last-write-wins version stamp. */
  readonly revision: number;
  /** Opaque T6-owned field-level domain model. Stored and returned unchanged. */
  readonly data: unknown;
}

export interface CreateReturnInput {
  /** Initial opaque payload. Defaults to `null`. */
  readonly data?: unknown;
  /** Where the wizard resumes. Defaults to `""`. */
  readonly currentStep?: string;
}

export interface SaveReturnInput {
  readonly data: unknown;
  readonly status?: ReturnStatus;
  readonly currentStep?: string;
  /**
   * The `revision` the caller last saw. When supplied and it no longer matches
   * the stored revision, the save is refused with a conflict result (not an
   * exception) so the UI / T14 can decide how to reconcile.
   */
  readonly expectedRevision?: number;
}

export interface LoadReturnResult {
  readonly envelope: ReturnEnvelope;
  /**
   * `true` when `envelope.paramsVersion !== PARAMS_VERSION` — a return built
   * against a now-retired parameter set. Viewable, but not editable or
   * re-calculable (PRD FR-15 / FR-16).
   */
  readonly readOnly: boolean;
}

export type SaveReturnResult =
  | { readonly conflict: false; readonly envelope: ReturnEnvelope }
  | { readonly conflict: true; readonly current: ReturnEnvelope };

/** Lightweight per-return row for the returns list (PRD FR-16 — a directory scan). */
export interface ReturnSummary {
  readonly returnId: string;
  readonly targetYear: string;
  readonly status: ReturnStatus;
  readonly currentStep: string;
  readonly updatedAt: string;
  readonly readOnly: boolean;
}

export interface ReturnRepository {
  /** Creates a new return: a fresh `returnId`, an encrypted initial `return.json`. */
  createReturn(input?: CreateReturnInput): Promise<ReturnEnvelope>;
  /** Decrypts `return.json` and reports whether it is read-only. Throws if absent. */
  loadReturn(returnId: string): Promise<LoadReturnResult>;
  /** Last-write-wins save with a revision stamp. Refuses a read-only return. */
  saveReturn(returnId: string, input: SaveReturnInput): Promise<SaveReturnResult>;
  /** Directory scan of `<dataDir>/returns/`; skips a malformed/absent `return.json`. */
  listReturns(): Promise<ReturnSummary[]>;
  /** Removes the whole return directory — `return.json` plus every document. */
  deleteReturn(returnId: string): Promise<void>;
}

function isReturnStatus(value: unknown): value is ReturnStatus {
  return value === "in-progress" || value === "exported";
}

/** Structural check for a decrypted `return.json` before we trust its fields. */
function isReturnEnvelope(value: unknown): value is ReturnEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.schemaVersion === "number" &&
    typeof e.returnId === "string" &&
    typeof e.targetYear === "string" &&
    typeof e.paramsVersion === "string" &&
    isReturnStatus(e.status) &&
    typeof e.currentStep === "string" &&
    typeof e.createdAt === "string" &&
    typeof e.updatedAt === "string" &&
    typeof e.revision === "number"
  );
}

/** A `returnId` that is URL-safe and inside the store's `SAFE_SEGMENT` regex. */
function generateReturnId(): string {
  return randomUUID().replace(/-/g, "");
}

export function createReturnRepository(options: DocumentStoreOptions): ReturnRepository {
  const { dataDir, encryptionKey } = options;
  // Recursive delete (documents + return.json) is the document store's job.
  const documents = createDocumentStore(options);

  async function readEnvelope(returnId: string): Promise<ReturnEnvelope> {
    assertSafeId("returnId", returnId);
    let blob: Buffer;
    try {
      blob = await readFile(returnJsonPath(dataDir, returnId));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`return ${returnId} not found`);
      }
      throw err;
    }
    const parsed = decryptJson<unknown>(encryptionKey, blob);
    if (!isReturnEnvelope(parsed)) {
      throw new Error(`return ${returnId} has a malformed return.json`);
    }
    return parsed;
  }

  async function writeEnvelope(envelope: ReturnEnvelope): Promise<void> {
    await mkdir(returnDir(dataDir, envelope.returnId), { recursive: true });
    await writeFile(
      returnJsonPath(dataDir, envelope.returnId),
      encryptJson(encryptionKey, envelope),
    );
  }

  return {
    async createReturn(input = {}) {
      const now = new Date().toISOString();
      const envelope: ReturnEnvelope = {
        schemaVersion: RETURN_SCHEMA_VERSION,
        returnId: generateReturnId(),
        targetYear: TARGET_YEAR,
        paramsVersion: PARAMS_VERSION,
        status: "in-progress",
        currentStep: input.currentStep ?? "",
        createdAt: now,
        updatedAt: now,
        revision: 1,
        data: input.data ?? null,
      };
      await writeEnvelope(envelope);
      return envelope;
    },

    async loadReturn(returnId) {
      const envelope = await readEnvelope(returnId);
      return { envelope, readOnly: envelope.paramsVersion !== PARAMS_VERSION };
    },

    async saveReturn(returnId, input) {
      const current = await readEnvelope(returnId);

      if (current.paramsVersion !== PARAMS_VERSION) {
        throw new Error(
          `return ${returnId} is read-only (built against retired params ${current.paramsVersion})`,
        );
      }
      if (input.expectedRevision !== undefined && input.expectedRevision !== current.revision) {
        return { conflict: true, current };
      }

      const next: ReturnEnvelope = {
        ...current,
        status: input.status ?? current.status,
        currentStep: input.currentStep ?? current.currentStep,
        data: input.data,
        revision: current.revision + 1,
        updatedAt: new Date().toISOString(),
      };
      await writeEnvelope(next);
      return { conflict: false, envelope: next };
    },

    async listReturns() {
      let entries: Dirent[];
      try {
        entries = await readdir(returnsRoot(dataDir), { withFileTypes: true });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw err;
      }

      const summaries: ReturnSummary[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        try {
          const envelope = await readEnvelope(entry.name);
          summaries.push({
            returnId: envelope.returnId,
            targetYear: envelope.targetYear,
            status: envelope.status,
            currentStep: envelope.currentStep,
            updatedAt: envelope.updatedAt,
            readOnly: envelope.paramsVersion !== PARAMS_VERSION,
          });
        } catch (err) {
          console.warn(`skipping return "${entry.name}": ${(err as Error).message}`);
        }
      }
      return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    async deleteReturn(returnId) {
      await documents.deleteReturn(returnId);
    },
  };
}
