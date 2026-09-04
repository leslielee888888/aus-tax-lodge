import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";

import { decrypt, decryptJson, encrypt, encryptJson } from "./crypto";
import { assertSafeId, documentBlobPath, documentMetaPath, documentsDir, returnDir } from "./paths";
import {
  type DocumentMetadata,
  type DocumentStoreOptions,
  type DocumentType,
  type PutDocumentInput,
  type StoredDocument,
  isDocumentType,
} from "./types";

const META_SUFFIX = ".meta";

function extractableFor(detectedType: DocumentType, override?: boolean): boolean {
  return override ?? detectedType !== "unrecognised";
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * A per-return encrypted document store (PRD FR-2, FR-16, FR-17). Pure Node —
 * no framework. Every blob and its metadata are AES-256-GCM encrypted with
 * `options.encryptionKey`; nothing readable (filenames included) is written in
 * the clear.
 */
export interface DocumentStore {
  putDocument(returnId: string, input: PutDocumentInput): Promise<DocumentMetadata>;
  getDocument(returnId: string, docId: string): Promise<StoredDocument>;
  listDocuments(returnId: string): Promise<DocumentMetadata[]>;
  /** User correction of the classifier (PRD FR-2). Re-derives `extractable`. */
  setDocumentType(
    returnId: string,
    docId: string,
    detectedType: DocumentType,
    extractable?: boolean,
  ): Promise<DocumentMetadata>;
  deleteDocument(returnId: string, docId: string): Promise<void>;
  /** Removes the return directory and everything under it (PRD FR-18). */
  deleteReturn(returnId: string): Promise<void>;
}

export function createDocumentStore(options: DocumentStoreOptions): DocumentStore {
  const { dataDir, encryptionKey } = options;

  async function readMetadata(returnId: string, docId: string): Promise<DocumentMetadata> {
    const path = documentMetaPath(dataDir, returnId, docId);
    let blob: Buffer;
    try {
      blob = await readFile(path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`document ${docId} not found in return ${returnId}`);
      }
      throw err;
    }
    return decryptJson<DocumentMetadata>(encryptionKey, blob);
  }

  return {
    async putDocument(returnId, input) {
      assertSafeId("returnId", returnId);
      const detectedType = input.detectedType ?? "unrecognised";
      const docId = randomUUID();
      const metadata: DocumentMetadata = {
        docId,
        filename: input.filename,
        mimeType: input.mimeType,
        size: input.bytes.length,
        detectedType,
        extractable: extractableFor(detectedType, input.extractable),
        uploadedAt: new Date().toISOString(),
      };

      await mkdir(documentsDir(dataDir, returnId), { recursive: true });
      await writeFile(
        documentBlobPath(dataDir, returnId, docId),
        encrypt(encryptionKey, input.bytes),
      );
      await writeFile(
        documentMetaPath(dataDir, returnId, docId),
        encryptJson(encryptionKey, metadata),
      );
      return metadata;
    },

    async getDocument(returnId, docId) {
      const metadata = await readMetadata(returnId, docId);
      const blob = await readFile(documentBlobPath(dataDir, returnId, docId));
      return { metadata, bytes: decrypt(encryptionKey, blob) };
    },

    async listDocuments(returnId) {
      assertSafeId("returnId", returnId);
      let entries: string[];
      try {
        entries = await readdir(documentsDir(dataDir, returnId));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw err;
      }
      const docIds = entries.filter((name) => !name.endsWith(META_SUFFIX));
      const metadata = await Promise.all(docIds.map((docId) => readMetadata(returnId, docId)));
      return metadata.sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));
    },

    async setDocumentType(returnId, docId, detectedType, extractable) {
      if (!isDocumentType(detectedType)) {
        throw new Error(`unknown document type ${JSON.stringify(detectedType)}`);
      }
      const current = await readMetadata(returnId, docId);
      const updated: DocumentMetadata = {
        ...current,
        detectedType,
        extractable: extractableFor(detectedType, extractable),
      };
      await writeFile(
        documentMetaPath(dataDir, returnId, docId),
        encryptJson(encryptionKey, updated),
      );
      return updated;
    },

    async deleteDocument(returnId, docId) {
      const blobPath = documentBlobPath(dataDir, returnId, docId);
      if (!(await pathExists(`${blobPath}${META_SUFFIX}`))) {
        throw new Error(`document ${docId} not found in return ${returnId}`);
      }
      await rm(blobPath, { force: true });
      await rm(`${blobPath}${META_SUFFIX}`, { force: true });
    },

    async deleteReturn(returnId) {
      await rm(returnDir(dataDir, returnId), { recursive: true, force: true });
    },
  };
}
