/**
 * Completeness / readiness for the estimate (PRD FR-7, FR-24).
 *
 * {@link requiredLabels} walks every in-scope label the model must fill for the
 * return this model represents (skipping labels that don't apply — no rental, no
 * spouse, no private health) and reports how far each has been reviewed.
 * {@link isReadyForEstimate} is `true` only when every one of those is
 * `confirmed` or `not-applicable`, any over-threshold rental repairs line has
 * been confirmed a genuine repair, and the gap-questionnaire scope gate has been
 * answered.
 */
import { getTaxonomy } from "@aus-tax-lodge/params";

import {
  type ReturnModel,
  RENTAL_EXPENSE_KEYS,
  RENTAL_REPAIRS_CONFIRMATION_THRESHOLD,
} from "./model";
import type { FieldStatus, Provenanced } from "./provenance";

/** Aggregate review state of one label (which may map to several fields). */
export type LabelAggregateStatus = FieldStatus | "mixed" | "empty";

export interface LabelCompleteness {
  /** Taxonomy label code (e.g. `"1"`, `"D5"`, `"21"`) or a synthetic key (`"q.*"`, `"rental.*"`, `"context.*"`). */
  readonly code: string;
  /** Human-readable name — from the taxonomy where there is a label, else a short phrase. */
  readonly name: string;
  readonly status: LabelAggregateStatus;
  /** `true` when every underlying field is `confirmed` or `not-applicable` (or the label is a nil/empty list). */
  readonly satisfied: boolean;
}

function num(field: Provenanced<number>): number {
  return field.value ?? 0;
}

function aggregate(fields: readonly Provenanced<unknown>[]): {
  status: LabelAggregateStatus;
  satisfied: boolean;
} {
  if (fields.length === 0) return { status: "empty", satisfied: true };
  const statuses = new Set<FieldStatus>(fields.map((f) => f.status));
  const satisfied = fields.every((f) => f.status === "confirmed" || f.status === "not-applicable");
  const status: LabelAggregateStatus = statuses.size === 1 ? [...statuses][0]! : "mixed";
  return { status, satisfied };
}

/**
 * Fields backing a taxonomy label. `null` means "this label does not apply to
 * this return" (omit the row); `[]` means "applies but nothing entered" — which
 * a return is allowed to leave nil.
 */
type LabelBinding = (m: ReturnModel) => readonly Provenanced<unknown>[] | null;

const LABEL_BINDINGS: Readonly<Record<string, LabelBinding>> = {
  "personalise.residency": (m) => [m.context.residency],
  "personalise.spouse": (m) => [m.context.spouse.status],

  "1": (m) => m.income.salaryWages.map((e) => e.grossSalaryWages),
  "1.taxWithheld": (m) => m.income.salaryWages.map((e) => e.paygWithheld),
  "5": (m) => [m.income.governmentAllowances],
  "10L": (m) =>
    m.income.interestAccounts.flatMap((a) => [a.grossInterest, a.ownershipSharePercent]),
  "10M": (m) => m.income.interestAccounts.map((a) => a.tfnAmountsWithheld),
  "11S": (m) => m.income.dividends.map((holding) => holding.unfranked),
  "11T": (m) => m.income.dividends.map((holding) => holding.franked),
  "11U": (m) => m.income.dividends.map((holding) => holding.frankingCredits),
  "11V": (m) => m.income.dividends.map((holding) => holding.tfnAmountsWithheld),
  "21": (m) =>
    m.rental.present
      ? [
          m.rental.grossRent,
          m.rental.otherRentalIncome,
          ...RENTAL_EXPENSE_KEYS.map((k) => m.rental.expenses[k].amount),
        ]
      : null,

  D1: (m) => [m.deductions.workRelatedCar.amount],
  D2: (m) => [m.deductions.workRelatedTravel.amount],
  D3: (m) => [m.deductions.workRelatedClothing.amount],
  D4: (m) => [m.deductions.selfEducation.amount],
  D5: (m) => [m.deductions.otherWorkRelated.amount, m.deductions.workFromHome.amount],
  D9: (m) => [m.deductions.giftsAndDonations.amount],
  D10: (m) => [m.deductions.costOfManagingTaxAffairs.amount],

  IT1: (m) => [m.income.reportableFringeBenefits],
  IT2: (m) => [m.income.reportableEmployerSuper],
  IT8: (m) => [m.context.dependentChildren],

  "phi.policyDetails": (m) =>
    m.privateHealth.held.value === true
      ? [
          m.privateHealth.premiumsEligibleForRebate,
          m.privateHealth.rebateReceived,
          m.privateHealth.oldestCoveredPersonAge,
          m.privateHealth.coverDays,
        ]
      : null,
  "spouse.details": (m) =>
    m.context.spouse.status.value === "had-spouse"
      ? [
          m.context.spouse.name,
          m.context.spouse.dateOfBirth,
          m.context.spouse.estimatedTaxableIncome,
          m.context.spouse.privateHospitalCoverDays,
        ]
      : null,
};

