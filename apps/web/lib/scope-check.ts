import type { ReturnModel } from "@aus-tax-lodge/model";
import {
  checkDocumentForOutOfScopeContent,
  detectOutOfScope,
  documentsNeedingContentCheck,
  type OutOfScopeFinding,
  type ScopeDocumentInfo,
  type ScopeVisionClient,
  type ScopeVisionPart,
} from "@aus-tax-lodge/scope";

import {
  readScopeContentScratch,
  withScopeContentScratch,
  type ScopeContentClassificationEntry,
} from "./scope-content-scratch";

/**
 * `checkModelInScope` — the out-of-scope gate over a whole return, run on every
 * document as well as every answer (PRD FR-8, FR-20, Q12).
 *
 * It pulls together the three inputs `@aus-tax-lodge/scope` needs to decide
 * whether a return can proceed:
 *
 *  1. the uploaded documents as {@link ScopeDocumentInfo}[] (from the injected
 *     store's document list);
 *  2. `contentFindings` — one Claude vision `checkDocumentForOutOfScopeContent`
 *     call over every document {@link documentsNeedingContentCheck} returns that
 *     has not already been classified (or was re-typed since). Results are
 *     cached on the model under the shared `__t26ScopeContent` key via
 *     {@link import("./scope-content-scratch")} — exactly as v1's
 *     `documents/actions.ts` does — so a re-check is free;
 *  3. `detectOutOfScope({ model, documents, contentFindings })` — the pure,
 *     deterministic detector that actually raises the findings.
 *
 * Dependency-injected (store + vision client passed in) so it unit-tests without
 * Next. The pre-fill route calls it today; T6 (mid-conversation documents) and
 * T8 (review) reuse it.
 *
 * Scope detection is deterministic — Claude is never the one to raise an
 * out-of-scope stop (see `lib/interview/next-turn.ts`, which drops the
 * `out-of-scope` card from its allow-list). The single Claude call here only
 * classifies a document's content; the stop itself is `detectOutOfScope`'s.
 *
 * A failed content check (Claude error, unreadable document) is left to throw —
 * the caller must surface that and not let the return proceed as if the
 * document were clean.
 */

/** The `DocumentMetadata` fields this check reads — the store's list satisfies it. */
export interface ScopeCheckDocumentMeta {
  readonly docId: string;
  readonly filename: string;
  readonly detectedType: string;
}

/** The slice of `@aus-tax-lodge/store`'s `DocumentStore` this check needs. */
export interface ScopeCheckStore {
  listDocuments(returnId: string): Promise<readonly ScopeCheckDocumentMeta[]>;
  getDocument(
    returnId: string,
    docId: string,
  ): Promise<{ readonly bytes: Buffer; readonly metadata: { readonly mimeType: string } }>;
}

export interface CheckModelInScopeInput {
  readonly returnId: string;
  readonly model: ReturnModel;
  readonly store: ScopeCheckStore;
  readonly visionClient: ScopeVisionClient;
}

export interface CheckModelInScopeResult {
  /** Every reason the return is out of scope — an empty array means in scope. */
  readonly findings: OutOfScopeFinding[];
  /**
   * `model` with the document content-classification cache refreshed under
   * `__t26ScopeContent`. Persist this on the in-scope path so a later re-check
   * skips the Claude call; every other model field is untouched.
   */
  readonly model: ReturnModel;
}

/** Build the multimodal part for a stored document — mirrors `packages/extraction`'s `visionPartFor`. */
function scopeVisionPartFor(mimeType: string, bytes: Buffer): ScopeVisionPart {
  return { kind: mimeType === "application/pdf" ? "pdf" : "image", mimeType, bytes };
}

/**
 * Run the out-of-scope gate over `model` + the return's documents. Never
 * persists — returns the findings and a model carrying the refreshed content
 * cache for the caller to save (or discard, on a hard stop — PRD FR-9).
 */
export async function checkModelInScope(
  input: CheckModelInScopeInput,
): Promise<CheckModelInScopeResult> {
  const { returnId, model, store, visionClient } = input;

  const documents = await store.listDocuments(returnId);
  const docInfos: ScopeDocumentInfo[] = documents.map((d) => ({
    docId: d.docId,
    detectedType: d.detectedType,
    filename: d.filename,
  }));

  // --- Document-content check (PRD FR-20, Q12) -----------------------------
  // A recognised `dividend-statement` can be a trust / managed-fund
  // distribution, and an `unrecognised` file can be anything. Run the one
  // Claude vision call over each such document not already cached (or re-typed
  // since), and keep the classifications on the model.
  const cached = new Map(
    readScopeContentScratch(model).classifications.map((entry) => [entry.docId, entry]),
  );
  const classifications: ScopeContentClassificationEntry[] = [];
  for (const doc of documentsNeedingContentCheck(docInfos)) {
    const hit = cached.get(doc.docId);
    if (hit && hit.detectedType === doc.detectedType) {
      classifications.push(hit);
      continue;
    }
    const stored = await store.getDocument(returnId, doc.docId);
    const classification = await checkDocumentForOutOfScopeContent(
      {
        docId: doc.docId,
        filename: doc.filename,
        parts: [scopeVisionPartFor(stored.metadata.mimeType, stored.bytes)],
      },
      visionClient,
    );
    classifications.push({
      docId: doc.docId,
      filename: doc.filename,
      detectedType: doc.detectedType,
      categories: classification.categories,
    });
  }

  const checkedModel = withScopeContentScratch(model, { classifications });
  const findings = detectOutOfScope({
    model: checkedModel,
    documents: docInfos,
    contentFindings: classifications.map((c) => ({
      docId: c.docId,
      filename: c.filename,
      categories: c.categories,
    })),
  });

  return { findings, model: checkedModel };
}
