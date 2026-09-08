import {
  createEmptyReturnModel,
  RETURN_MODEL_VERSION,
  type ReturnModel,
} from "@aus-tax-lodge/model";
import {
  createReturnRepository,
  type LoadReturnResult,
  type ReturnRepository,
  type ReturnStatus,
  type SaveReturnResult,
} from "@aus-tax-lodge/store";

import { type ConversationState, readConversation, withConversation } from "./conversation";
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

/**
 * Thrown by {@link saveConversation} on a return whose `paramsVersion` has been
 * retired (PRD FR-12) — the transcript and any produced export stay viewable,
 * but nothing is editable or recomputable. Mirrors the read-only refusal in
 * `app/returns/[returnId]/review/actions.ts`; the store's `saveReturn` throws
 * for the same reason, this just names it for the chat route (T3) to catch.
 */
export class ConversationReadOnlyError extends Error {
  constructor(returnId: string) {
    super(
      `return ${returnId} is read-only — it was built against a retired tax year and can't be edited`,
    );
    this.name = "ConversationReadOnlyError";
  }
}

export interface LoadedConversation extends LoadedReturnModel {
  /** The stored conversation state, or a fresh empty one for a return that predates FR-12. */
  readonly conversation: ConversationState;
}

/**
 * One call for the chat route (T3): the envelope, the `ReturnModel`, the
 * {@link ConversationState} carried on it, and whether the return is read-only
 * (a retired-params return — PRD FR-12). Wraps {@link loadReturnModel}.
 */
export async function loadConversation(returnId: string): Promise<LoadedConversation> {
  const loaded = await loadReturnModel(returnId);
  return { ...loaded, conversation: readConversation(loaded.model) };
}

export interface SaveConversationInput {
  /** The current `ReturnModel` — persisted verbatim under the conversation block. */
  readonly model: ReturnModel;
  readonly conversation: ConversationState;
  /** The `revision` the caller last saw; a stale value yields a `conflict` result (last-write-wins). */
  readonly expectedRevision?: number;
  /** Set to `"exported"` once the package is built (PRD FR-11); defaults to the stored status. */
  readonly status?: ReturnStatus;
}

/**
 * Persist a conversation: writes `withConversation(model, conversation)` as the
 * envelope's opaque `data` so callers never reach for the raw repository. The
 * {@link SaveReturnResult} — including the `conflict` case — is returned
 * unchanged. Refuses a retired-params return with {@link ConversationReadOnlyError}.
 */
export async function saveConversation(
  returnId: string,
  input: SaveConversationInput,
): Promise<SaveReturnResult> {
  const repository = getReturnRepository();
  const { readOnly } = await repository.loadReturn(returnId);
  if (readOnly) throw new ConversationReadOnlyError(returnId);
  return repository.saveReturn(returnId, {
    data: withConversation(input.model, input.conversation),
    status: input.status,
    expectedRevision: input.expectedRevision,
  });
}
