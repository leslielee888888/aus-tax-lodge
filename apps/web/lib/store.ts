import { createDocumentStore, type DocumentStore } from "@aus-tax-lodge/store";

import { getServerConfig } from "./server-config";

let cached: DocumentStore | undefined;

/**
 * The per-return encrypted document store, bound to `config.dataDir` and
 * `config.encryptionKey`. Server-only; cached for the process.
 */
export function getDocumentStore(): DocumentStore {
  if (!cached) {
    const config = getServerConfig();
    cached = createDocumentStore({
      dataDir: config.dataDir,
      encryptionKey: config.encryptionKey,
    });
  }
  return cached;
}
