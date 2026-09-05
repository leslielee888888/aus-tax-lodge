/**
 * The PDF text-layer check behind `unverified` / `low` confidence (PRD FR-3,
 * Q6, Q19).
 *
 * A digital-native PDF carries an extractable text layer the model's claimed
 * snippet can be checked against — a cheap, deterministic hallucination
 * guard that doesn't need a second Claude call. A scanned/rasterised PDF, or
 * a PNG/JPG upload, has no such layer; those documents are `low` confidence
 * (extraction can't be verified), never `unverified` (there is nothing to
 * check the snippet against).
 *
 * Dependency choice: `unpdf` (a thin, dependency-free wrapper around
 * `pdfjs-dist`, ~2 MB unpacked) rather than `pdf-parse` (pulls in
 * `@napi-rs/canvas`, ~20 MB, for image rendering this package never does) or
 * raw `pdfjs-dist` (its default build also carries an optional native canvas
 * dependency). `unpdf`'s `extractText` needs no canvas for plain text
 * extraction, which is all this check does.
 */
import { extractText, getDocumentProxy } from "unpdf";

/** One document's extractable text, one string per page (index 0 = page 1). */
export interface TextLayer {
  readonly pages: readonly string[];
}

/** A page below this many non-whitespace characters is treated as scanned/rasterised, not text. */
const MIN_TEXT_LAYER_CHARS = 20;

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function stripPunctuation(text: string): string {
  return text.replace(/[^a-z0-9]+/g, "");
}

/**
 * Reads the text layer out of a PDF. Returns `null` for a non-PDF mime type,
 * a PDF with no meaningful extractable text (scanned/rasterised), or a PDF
 * `unpdf` can't parse at all — every one of those is "no text layer to check
 * against" for {@link import("./confidence").assignConfidence}.
 */
export async function extractTextLayer(bytes: Buffer, mimeType: string): Promise<TextLayer | null> {
  if (mimeType !== "application/pdf") return null;

  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: false });
    const totalChars = text.reduce((sum, page) => sum + page.trim().length, 0);
    if (totalChars < MIN_TEXT_LAYER_CHARS) return null;
    return { pages: text };
  } catch {
    return null;
  }
}

/**
 * `true` when `snippet` can be found in `textLayer` (case/whitespace
 * insensitive, tolerating punctuation and currency-symbol differences
 * between the model's quoting and the raw extracted text). Checked across
 * every page rather than only the figure's claimed page — a mis-numbered
 * page from the model shouldn't by itself make a real snippet `unverified`.
 */
export function locateSnippet(snippet: string, textLayer: TextLayer): boolean {
  const needle = normalize(snippet);
  if (needle.length === 0) return false;
  const strippedNeedle = stripPunctuation(needle);

  return textLayer.pages.some((pageText) => {
    const haystack = normalize(pageText);
    if (haystack.includes(needle)) return true;
    return strippedNeedle.length > 0 && stripPunctuation(haystack).includes(strippedNeedle);
  });
}
