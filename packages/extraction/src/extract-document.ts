/**
 * `extractDocument` — the per-document entry point (PRD FR-3). Reads one
 * stored document, runs its document-type prompt through Claude vision, and
 * scores every figure it returns with deterministic confidence. Gated on
 * `metadata.extractable` — an `unrecognised` (or user-excluded) document
 * yields no figures.
 */
import type { ClaudeClient, VisionPart } from "@aus-tax-lodge/ai";
import type { DocumentStore, DocumentType } from "@aus-tax-lodge/store";

import { assignConfidence, frankingCreditCrossCheck, type CrossCheckResult } from "./confidence";
import { EXTRACTABLE_DOCUMENT_PROMPTS } from "./prompts";
import { parseExtractedFigures } from "./parse";
import { extractTextLayer, type TextLayer } from "./text-layer";
import type { ExtractedFigure, ScoredExtractedFigure } from "./types";

export interface ExtractDocumentDeps {
  readonly store: Pick<DocumentStore, "getDocument">;
  readonly client: Pick<ClaudeClient, "askVision">;
  /** Override for tests. Defaults to the real `unpdf`-backed check. */
  readonly extractTextLayer?: (bytes: Buffer, mimeType: string) => Promise<TextLayer | null>;
}

export interface ExtractDocumentResult {
  readonly docId: string;
  readonly documentType: DocumentType;
  readonly figures: readonly ScoredExtractedFigure[];
}

const FRANKING_PAIR_PATH = /^income\.dividends\[(\d+)\]\.(franked|frankingCredits)$/;

/**
 * The only cross-check `extractDocument` can run by itself, without another
 * document's data: a franked dividend's franking credit should be ~30% of
 * the franked amount (PRD FR-3). Cross-*document* agreement (the other half
 * of FR-3's "or agrees with another source") is for the caller assembling
 * multiple documents' results — see `applyExtractions`'s `pendingReconciliation`.
 */
function computeWithinDocumentCrossChecks(
  figures: readonly ExtractedFigure[],
): ReadonlyMap<string, CrossCheckResult> {
  const byIndex = new Map<
    number,
    { franked?: number; frankingCredits?: number; frankingCreditsPath?: string }
  >();

  for (const figure of figures) {
    const match = FRANKING_PAIR_PATH.exec(figure.modelPath);
    if (!match || typeof figure.value !== "number") continue;
    const [, indexText, field] = match as unknown as [
      string,
      string,
      "franked" | "frankingCredits",
    ];
    const index = Number(indexText);
    const entry = byIndex.get(index) ?? {};
    if (field === "franked") entry.franked = figure.value;
    else {
      entry.frankingCredits = figure.value;
      entry.frankingCreditsPath = figure.modelPath;
    }
    byIndex.set(index, entry);
  }

  const results = new Map<string, CrossCheckResult>();
  for (const entry of byIndex.values()) {
    if (
      entry.franked === undefined ||
      entry.frankingCredits === undefined ||
      entry.frankingCreditsPath === undefined
    ) {
      continue;
    }
    const result = frankingCreditCrossCheck(entry.franked, entry.frankingCredits);
    if (result !== undefined) results.set(entry.frankingCreditsPath, result);
  }
  return results;
}

function scoreFigures(
  figures: readonly ExtractedFigure[],
  textLayer: TextLayer | null,
): ScoredExtractedFigure[] {
  const crossChecks = computeWithinDocumentCrossChecks(figures);
  return figures.map((figure) => ({
    ...figure,
    confidence: assignConfidence(figure, { textLayer }, crossChecks.get(figure.modelPath)),
  }));
}

function visionPartFor(mimeType: string, bytes: Buffer): VisionPart {
  return { kind: mimeType === "application/pdf" ? "pdf" : "image", mimeType, bytes };
}

/**
 * Extracts every figure {@link EXTRACTABLE_DOCUMENT_PROMPTS} knows how to
 * read from one document. Never writes the return — the caller passes the
 * result to {@link import("./apply").applyExtractions} for the user to
 * confirm (PRD FR-7).
 */
export async function extractDocument(
  returnId: string,
  docId: string,
  deps: ExtractDocumentDeps,
): Promise<ExtractDocumentResult> {
  const { metadata, bytes } = await deps.store.getDocument(returnId, docId);

  const prompt = metadata.extractable
    ? EXTRACTABLE_DOCUMENT_PROMPTS[metadata.detectedType]
    : undefined;
  if (!prompt) {
    return { docId, documentType: metadata.detectedType, figures: [] };
  }

  const readTextLayer = deps.extractTextLayer ?? extractTextLayer;
  const [reply, textLayer] = await Promise.all([
    deps.client.askVision(
      [visionPartFor(metadata.mimeType, bytes)],
      prompt.buildPrompt(metadata.filename),
      {
        system: prompt.system,
        maxTokens: 4096,
      },
    ),
    readTextLayer(bytes, metadata.mimeType),
  ]);

  const rawFigures = parseExtractedFigures(reply, prompt);
  return {
    docId,
    documentType: metadata.detectedType,
    figures: scoreFigures(rawFigures, textLayer),
  };
}
