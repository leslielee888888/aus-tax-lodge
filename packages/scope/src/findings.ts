/**
 * The out-of-scope finding type and its plain-English catalogue (PRD FR-20,
 * Q12).
 *
 * A {@link OutOfScopeFinding} is what the detector emits and the T17 hard-stop
 * screen renders: a stable `code`, the unsupported `item` in plain English, a
 * `detail` that explains it and points the user to a registered tax agent or
 * ATO myTax, and where it was spotted (`source`).
 */

/** Where an out-of-scope item was detected. */
export type FindingSource = "document" | "answer" | "figure";

/** Every out-of-scope code the detector can raise (PRD FR-20). */
export const SCOPE_CODES = [
  // From the taxpayer's answers / the model
  "non-resident",
  "part-year-resident",
  "residency-not-full-year-resident",
  "rental-co-owned",
  "rental-part-year",
  "rental-private-use",
  "rental-bought-or-sold-this-year",
  "rental-multiple-properties",
  // From a figure the user is trying to enter
  "car-logbook-method",
  "wfh-actual-cost-method",
  // From a document's content
  "capital-gains",
  "business-income",
  "foreign-income",
  "trust-partnership-managed-fund-distribution",
  "employee-share-scheme",
  "etp-or-redundancy",
  "super-income-stream",
] as const;

export type ScopeCode = (typeof SCOPE_CODES)[number];

/**
 * The subset of {@link ScopeCode} a document content check can flag — the
 * categories the Claude prompt in {@link import("./content-check")} asks about.
 */
export const SCOPE_CONTENT_CATEGORIES = [
  "capital-gains",
  "business-income",
  "foreign-income",
  "trust-partnership-managed-fund-distribution",
  "employee-share-scheme",
  "etp-or-redundancy",
  "super-income-stream",
] as const satisfies readonly ScopeCode[];

export type ScopeContentCategory = (typeof SCOPE_CONTENT_CATEGORIES)[number];

export function isScopeContentCategory(value: unknown): value is ScopeContentCategory {
  return (
    typeof value === "string" && (SCOPE_CONTENT_CATEGORIES as readonly string[]).includes(value)
  );
}

/**
 * A single reason a return is out of scope (PRD FR-20). Emitted by
 * {@link import("./detect").detectOutOfScope}; carried by
 * {@link import("./enforce").OutOfScopeError}; rendered by the T17 hard-stop
 * screen. There is no override — a return with any finding is blocked.
 */
export interface OutOfScopeFinding {
  /** Stable machine code — one of {@link SCOPE_CODES}. */
  readonly code: ScopeCode;
  /** The unsupported thing in plain English, e.g. "Rental property co-owned with another person". */
  readonly item: string;
  /** Why it is out of scope and where to take the return instead. */
  readonly detail: string;
  /** Where it was detected. */
  readonly source: FindingSource;
}

interface ScopeItemSpec {
  readonly item: string;
  /** The item-specific explanation; {@link ADVICE} is appended to form `detail`. */
  readonly explain: string;
}

const ADVICE =
  "This assistant only prepares a simple resident individual return, so it cannot continue. " +
  "Lodge this return through a registered tax agent or directly in ATO myTax.";

const CATALOGUE: Record<ScopeCode, ScopeItemSpec> = {
  "non-resident": {
    item: "Non-resident for tax purposes",
    explain:
      "This return is marked as a non-resident for tax purposes, which uses different rates and has no tax-free threshold.",
  },
  "part-year-resident": {
    item: "Part-year Australian resident",
    explain:
      "This return is marked as a part-year resident, which needs a pro-rated tax-free threshold this assistant does not calculate.",
  },
  "residency-not-full-year-resident": {
    item: "Not an Australian resident for the full year",
    explain:
      "You answered that you were not an Australian resident for tax purposes for the whole income year.",
  },
  "rental-co-owned": {
    item: "Rental property co-owned with another person",
    explain:
      "A co-owned rental has to be split between the owners on each owner's return. This assistant only handles a rental you own outright.",
  },
  "rental-part-year": {
    item: "Rental property not rented or available all year",
    explain:
      "The property was rented or genuinely available for only part of the year — or is a holiday home, or a short-stay / Airbnb letting — which needs the income and deductions apportioned.",
  },
  "rental-private-use": {
    item: "Rental property with private use",
    explain:
      "The property was used privately for part of the year, so its deductions have to be apportioned for the private-use period.",
  },
  "rental-bought-or-sold-this-year": {
    item: "Rental property bought or sold during the year",
    explain:
      "Buying or selling the property during the year brings in settlement adjustments and capital gains tax, which this assistant does not handle.",
  },
  "rental-multiple-properties": {
    item: "More than one rental property",
    explain: "This assistant only handles a single rental property.",
  },
  "car-logbook-method": {
    item: "Car expenses claimed using the logbook method",
    explain:
      "This assistant only supports the cents-per-kilometre car method. The logbook method needs a full logbook and a business-use percentage.",
  },
  "wfh-actual-cost-method": {
    item: "Working-from-home expenses claimed using the actual-cost method",
    explain:
      "This assistant only supports the fixed-rate working-from-home method. The actual-cost method needs apportioned bills and asset depreciation.",
  },
  "capital-gains": {
    item: "Capital gains (sale of shares, property, crypto or other assets)",
    explain:
      "A capital gains tax event — including the sale or contract of sale of the rental during the year — needs a CGT calculation this assistant does not do.",
  },
  "business-income": {
    item: "Business or sole-trader income",
    explain:
      "Sole-trader, business or personal-services income needs a business schedule this assistant does not prepare.",
  },
  "foreign-income": {
    item: "Foreign income",
    explain:
      "Foreign employment, pension, investment or rental income — and any foreign income tax offset — is outside this assistant's scope.",
  },
  "trust-partnership-managed-fund-distribution": {
    item: "Trust, partnership or managed-fund distribution",
    explain:
      "A distribution from a trust, partnership, managed fund or ETF carries components (franked and unfranked amounts, foreign income, capital gains) this assistant does not map.",
  },
  "employee-share-scheme": {
    item: "Employee share scheme interest",
    explain:
      "An employee share scheme discount has its own deferred-taxing-point rules this assistant does not handle.",
  },
  "etp-or-redundancy": {
    item: "Employment termination or redundancy payment",
    explain:
      "An employment termination payment or genuine redundancy payment is taxed under separate rules and caps this assistant does not apply.",
  },
  "super-income-stream": {
    item: "Superannuation income stream or lump sum",
    explain:
      "A super pension, annuity or lump-sum payment has its own offsets and tax treatment this assistant does not calculate.",
  },
};

/**
 * Build a finding for `code`. `context` is an optional leading sentence — e.g.
 * which document a content check flagged — placed before the catalogue
 * explanation.
 */
export function scopeFinding(
  code: ScopeCode,
  source: FindingSource,
  context?: string,
): OutOfScopeFinding {
  const spec = CATALOGUE[code];
  const detail = [context, spec.explain, ADVICE].filter(Boolean).join(" ");
  return { code, item: spec.item, detail, source };
}
