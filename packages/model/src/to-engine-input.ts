/**
 * Return model → engine contract (PRD FR-4, FR-8).
 *
 * Maps the **confirmed** figures on a {@link ReturnModel} to the single
 * consolidated {@link EngineInput} the deterministic engine
 * (`@aus-tax-lodge/engine`) reads: salary summed across employers, joint
 * interest apportioned by ownership share, dividends summed, the deduction
 * labels summed into one total, the net rental result taken from the schedule
 * (0 with no rental), and private health / spouse / dependent-children wired
 * through.
 *
 * A figure that is still `unset` or only `proposed` is **not** trusted — every
 * such required field is collected and a {@link MissingFiguresError} is thrown
 * listing them (PRD FR-7 — nothing feeds the maths until the user confirms it).
 */
import type { EngineInput, EnginePrivateHealthInput, ResidencyStatus } from "@aus-tax-lodge/engine";

import type { ReturnModel } from "./model";
import { RENTAL_EXPENSE_KEYS } from "./model";
import type { Provenanced } from "./provenance";
import { isSettled } from "./provenance";

/** Thrown by {@link toEngineInput} when a required figure has not been confirmed. */
export class MissingFiguresError extends Error {
  /** Dot-paths of the fields that are neither `confirmed` nor `not-applicable`. */
  readonly fields: readonly string[];

  constructor(fields: readonly string[]) {
    super(
      `Cannot build the engine input — ${fields.length} required figure(s) are not confirmed:\n` +
        fields.map((f) => `  • ${f}`).join("\n"),
    );
    this.name = "MissingFiguresError";
    this.fields = fields;
  }
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

class Reader {
  readonly missing: string[] = [];

  /** Require the field settled; return its value (or `null`). */
  require<T>(field: Provenanced<T>, path: string): T | null {
    if (!isSettled(field)) this.missing.push(path);
    return field.value;
  }

