import { createEmptyReturnModel, RETURN_MODEL_VERSION, type ReturnModel } from "@aus-tax-lodge/model";
import {
  createReturnRepository,
  type LoadReturnResult,
  type ReturnRepository,
} from "@aus-tax-lodge/store";

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

/** Structural check that a decrypted envelope's opaque `data` is our model, not some other/earlier shape. */
function isReturnModel(data: unknown): data is ReturnModel {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { modelVersion?: unknown }).modelVersion === RETURN_MODEL_VERSION
  );
}

export interface LoadedReturnModel extends LoadReturnResult {
  /** `envelope.data` typed as a {@link ReturnModel} — a fresh, empty one when the return has none yet. */
  readonly model: ReturnModel;
}

/**
 * {@link ReturnRepository.loadReturn} plus the opaque `data` payload cast to a
 * {@link ReturnModel} — a brand-new return (or one predating the model) gets a
 * fresh {@link createEmptyReturnModel} for its target year. Every wizard step
 * (T15–T20) reads the return through this rather than handling the `unknown`
 * cast itself.
 */
export async function loadReturnModel(returnId: string): Promise<LoadedReturnModel> {
  const { envelope, readOnly } = await getReturnRepository().loadReturn(returnId);
  const model = isReturnModel(envelope.data)
    ? envelope.data
    : createEmptyReturnModel(envelope.targetYear);
  return { envelope, readOnly, model };
}
