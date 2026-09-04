/**
 * The out-of-scope detector (PRD FR-20, Q12, §3 non-goals).
 *
 * A pure function: given the {@link ReturnModel}, the uploaded document list and
 * any per-document content-classification results, it returns every reason the
 * return is out of scope. An empty array means in scope. It never does I/O — the
 * Claude content check that produces `contentFindings` lives in
 * {@link import("./content-check")} and is run by the extraction pipeline (T11)
 * before this is called.
 *
 * Enforcement (block save / block export / stop mid-flow) is
 * {@link import("./enforce")}; the hard-stop screen is T17.
 */
import type { ReturnModel } from "@aus-tax-lodge/model";

import { type OutOfScopeFinding, type ScopeContentCategory, scopeFinding } from "./findings";

/** One uploaded document, as the detector needs to see it (a `@aus-tax-lodge/store` `DocumentType` string). */
export interface ScopeDocumentInfo {
  readonly docId: string;
  /** The store `DocumentType`, e.g. `"dividend-statement"`, `"rental-agent-statement"`, `"unrecognised"`. */
  readonly detectedType: string;
  readonly filename: string;
}

/**
 * The result of a content check over one document
 * ({@link import("./content-check").checkDocumentForOutOfScopeContent}).
 * `categories` empty means the document looked in scope.
 */
export interface DocumentContentClassification {
  readonly docId: string;
  readonly filename: string;
  readonly categories: readonly ScopeContentCategory[];
}

export interface DetectOutOfScopeInput {
  readonly model: ReturnModel;
  /** Every uploaded document. Optional — used to decide what still needs a content check. */
  readonly documents?: readonly ScopeDocumentInfo[];
  /** Per-document content-classification results from T11's Claude scope check. */
  readonly contentFindings?: readonly DocumentContentClassification[];
}

/**
 * Document types whose *content* still has to be checked by Claude for
 * out-of-scope material (PRD FR-20). A `dividend-statement` can actually be a
 * managed-fund / trust distribution; an `unrecognised` file can be anything.
 * Everything else is a recognised in-scope type and is trusted.
 */
const CONTENT_CHECK_TYPES: ReadonlySet<string> = new Set(["dividend-statement", "unrecognised"]);

/** The documents T11 should run {@link import("./content-check")} over before calling {@link detectOutOfScope}. */
export function documentsNeedingContentCheck(
  documents: readonly ScopeDocumentInfo[],
): ScopeDocumentInfo[] {
  return documents.filter((d) => CONTENT_CHECK_TYPES.has(d.detectedType));
}

/**
 * Guard the deduction UI (T17) calls before letting the user choose the car
 * **logbook** method — cents-per-km is the only supported method (PRD FR-5,
 * FR-20). Returns `null` for an in-scope or not-yet-chosen method.
 */
export function carMethodOutOfScope(method: string): OutOfScopeFinding | null {
  if (method === "" || method === "cents-per-km") return null;
  return scopeFinding("car-logbook-method", "figure");
}

/**
 * Guard the deduction UI (T17) calls before letting the user choose the
 * working-from-home **actual-cost** method — the fixed rate is the only
 * supported method (PRD FR-5, FR-20). Returns `null` for an in-scope or
 * not-yet-chosen method.
 */
export function wfhMethodOutOfScope(method: string): OutOfScopeFinding | null {
  if (method === "" || method === "fixed-rate") return null;
  return scopeFinding("wfh-actual-cost-method", "figure");
}

function residencyFinding(model: ReturnModel): OutOfScopeFinding | null {
  const residency = model.context.residency.value;
  if (residency === "non-resident") return scopeFinding("non-resident", "answer");
  if (residency === "part-year-resident") return scopeFinding("part-year-resident", "answer");
  if (model.questionnaire.residencyFullYear.value === false) {
    return scopeFinding("residency-not-full-year-resident", "answer");
  }
  return null;
}

function rentalFindings(model: ReturnModel): OutOfScopeFinding[] {
  if (!model.rental.present) return [];

  const rental = model.rental;
  const gate = model.questionnaire.rentalScopeGate.value;
  const out: OutOfScopeFinding[] = [];

  // The scope gate answer (FR-6) and the rental.* fields (T7 populates these
  // from the same facts) are both checked — a `false` on either side is a stop.
  // T7: once `rentalScopeViolations()` is exported from the rental module,
  // fold these three field checks into that call and keep the gate check here.
  if (rental.soleOwnership.value === false || gate?.solelyOwned === false) {
    out.push(scopeFinding("rental-co-owned", "answer"));
  }
  if (rental.rentedOrAvailableAllYear.value === false || gate?.rentedOrAvailableAllYear === false) {
    out.push(scopeFinding("rental-part-year", "answer"));
  }
  if (rental.noPrivateUse.value === false || gate?.noPrivateUse === false) {
    out.push(scopeFinding("rental-private-use", "answer"));
  }
  if (gate?.notBoughtOrSoldThisYear === false) {
    out.push(scopeFinding("rental-bought-or-sold-this-year", "answer"));
  }

  // The model carries one rental today. Guard for a future multi-property shape.
  const maybeMulti = model as unknown as { readonly rentals?: readonly unknown[] };
  if (Array.isArray(maybeMulti.rentals) && maybeMulti.rentals.length > 1) {
    out.push(scopeFinding("rental-multiple-properties", "answer"));
  }

  return out;
}

/**
 * Every reason the return is out of scope (PRD FR-20). An empty array = in
 * scope. Findings from answers/figures are de-duplicated by code; each flagged
 * document contributes its own finding so the user sees which file it was.
 */
export function detectOutOfScope(input: DetectOutOfScopeInput): OutOfScopeFinding[] {
  const { model } = input;
  const findings: OutOfScopeFinding[] = [];
  const seenCodes = new Set<string>();

  const pushUnique = (finding: OutOfScopeFinding | null): void => {
    if (finding && !seenCodes.has(finding.code)) {
      seenCodes.add(finding.code);
      findings.push(finding);
    }
  };

  // From answers / the model.
  pushUnique(residencyFinding(model));
  for (const finding of rentalFindings(model)) pushUnique(finding);

  // From figures the user is entering.
  pushUnique(carMethodOutOfScope(model.deductions.workRelatedCar.method));
  pushUnique(wfhMethodOutOfScope(model.deductions.workFromHome.method));

  // From document content — one finding per (document, category).
  for (const doc of input.contentFindings ?? []) {
    const seenForDoc = new Set<string>();
    for (const category of doc.categories) {
      if (seenForDoc.has(category)) continue;
      seenForDoc.add(category);
      findings.push(
        scopeFinding(category, "document", `"${doc.filename}" appears to contain this.`),
      );
    }
  }

  return findings;
}