/** Synthetic rows for facts the estimate needs that don't sit on a single ATO label. */
function syntheticRows(model: ReturnModel): LabelCompleteness[] {
  const rows: LabelCompleteness[] = [];

  const add = (code: string, name: string, fields: readonly Provenanced<unknown>[]): void => {
    const { status, satisfied } = aggregate(fields);
    rows.push({ code, name, status, satisfied });
  };

  add("context.studyLoan", "Holds a study/training support loan", [model.context.holdsStudyLoan]);
  add("context.privateCoverDays", "Days with private hospital cover", [
    model.context.privateHospitalCoverDays,
  ]);

  add("q.residencyFullYear", "Questionnaire — resident for the full year", [
    model.questionnaire.residencyFullYear,
  ]);
  add("q.jointAccountShares", "Questionnaire — joint-account ownership shares", [
    model.questionnaire.jointAccountSharesProvided,
  ]);
  add("q.studyLoanHeld", "Questionnaire — study loan held", [model.questionnaire.studyLoanHeld]);
  add("q.privateCoverDates", "Questionnaire — private-cover dates confirmed", [
    model.questionnaire.privateCoverDatesConfirmed,
  ]);
  add("q.wfhDoubleClaim", "Questionnaire — WFH hours not double-claimed", [
    model.questionnaire.wfhHoursNotDoubleClaimed,
  ]);

  if (model.rental.present) {
    add("q.rentalScopeGate", "Questionnaire — rental scope gate", [
      model.questionnaire.rentalScopeGate,
    ]);

    const repairs = num(model.rental.expenses.repairsAndMaintenance.amount);
    const needsRepairConfirm = repairs > RENTAL_REPAIRS_CONFIRMATION_THRESHOLD;
    rows.push({
      code: "rental.repairsConfirmed",
      name: "Rental repairs confirmed a genuine repair, not capital",
      status: needsRepairConfirm
        ? model.rental.repairsConfirmedNotCapital
          ? "confirmed"
          : "unset"
        : "not-applicable",
      satisfied: !needsRepairConfirm || model.rental.repairsConfirmedNotCapital,
    });
  }

  return rows;
}

/**
 * Every in-scope label this return must confirm before the estimate, with its
 * current review state. Labels that don't apply to the return (no rental, no
 * spouse, no private health) are omitted.
 */
export function requiredLabels(model: ReturnModel): LabelCompleteness[] {
  const taxonomy = getTaxonomy(model.targetYear);
  const nameByCode = new Map(taxonomy.labels.map((l) => [l.code, l.name]));

  const rows: LabelCompleteness[] = [];
  for (const label of taxonomy.labels) {
    if (!label.inScope) continue;
    const binding = LABEL_BINDINGS[label.code];
    if (!binding) continue;
    const fields = binding(model);
    if (fields === null) continue;
    const { status, satisfied } = aggregate(fields);
    rows.push({
      code: label.code,
      name: nameByCode.get(label.code) ?? label.code,
      status,
      satisfied,
    });
  }

  rows.push(...syntheticRows(model));
  return rows;
}

/**
 * `true` when every row from {@link requiredLabels} is satisfied — i.e. every
 * in-scope label is `confirmed` or `not-applicable`, an over-threshold rental
 * repairs line has been confirmed a genuine repair, and the scope gate is
 * answered (PRD FR-7, FR-24).
 */
export function isReadyForEstimate(model: ReturnModel): boolean {
  return requiredLabels(model).every((row) => row.satisfied);
}
