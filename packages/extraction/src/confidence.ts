/**
 * Deterministic confidence assignment (PRD FR-3). The model never sets this —
 * every {@link ExtractedFigure} it returns is scored here, against the app's
 * own rules:
 *
 * - `low` — the format/range check fails ({@link isFormatValid}), OR the
 *   document has no usable text layer to check against (`doc.textLayer ===
 *   null` — an image upload, or a scanned/rasterised PDF).
 * - `unverified` — the document DOES have a text layer, but the figure's
 *   claimed snippet can't be found in it. This is the hallucination guard
 *   (PRD Q19) and overrides everything else once format is otherwise valid
 *   and a text layer exists to check against — a figure that can't be
 *   located where it claims to be can't be trusted just because another
 *   source happens to agree with its value.
 * - `high` — format-valid, located in the text layer (or, when there's no
 *   text layer at all, an explicit cross-check agrees).
 * - `medium` — format-valid and located, but an available cross-check
 *   (e.g. the franking-credit ratio) came back inconclusive rather than a
 *   clean agreement — found and correctly sourced, just not corroborated.
 *
 * This ordering is this module's reading of FR-3's four bullet points, which
 * overlap in places (`unverified` and "no text layer to check against" both
 * touch "high"'s text-layer disjunct) — documented here so the intent is
 * explicit rather than implicit in the branch order.
 */
import type { FieldConfidence } from "@aus-tax-lodge/model";

import { isFormatValid } from "./validators";
import { locateSnippet, type TextLayer } from "./text-layer";
import type { ExtractedFigure } from "./types";

/** What {@link assignConfidence} needs to know about the source document. */
export interface ConfidenceDocInfo {
  /** `null` when the document has no usable text layer (image upload, or a scanned/rasterised PDF). */
  readonly textLayer: TextLayer | null;
}

/** The outcome of one deterministic cross-check against another figure or source. */
export type CrossCheckResult = "agrees" | "disagrees";

/**
 * Assigns a figure's confidence per the FR-3 rules above. `crossCheck` is
 * optional — omit it when no independent check applies to this field (e.g.
 * a plain payer name).
 */
export function assignConfidence(
  figure: Pick<ExtractedFigure, "modelPath" | "value" | "snippet">,
  doc: ConfidenceDocInfo,
  crossCheck?: CrossCheckResult,
): FieldConfidence {
  if (!isFormatValid(figure.modelPath, figure.value)) return "low";

  if (doc.textLayer === null) {
    // Image-only / no text layer: the locate check can't run at all. A
    // cross-check is the only remaining evidence.
    return crossCheck === "agrees" ? "high" : "low";
  }

  const located = locateSnippet(figure.snippet, doc.textLayer);
  if (!located) return "unverified";

  if (crossCheck === "disagrees") return "medium";
  return "high";
}

/**
 * The franking-credit plausibility check (PRD FR-3 "format/range check";
 * this task's franking cross-check): a franked dividend's attached franking
 * credit should be roughly 30% of the franked amount (the corporate tax
 * rate most Australian companies frank at). Returns `undefined` when there's
 * nothing to check (no franked amount), `"agrees"` within a tolerance band
 * that absorbs rounding on the statement, `"disagrees"` otherwise.
 */
export function frankingCreditCrossCheck(
  franked: number,
  frankingCredits: number,
): CrossCheckResult | undefined {
  if (!Number.isFinite(franked) || franked <= 0) return undefined;
  const expected = franked * 0.3;
  const tolerance = Math.max(expected * 0.15, 1);
  return Math.abs(frankingCredits - expected) <= tolerance ? "agrees" : "disagrees";
}