  /** Require a numeric field settled; return its value (0 when nil). */
  num(field: Provenanced<number>, path: string): number {
    this.require(field, path);
    return field.value ?? 0;
  }
}

/**
 * Build the {@link EngineInput} from a return model.
 *
 * @throws {MissingFiguresError} if any required figure is still `unset`/`proposed`.
 */
export function toEngineInput(model: ReturnModel): EngineInput {
  const r = new Reader();

  // --- Income: salary & wages, summed across employers (FR-4) --------------
  let salaryWages = 0;
  let paygWithheld = 0;
  model.income.salaryWages.forEach((employer, i) => {
    salaryWages += r.num(employer.grossSalaryWages, `income.salaryWages[${i}].grossSalaryWages`);
    paygWithheld += r.num(employer.paygWithheld, `income.salaryWages[${i}].paygWithheld`);
  });

  // --- Income: gross interest, apportioned by ownership share (FR-4) -------
  let grossInterest = 0;
  model.income.interestAccounts.forEach((account, i) => {
    const gross = r.num(account.grossInterest, `income.interestAccounts[${i}].grossInterest`);
    const share = r.num(
      account.ownershipSharePercent,
      `income.interestAccounts[${i}].ownershipSharePercent`,
    );
    grossInterest += gross * (share / 100);
  });
  grossInterest = round2(grossInterest);

  // --- Income: dividends, summed across holdings (FR-4) -------------------
  let unfranked = 0;
  let franked = 0;
  let frankingCredits = 0;
  model.income.dividends.forEach((holding, i) => {
    unfranked += r.num(holding.unfranked, `income.dividends[${i}].unfranked`);
    franked += r.num(holding.franked, `income.dividends[${i}].franked`);
    frankingCredits += r.num(holding.frankingCredits, `income.dividends[${i}].frankingCredits`);
  });

  const governmentAllowances = r.num(
    model.income.governmentAllowances,
    "income.governmentAllowances",
  );
  const reportableFringeBenefits = r.num(
    model.income.reportableFringeBenefits,
    "income.reportableFringeBenefits",
  );
  const reportableEmployerSuper = r.num(
    model.income.reportableEmployerSuper,
    "income.reportableEmployerSuper",
  );

  // --- Deductions: the D-labels summed into one total (FR-5) --------------
  // Rental deductions are NOT included here — they are already netted inside
  // `netRentalResult`, which the engine adds to assessable income separately.
  const d = model.deductions;
  const deductionsTotal = round2(
    r.num(d.workRelatedCar.amount, "deductions.workRelatedCar.amount") +
      r.num(d.workRelatedTravel.amount, "deductions.workRelatedTravel.amount") +
      r.num(d.workRelatedClothing.amount, "deductions.workRelatedClothing.amount") +
      r.num(d.selfEducation.amount, "deductions.selfEducation.amount") +
      r.num(d.otherWorkRelated.amount, "deductions.otherWorkRelated.amount") +
      r.num(d.workFromHome.amount, "deductions.workFromHome.amount") +
      r.num(d.giftsAndDonations.amount, "deductions.giftsAndDonations.amount") +
      r.num(d.costOfManagingTaxAffairs.amount, "deductions.costOfManagingTaxAffairs.amount"),
  );

  // --- Rental: net result from the schedule, 0 with no rental (FR-24) ----
  let netRentalResult = 0;
  if (model.rental.present) {
    const income =
      r.num(model.rental.grossRent, "rental.grossRent") +
      r.num(model.rental.otherRentalIncome, "rental.otherRentalIncome");
    let expenses = 0;
    for (const key of RENTAL_EXPENSE_KEYS) {
      expenses += r.num(model.rental.expenses[key].amount, `rental.expenses.${key}`);
    }
    netRentalResult = round2(income - expenses);
  }

  // --- Private health (FR-11) -------------------------------------------
  let privateHealth: EnginePrivateHealthInput | null = null;
  const held = r.require(model.privateHealth.held, "privateHealth.held");
  if (held === true) {
    privateHealth = {
      premiumsEligibleForRebate: r.num(
        model.privateHealth.premiumsEligibleForRebate,
        "privateHealth.premiumsEligibleForRebate",
      ),
      rebateReceived: r.num(model.privateHealth.rebateReceived, "privateHealth.rebateReceived"),
      oldestCoveredPersonAge: r.num(
        model.privateHealth.oldestCoveredPersonAge,
        "privateHealth.oldestCoveredPersonAge",
      ),
    };
  }

  // --- Context (FR-1) --------------------------------------------------
  const residency: ResidencyStatus =
    r.require(model.context.residency, "context.residency") ?? "resident-full-year";
  const spouseStatus = r.require(model.context.spouse.status, "context.spouse.status");
  const spouseTaxableIncome =
    spouseStatus === "had-spouse"
      ? r.num(model.context.spouse.estimatedTaxableIncome, "context.spouse.estimatedTaxableIncome")
      : null;
  const privateHospitalCoverDays = r.num(
    model.context.privateHospitalCoverDays,
    "context.privateHospitalCoverDays",
  );
  const holdsStudyLoan = r.require(model.context.holdsStudyLoan, "context.holdsStudyLoan") ?? false;
  const dependentChildren = r.num(model.context.dependentChildren, "context.dependentChildren");

  if (r.missing.length > 0) {
    throw new MissingFiguresError(r.missing);
  }

  return {
    income: {
      salaryWages: round2(salaryWages),
      paygWithheld: round2(paygWithheld),
      grossInterest,
      dividends: {
        unfranked: round2(unfranked),
        franked: round2(franked),
        frankingCredits: round2(frankingCredits),
      },
      governmentAllowances: round2(governmentAllowances),
      netRentalResult,
      reportableFringeBenefits: round2(reportableFringeBenefits),
      reportableEmployerSuper: round2(reportableEmployerSuper),
      privateHealth,
    },
    deductions: { total: deductionsTotal },
    context: {
      residency,
      spouseTaxableIncome,
      privateHospitalCoverDays,
      holdsStudyLoan,
      dependentChildren,
    },
  };
}
