/**
 * Builds the review screen's row data from a {@link ReturnModel} (PRD FR-7,
 * FR-20, FR-21, FR-24). Pure and isomorphic — the review page (server) calls
 * it to render the first paint, and `ReviewSections` (client) calls it again
 * with the fresh model a server action returns, so every row always reflects
 * exactly what is on disk.
 *
 * Not this module's job: mutating the model (see `field-paths.ts` and
 * `actions.ts`) or deciding *how* a row renders (see the row components).
 */
import { suggestDefaultChoice, type PendingReconciliation } from "@aus-tax-lodge/extraction";
import {
  apportionedInterest,
  isSettled,
  needsRepairsConfirmation,
  RENTAL_EXPENSE_KEYS,
  RENTAL_REPAIRS_CONFIRMATION_THRESHOLD,
  requiredLabels,
  type FieldConfidence,
  type FieldOrigin,
  type FieldStatus,
  type Provenanced,
  type ReturnModel,
} from "@aus-tax-lodge/model";
import { getTaxonomy } from "@aus-tax-lodge/params";

import type { BadgeTone } from "../../components/Badge";
import { formatCount, formatMoney, formatPercent } from "./format";

// ---------------------------------------------------------------------------
// Source / confidence
// ---------------------------------------------------------------------------

export interface SourceInfo {
  readonly kind: "document" | "user-answer" | "computed" | "none";
  /** Chip text, e.g. `"income_statement.pdf p.1"`, `"you entered it"`, `"computed"`. Empty for `"none"`. */
  readonly label: string;
  readonly snippet?: string;
  readonly confidenceTone: BadgeTone;
  /** Empty string = no confidence badge shown. */
  readonly confidenceLabel: string;
}

const CONFIDENCE_BADGE: Record<FieldConfidence, { tone: BadgeTone; label: string }> = {
  high: { tone: "ok", label: "High" },
  medium: { tone: "warn", label: "Medium" },
  low: { tone: "warn", label: "Low" },
  unverified: { tone: "unverified", label: "Unverified" },
};

