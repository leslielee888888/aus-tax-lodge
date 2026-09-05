/**
 * Defensive parsing of a Claude vision reply into {@link ExtractedFigure}s
 * (PRD FR-3 — "parse defensively, drop malformed entries"). Never throws on
 * bad model output: a reply that isn't JSON, isn't an array, or contains a
 * malformed element just yields fewer figures.
 */
import { expectedValueKind, isKnownModelPath } from "./model-paths";
import type { DocumentPrompt } from "./prompts";
import type { ExtractedFigure } from "./types";

interface RawEntry {
  readonly modelPath?: unknown;
  readonly value?: unknown;
  readonly page?: unknown;
  readonly snippet?: unknown;
  readonly rawConfidenceHint?: unknown;
}

/** Accepts a bare number, or a numeric string with `$`, `,` or whitespace the model left in. */
function coerceNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string") {
    const cleaned = raw.replace(/[$,\s]/g, "");
    if (cleaned.length === 0) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function coerceValue(raw: unknown, kind: "number" | "string"): number | string | null {
  if (kind === "number") return coerceNumber(raw);
  return typeof raw === "string" && raw.trim().length > 0 ? raw : null;
}

/**
 * Parses a Claude reply expected to be a JSON array of raw figure objects
 * (see `prompts.ts`'s `JSON_FORMAT_INSTRUCTION`). Drops any element whose
 * `modelPath` isn't in this document type's scope, whose value doesn't
 * coerce to the type that path expects, or whose `page`/`snippet` aren't
 * usable — the model's JSON-shaping is a request, not a guarantee.
 */
export function parseExtractedFigures(reply: string, prompt: DocumentPrompt): ExtractedFigure[] {
  const arrayText = reply.match(/\[[\s\S]*\]/)?.[0];
  if (arrayText === undefined) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(arrayText);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const figures: ExtractedFigure[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) continue;
    const raw = entry as RawEntry;

    if (typeof raw.modelPath !== "string") continue;
    const { modelPath } = raw;
    if (!isKnownModelPath(modelPath) || !prompt.pathAllowed(modelPath)) continue;

    const kind = expectedValueKind(modelPath);
    if (kind === null) continue;
    const value = coerceValue(raw.value, kind);
    if (value === null) continue;

    if (typeof raw.page !== "number" || !Number.isInteger(raw.page) || raw.page < 1) continue;
    if (typeof raw.snippet !== "string" || raw.snippet.trim().length === 0) continue;

    figures.push({
      modelPath,
      value,
      page: raw.page,
      snippet: raw.snippet,
      ...(typeof raw.rawConfidenceHint === "string"
        ? { rawConfidenceHint: raw.rawConfidenceHint }
        : {}),
    });
  }
  return figures;
}
