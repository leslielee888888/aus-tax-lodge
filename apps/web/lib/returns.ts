import { createReturnRepository, type ReturnRepository } from "@aus-tax-lodge/store";

import { getServerConfig } from "./server-config";

let cached: ReturnRepository | undefined;

/**
 * Per-return encrypted `return.json` persistence (PRD FR-16), bound to
 * `config.dataDir` and `config.encryptionKey`. Server-only; cached for the
 * process. The unlock gate / returns list (T14) and the wizard steps read
 * through this.
 */
export function getReturnRepository(): ReturnRepository {
  if (!cached) {
    const config = getServerConfig();
    cached = createReturnRepository({
      dataDir: config.dataDir,
      encryptionKey: config.encryptionKey,
    });
  }
  return cached;
}