export function describeOrigin(
  origin: FieldOrigin | null,
  documentsByDocId: Readonly<Record<string, string>>,
): SourceInfo {
  if (!origin) return { kind: "none", label: "", confidenceTone: "muted", confidenceLabel: "" };
  if (origin.kind === "document") {
    const filename = documentsByDocId[origin.docId] ?? "a document";
    const badge = CONFIDENCE_BADGE[origin.confidence];
    return {
      kind: "document",
      label: `${filename} p.${origin.page}`,
      snippet: origin.snippet,
      confidenceTone: badge.tone,
      confidenceLabel: badge.label,
    };
  }
  if (origin.kind === "user-answer") {
    return { kind: "user-answer", label: "you entered it", confidenceTone: "muted", confidenceLabel: "Entered" };
  }
  return { kind: "computed", label: "computed", confidenceTone: "muted", confidenceLabel: "Computed" };
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export type FieldRowValueKind = "money" | "count" | "percent";

export interface FieldRowData {
  readonly kind: "field";
  readonly path: string;
  readonly label: string;
  readonly sublabel?: string;
  readonly rawValue: number | null;
  readonly displayValue: string;
  readonly valueKind: FieldRowValueKind;
  readonly status: FieldStatus;
  readonly source: SourceInfo;
  readonly unverified: boolean;
  readonly unsubstantiated?: boolean;
}

export interface InterestAccountRowData {
  readonly kind: "interest-account";
  readonly accountId: string;
  readonly label: string;
  readonly sublabel: string;
  readonly grossInterest: number | null;
  readonly ownershipSharePercent: number | null;
  readonly displayValue: string;
  readonly status: FieldStatus;
  readonly source: SourceInfo;
  readonly shareSource: SourceInfo;
  readonly unverified: boolean;
}

export interface RepairsGateRowData {
  readonly kind: "repairs-gate";
  readonly displayValue: string;
  readonly sublabel: string;
  readonly source: SourceInfo;
}

export interface ComputedRowData {
  readonly kind: "computed";
  readonly label: string;
  readonly sublabel?: string;
  readonly displayValue: string;
}

export interface PhiHeldRowData {
  readonly kind: "phi-held";
  readonly held: boolean | null;
  readonly status: FieldStatus;
}

export interface MismatchCandidateData {
  readonly source: string;
  readonly displayValue: string;
  readonly confidenceTone: BadgeTone;
  readonly confidenceLabel: string;
}

export interface MismatchRowData {
  readonly kind: "mismatch";
  readonly modelPath: string;
  readonly label: string;
  readonly sublabel?: string;
  readonly candidates: readonly MismatchCandidateData[];
  readonly suggestedIndex: number;
}

export type ReviewRow =
  | FieldRowData
  | InterestAccountRowData
  | RepairsGateRowData
  | ComputedRowData
  | PhiHeldRowData
  | MismatchRowData;

export interface ReviewSection {
  readonly id: "income" | "deductions" | "rental" | "offsets";
  readonly title: string;
  readonly rows: readonly ReviewRow[];
  readonly confirmedCount: number;
  readonly totalCount: number;
}

export interface ReviewData {
  readonly sections: readonly ReviewSection[];
  readonly progress: { readonly confirmed: number; readonly total: number };
  readonly canContinue: boolean;
  readonly blockingReasons: readonly string[];
}

function num(field: Provenanced<number>): number | null {
  return field.value;
}

function rowIsSettled(row: ReviewRow): boolean {
  switch (row.kind) {
    case "field":
      return row.status === "confirmed" || row.status === "not-applicable";
    case "interest-account":
      return row.status === "confirmed" || row.status === "not-applicable";
    case "phi-held":
      return row.status === "confirmed" || row.status === "not-applicable";
    case "repairs-gate":
    case "mismatch":
      return false;
    case "computed":
      return true;
  }
}

/** Whether `row` counts toward the section's confirmable total (a computed row never needs confirming). */
function rowCounts(row: ReviewRow): boolean {
  return row.kind !== "computed";
}

// ---------------------------------------------------------------------------
// Mismatch translation (extraction's `modelPath` vocabulary → a review row)
// ---------------------------------------------------------------------------

const MISMATCH_ARRAY_RE = /^income\.(salaryWages|interestAccounts|dividends)\[(\d+)\]\.([a-zA-Z]+)$/;

const DIVIDEND_FIELD_LABEL: Record<string, string> = {
  unfranked: "Dividends — unfranked amount",
  franked: "Dividends — franked amount",
  frankingCredits: "Dividends — franking credit",
  tfnAmountsWithheld: "TFN amounts withheld — dividends",
};

function describeMismatchLabel(model: ReturnModel, modelPath: string): { label: string; sublabel?: string } {
  const arrayMatch = MISMATCH_ARRAY_RE.exec(modelPath);
  if (arrayMatch) {
    const [, arrayName, indexText, field] = arrayMatch as unknown as [string, string, string, string];
    const index = Number(indexText);
    if (arrayName === "salaryWages") {
      const employer = model.income.salaryWages[index];
      return {
        label: field === "grossSalaryWages" ? "Salary or wages" : "PAYG tax withheld",
        sublabel: employer ? `Employer: ${employer.payerName.value ?? "—"}` : undefined,
      };
    }
    if (arrayName === "interestAccounts") {
      const account = model.income.interestAccounts[index];
      return {
        label: field === "grossInterest" ? "Gross interest" : "TFN amounts withheld — interest",
        sublabel: account?.institution.value ?? undefined,
      };
    }
    const holding = model.income.dividends[index];
    return {
      label: DIVIDEND_FIELD_LABEL[field] ?? field,
      sublabel: holding?.company.value ?? undefined,
    };
  }

  const known = parseKnownScalarLabel(model, modelPath);
  if (known) return known;

  if (modelPath === "deductions.workFromHome.hours") {
    return { label: "Working from home — hours recorded" };
  }

  return { label: modelPath };
}

function taxonomyName(model: ReturnModel, code: string): string | undefined {
  return getTaxonomy(model.targetYear).labels.find((l) => l.code === code)?.name;
}

function parseKnownScalarLabel(model: ReturnModel, modelPath: string): { label: string } | null {
  const SCALAR_CODE: Readonly<Record<string, string>> = {
    "income.governmentAllowances": "5",
    "income.reportableFringeBenefits": "IT1",
    "income.reportableEmployerSuper": "IT2",
    "deductions.workRelatedCar.amount": "D1",
    "deductions.workRelatedTravel.amount": "D2",
    "deductions.workRelatedClothing.amount": "D3",
    "deductions.selfEducation.amount": "D4",
    "deductions.otherWorkRelated.amount": "D5",
    "deductions.giftsAndDonations.amount": "D9",
    "deductions.costOfManagingTaxAffairs.amount": "D10",
  };
  const PHI_LABEL: Readonly<Record<string, string>> = {
    "privateHealth.premiumsEligibleForRebate": "Private health — premiums eligible for rebate",
    "privateHealth.rebateReceived": "Private health — rebate received",
    "privateHealth.oldestCoveredPersonAge": "Private health — oldest covered person's age",
    "privateHealth.coverDays": "Private health — cover days",
  };
  if (modelPath in PHI_LABEL) return { label: PHI_LABEL[modelPath]! };
  const code = SCALAR_CODE[modelPath];
  if (code) return { label: taxonomyName(model, code) ?? modelPath };
  return null;
}

function candidateSourceLabel(
  candidate: PendingReconciliation["candidates"][number],
  documentsByDocId: Readonly<Record<string, string>>,
): string {
  if (candidate.documentType === "ato-prefill-report") return "ATO pre-fill report";
  const filename = documentsByDocId[candidate.docId];
  const base = filename ?? candidate.documentType;
  return candidate.page > 0 ? `${base} p.${candidate.page}` : base;
}

function describeMismatch(
  model: ReturnModel,
  pending: PendingReconciliation,
  documentsByDocId: Readonly<Record<string, string>>,
): MismatchRowData {
  const { label, sublabel } = describeMismatchLabel(model, pending.modelPath);
  return {
    kind: "mismatch",
    modelPath: pending.modelPath,
    label,
    sublabel,
    suggestedIndex: suggestDefaultChoice(pending).chosenIndex,
    candidates: pending.candidates.map((candidate) => ({
      source: candidateSourceLabel(candidate, documentsByDocId),
      displayValue: typeof candidate.value === "number" ? formatMoney(candidate.value) : String(candidate.value),
      confidenceTone: CONFIDENCE_BADGE[candidate.confidence].tone,
      confidenceLabel: CONFIDENCE_BADGE[candidate.confidence].label,
    })),
  };
}

/** `income.salaryWages[3].grossSalaryWages` — extraction's own path vocabulary, used only to spot a pending mismatch on an array field this screen also renders. */
function extractionArrayPath(arrayName: string, index: number, field: string): string {
  return `income.${arrayName}[${index}].${field}`;
}

// ---------------------------------------------------------------------------
// Field row builder
// ---------------------------------------------------------------------------

function fieldRow(
  path: string,
  label: string,
  field: Provenanced<number>,
  documentsByDocId: Readonly<Record<string, string>>,
  opts: { sublabel?: string; valueKind?: FieldRowValueKind; unsubstantiated?: boolean } = {},
): FieldRowData {
  const source = describeOrigin(field.origin, documentsByDocId);
  const valueKind = opts.valueKind ?? "money";
  const rawValue = num(field);
  const displayValue =
    valueKind === "money" ? formatMoney(rawValue) : valueKind === "percent" ? formatPercent(rawValue) : formatCount(rawValue);
  return {
    kind: "field",
    path,
    label,
    sublabel: opts.sublabel,
    rawValue,
    displayValue,
    valueKind,
    status: field.status,
    source,
    unverified: source.kind === "document" && field.origin?.kind === "document" && field.origin.confidence === "unverified",
    unsubstantiated: opts.unsubstantiated,
  };
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function buildIncomeSection(
  model: ReturnModel,
  documentsByDocId: Readonly<Record<string, string>>,
  pendingByPath: ReadonlyMap<string, PendingReconciliation>,
): ReviewSection {
  const rows: ReviewRow[] = [];
  const taxonomy = getTaxonomy(model.targetYear);
  const name = (code: string) => taxonomy.labels.find((l) => l.code === code)?.name ?? code;

  const pushOrMismatch = (extractionPath: string, buildField: () => FieldRowData) => {
    const pending = pendingByPath.get(extractionPath);
    if (pending) {
      rows.push(describeMismatch(model, pending, documentsByDocId));
    } else {
      rows.push(buildField());
    }
  };

  model.income.salaryWages.forEach((employer, index) => {
    const sublabel = `Employer: ${employer.payerName.value ?? "—"}`;
    pushOrMismatch(extractionArrayPath("salaryWages", index, "grossSalaryWages"), () =>
      fieldRow(
        `income.salaryWages.${employer.id}.grossSalaryWages`,
        name("1"),
        employer.grossSalaryWages,
        documentsByDocId,
        { sublabel },
      ),
    );
    pushOrMismatch(extractionArrayPath("salaryWages", index, "paygWithheld"), () =>
      fieldRow(
        `income.salaryWages.${employer.id}.paygWithheld`,
        name("1.taxWithheld"),
        employer.paygWithheld,
        documentsByDocId,
        { sublabel },
      ),
    );
  });

  model.income.interestAccounts.forEach((account, index) => {
    const grossPending = pendingByPath.get(extractionArrayPath("interestAccounts", index, "grossInterest"));
    if (grossPending) {
      rows.push(describeMismatch(model, grossPending, documentsByDocId));
    } else {
      const share = account.ownershipSharePercent.value;
      const apportioned = share != null && account.grossInterest.value != null ? apportionedInterest(account) : null;
      const grossSource = describeOrigin(account.grossInterest.origin, documentsByDocId);
      const shareSource = describeOrigin(account.ownershipSharePercent.origin, documentsByDocId);
      const bothSettled = isSettled(account.grossInterest) && isSettled(account.ownershipSharePercent);
      const eitherProposed = account.grossInterest.status !== "unset" || account.ownershipSharePercent.status !== "unset";
      rows.push({
        kind: "interest-account",
        accountId: account.id,
        label: name("10L"),
        sublabel: [
          account.institution.value,
          share != null ? `your ${share}% share` : undefined,
          account.accountDescription.value,
        ]
          .filter(Boolean)
          .join(" — "),
        grossInterest: account.grossInterest.value,
        ownershipSharePercent: share,
        displayValue: formatMoney(apportioned),
        status: bothSettled ? "confirmed" : eitherProposed ? "proposed" : "unset",
        source: grossSource,
        shareSource,
        unverified: grossSource.kind === "document" && account.grossInterest.origin?.kind === "document" && account.grossInterest.origin.confidence === "unverified",
      });
    }
    pushOrMismatch(extractionArrayPath("interestAccounts", index, "tfnAmountsWithheld"), () =>
      fieldRow(
        `income.interestAccounts.${account.id}.tfnAmountsWithheld`,
        name("10M"),
        account.tfnAmountsWithheld,
        documentsByDocId,
        { sublabel: account.institution.value ?? undefined },
      ),
    );
  });

  model.income.dividends.forEach((holding, index) => {
    const sublabel = holding.company.value ?? undefined;
    (["unfranked", "franked", "frankingCredits", "tfnAmountsWithheld"] as const).forEach((field) => {
      pushOrMismatch(extractionArrayPath("dividends", index, field), () =>
        fieldRow(
          `income.dividends.${holding.id}.${field}`,
          field === "unfranked"
            ? name("11S")
            : field === "franked"
              ? name("11T")
              : field === "frankingCredits"
                ? name("11U")
                : name("11V"),
          holding[field],
          documentsByDocId,
          { sublabel },
        ),
      );
    });
  });

  pushOrMismatch("income.governmentAllowances", () =>
    fieldRow("income.governmentAllowances", name("5"), model.income.governmentAllowances, documentsByDocId),
  );
  pushOrMismatch("income.reportableFringeBenefits", () =>
    fieldRow("income.reportableFringeBenefits", name("IT1"), model.income.reportableFringeBenefits, documentsByDocId),
  );
  pushOrMismatch("income.reportableEmployerSuper", () =>
    fieldRow("income.reportableEmployerSuper", name("IT2"), model.income.reportableEmployerSuper, documentsByDocId),
  );

  const confirmable = rows.filter(rowCounts);
  return {
    id: "income",
    title: "Income",
    rows,
    confirmedCount: confirmable.filter(rowIsSettled).length,
    totalCount: confirmable.length,
  };
}

function buildDeductionsSection(
  model: ReturnModel,
  documentsByDocId: Readonly<Record<string, string>>,
  pendingByPath: ReadonlyMap<string, PendingReconciliation>,
): ReviewSection {
  const rows: ReviewRow[] = [];
  const taxonomy = getTaxonomy(model.targetYear);
  const name = (code: string) => taxonomy.labels.find((l) => l.code === code)?.name ?? code;
  const d = model.deductions;

  const pushDeduction = (
    extractionPath: string,
    path: string,
    label: string,
    field: Provenanced<number>,
    opts: { sublabel?: string; unsubstantiated?: boolean } = {},
  ) => {
    const pending = pendingByPath.get(extractionPath);
    if (pending) {
      rows.push(describeMismatch(model, pending, documentsByDocId));
    } else {
      rows.push(fieldRow(path, label, field, documentsByDocId, opts));
    }
  };

  pushDeduction("deductions.workRelatedCar.amount", "deductions.workRelatedCar.amount", name("D1"), d.workRelatedCar.amount, {
    sublabel:
      d.workRelatedCar.businessKilometres.value != null && d.workRelatedCar.ratePerKm.value != null
        ? `${d.workRelatedCar.businessKilometres.value} km × $${d.workRelatedCar.ratePerKm.value}/km`
        : undefined,
    unsubstantiated: d.workRelatedCar.unsubstantiated,
  });
  pushDeduction(
    "deductions.workRelatedTravel.amount",
    "deductions.workRelatedTravel.amount",
    name("D2"),
    d.workRelatedTravel.amount,
    { unsubstantiated: d.workRelatedTravel.unsubstantiated },
  );
  pushDeduction(
    "deductions.workRelatedClothing.amount",
    "deductions.workRelatedClothing.amount",
    name("D3"),
    d.workRelatedClothing.amount,
    { unsubstantiated: d.workRelatedClothing.unsubstantiated },
  );
  pushDeduction("deductions.selfEducation.amount", "deductions.selfEducation.amount", name("D4"), d.selfEducation.amount, {
    unsubstantiated: d.selfEducation.unsubstantiated,
  });
  pushDeduction(
    "deductions.otherWorkRelated.amount",
    "deductions.otherWorkRelated.amount",
    "Other work-related expenses",
    d.otherWorkRelated.amount,
    { unsubstantiated: d.otherWorkRelated.unsubstantiated },
  );
  pushDeduction(
    "deductions.workFromHome.amount",
    "deductions.workFromHome.amount",
    "Working from home — fixed rate",
    d.workFromHome.amount,
    {
      sublabel: d.workFromHome.hours.value != null ? `${d.workFromHome.hours.value} hours worked from home` : undefined,
      unsubstantiated: d.workFromHome.unsubstantiated,
    },
  );
  pushDeduction(
    "deductions.giftsAndDonations.amount",
    "deductions.giftsAndDonations.amount",
    name("D9"),
    d.giftsAndDonations.amount,
    { unsubstantiated: d.giftsAndDonations.unsubstantiated },
  );
  pushDeduction(
    "deductions.costOfManagingTaxAffairs.amount",
    "deductions.costOfManagingTaxAffairs.amount",
    name("D10"),
    d.costOfManagingTaxAffairs.amount,
    { unsubstantiated: d.costOfManagingTaxAffairs.unsubstantiated },
  );

  // A mismatch that isn't on one of the closed-vocabulary review paths above
  // (currently only `deductions.workFromHome.hours`) still needs a row.
  const hoursPending = pendingByPath.get("deductions.workFromHome.hours");
  if (hoursPending) rows.push(describeMismatch(model, hoursPending, documentsByDocId));

  const confirmable = rows.filter(rowCounts);
  return {
    id: "deductions",
    title: "Deductions",
    rows,
    confirmedCount: confirmable.filter(rowIsSettled).length,
    totalCount: confirmable.length,
  };
}

function buildRentalSection(
  model: ReturnModel,
  documentsByDocId: Readonly<Record<string, string>>,
): ReviewSection | null {
  if (!model.rental.present) return null;
  const rental = model.rental;
  const taxonomy = getTaxonomy(model.targetYear);
  const scheduleName = (key: string) => taxonomy.rentalSchedule.find((l) => l.key === key)?.name ?? key;
  const rows: ReviewRow[] = [];

  rows.push(fieldRow("rental.grossRent", scheduleName("grossRent"), rental.grossRent, documentsByDocId));
  rows.push(
    fieldRow("rental.otherRentalIncome", scheduleName("otherRentalIncome"), rental.otherRentalIncome, documentsByDocId),
  );

  const otherKeys = RENTAL_EXPENSE_KEYS.filter((k) => k !== "repairsAndMaintenance");
  for (const key of otherKeys) {
    rows.push(
      fieldRow(
        `rental.expenses.${key}.amount`,
        scheduleName(key),
        rental.expenses[key].amount,
        documentsByDocId,
      ),
    );
  }

  const repairsLine = rental.expenses.repairsAndMaintenance;
  if (needsRepairsConfirmation(rental)) {
    rows.push({
      kind: "repairs-gate",
      displayValue: formatMoney(repairsLine.amount.value),
      sublabel: `Over ${formatMoney(RENTAL_REPAIRS_CONFIRMATION_THRESHOLD)} — confirm this is a repair, not a capital improvement`,
      source: describeOrigin(repairsLine.amount.origin, documentsByDocId),
    });
  } else {
    rows.push(
      fieldRow(
        "rental.expenses.repairsAndMaintenance.amount",
        scheduleName("repairsAndMaintenance"),
        repairsLine.amount,
        documentsByDocId,
      ),
    );
  }

  const totalDeductions = RENTAL_EXPENSE_KEYS.reduce((sum, key) => sum + (rental.expenses[key].amount.value ?? 0), 0);
  const grossIncome = (rental.grossRent.value ?? 0) + (rental.otherRentalIncome.value ?? 0);
  const net = rental.netRentalResult.value;
  rows.push({
    kind: "computed",
    label: scheduleName("netRent"),
    sublabel: `${formatMoney(grossIncome)} rent − ${formatMoney(totalDeductions)} expenses${net != null && net < 0 ? " — a loss, so it lowers taxable income" : ""}`,
    displayValue: formatMoney(net),
  });

  const confirmable = rows.filter(rowCounts);
  return {
    id: "rental",
    title: "Rental property",
    rows,
    confirmedCount: confirmable.filter(rowIsSettled).length,
    totalCount: confirmable.length,
  };
}

function buildOffsetsSection(
  model: ReturnModel,
  documentsByDocId: Readonly<Record<string, string>>,
  pendingByPath: ReadonlyMap<string, PendingReconciliation>,
): ReviewSection {
  const rows: ReviewRow[] = [];
  const p = model.privateHealth;

  rows.push({ kind: "phi-held", held: p.held.value, status: p.held.status });

  const anyPhiTouched = [p.premiumsEligibleForRebate, p.rebateReceived, p.oldestCoveredPersonAge, p.coverDays].some(
    (f) => f.status !== "unset",
  );
  if (p.held.value === true || anyPhiTouched) {
    const pushPhi = (path: string, label: string, field: Provenanced<number>) => {
      const pending = pendingByPath.get(path);
      if (pending) rows.push(describeMismatch(model, pending, documentsByDocId));
      else rows.push(fieldRow(path, label, field, documentsByDocId));
    };
    pushPhi("privateHealth.premiumsEligibleForRebate", "Private health — premiums eligible for rebate", p.premiumsEligibleForRebate);
    pushPhi("privateHealth.rebateReceived", "Private health — rebate received", p.rebateReceived);
    pushPhi("privateHealth.oldestCoveredPersonAge", "Age of oldest person covered (at 30 June)", p.oldestCoveredPersonAge);
    pushPhi("privateHealth.coverDays", "Days of private hospital cover", p.coverDays);
  }

  const confirmable = rows.filter(rowCounts);
  return {
    id: "offsets",
    title: "Offsets & Medicare",
    rows,
    confirmedCount: confirmable.filter(rowIsSettled).length,
    totalCount: confirmable.length,
  };
}

// ---------------------------------------------------------------------------
// Top-level build
// ---------------------------------------------------------------------------

/**
 * Builds every review row plus the progress/gate state for `model` (PRD FR-7,
 * FR-24). `documentsByDocId` maps every uploaded document's `docId` to its
 * filename, for the source chips.
 */
export function buildReviewData(
  model: ReturnModel,
  pendingReconciliation: readonly PendingReconciliation[],
  documentsByDocId: Readonly<Record<string, string>>,
): ReviewData {
  const pendingByPath = new Map(pendingReconciliation.map((p) => [p.modelPath, p] as const));

  const sections: ReviewSection[] = [
    buildIncomeSection(model, documentsByDocId, pendingByPath),
    buildDeductionsSection(model, documentsByDocId, pendingByPath),
  ];
  const rental = buildRentalSection(model, documentsByDocId);
  if (rental) sections.push(rental);
  sections.push(buildOffsetsSection(model, documentsByDocId, pendingByPath));

  const labels = requiredLabels(model).filter((l) => l.status !== "empty");
  const confirmed = labels.filter((l) => l.satisfied).length;
  const total = labels.length;

  const repairsOutstanding = model.rental.present && needsRepairsConfirmation(model.rental);
  const phiHeldOutstanding = !isSettled(model.privateHealth.held);
  const unresolvedMismatches = pendingReconciliation.length > 0;

  const blockingReasons: string[] = [];
  if (unresolvedMismatches) {
    blockingReasons.push(
      `${pendingReconciliation.length} mismatch${pendingReconciliation.length === 1 ? "" : "es"}`,
    );
  }
  if (confirmed < total) blockingReasons.push(`${total - confirmed} unconfirmed figure${total - confirmed === 1 ? "" : "s"}`);
  if (repairsOutstanding) blockingReasons.push("the flagged rental repairs line");
  if (phiHeldOutstanding) blockingReasons.push("whether you held private health cover");

  const canContinue = confirmed === total && !unresolvedMismatches && !repairsOutstanding && !phiHeldOutstanding;

  return {
    sections,
    progress: { confirmed, total },
    canContinue,
    blockingReasons,
  };
}
