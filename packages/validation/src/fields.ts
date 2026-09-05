/**
 * Every {@link Provenanced} field on a {@link ReturnModel} that is actually
 * *in scope* for this particular return, with a dot-path name (PRD FR-13 —
 * "no unconfirmed fields left"). Fields that don't apply to this return
 * (spouse details with no spouse, the rental schedule with no rental, PHI
 * detail with no cover) are omitted, mirroring the gating
 * `@aus-tax-lodge/model`'s {@link import("@aus-tax-lodge/model").requiredLabels}
 * already applies at the label level — this is the same idea at field
 * granularity, which is why it is a distinct, more granular check from the
 * mandatory-labels one in {@link import("./validate").validateReturn}.
 *
 * Kept as an explicit enumeration (rather than a generic reflect-and-guess
 * walk, see {@link import("./walk").walkProvenancedFields}) because "in scope"
 * here depends on sibling values (e.g. `context.spouse.status`), which a
 * structural walk can't infer safely.
 */
import { RENTAL_EXPENSE_KEYS, type Provenanced, type ReturnModel } from "@aus-tax-lodge/model";

/** One in-scope field and the dot-path naming it, for the "unconfirmed field" issues. */
export interface InScopeField {
  readonly path: string;
  readonly field: Provenanced<unknown>;
}

const SUBSTANTIATED_DEDUCTION_KEYS = [
  "workRelatedTravel",
  "workRelatedClothing",
  "selfEducation",
  "otherWorkRelated",
  "giftsAndDonations",
  "costOfManagingTaxAffairs",
] as const;

/** Every field this return must confirm (or mark nil/not-applicable) before export. */
export function collectInScopeFields(model: ReturnModel): InScopeField[] {
  const rows: InScopeField[] = [];
  const push = (path: string, field: Provenanced<unknown>): void => {
    rows.push({ path, field });
  };

  // --- Taxpayer (PRD FR-1) -------------------------------------------------
  push("taxpayer.fullName", model.taxpayer.fullName);
  push("taxpayer.dateOfBirth", model.taxpayer.dateOfBirth);
  push("taxpayer.postalAddress", model.taxpayer.postalAddress);
  push("taxpayer.taxFileNumber", model.taxpayer.taxFileNumber);
  push("taxpayer.refundAccount", model.taxpayer.refundAccount);

  // --- Context (PRD FR-1) ---------------------------------------------------
  push("context.residency", model.context.residency);
  push("context.spouse.status", model.context.spouse.status);
  if (model.context.spouse.status.value === "had-spouse") {
    push("context.spouse.name", model.context.spouse.name);
    push("context.spouse.dateOfBirth", model.context.spouse.dateOfBirth);
    push("context.spouse.estimatedTaxableIncome", model.context.spouse.estimatedTaxableIncome);
    push(
      "context.spouse.privateHospitalCoverDays",
      model.context.spouse.privateHospitalCoverDays,
    );
  }
  push("context.holdsStudyLoan", model.context.holdsStudyLoan);
  push("context.privateHospitalCoverDays", model.context.privateHospitalCoverDays);
  push("context.dependentChildren", model.context.dependentChildren);

  // --- Income (PRD FR-4) -----------------------------------------------------
  model.income.salaryWages.forEach((employer, i) => {
    push(`income.salaryWages[${i}].payerName`, employer.payerName);
    push(`income.salaryWages[${i}].payerAbn`, employer.payerAbn);
    push(`income.salaryWages[${i}].grossSalaryWages`, employer.grossSalaryWages);
    push(`income.salaryWages[${i}].paygWithheld`, employer.paygWithheld);
  });
  model.income.interestAccounts.forEach((account, i) => {
    push(`income.interestAccounts[${i}].institution`, account.institution);
    push(`income.interestAccounts[${i}].accountDescription`, account.accountDescription);
    push(`income.interestAccounts[${i}].grossInterest`, account.grossInterest);
    push(`income.interestAccounts[${i}].tfnAmountsWithheld`, account.tfnAmountsWithheld);
    push(`income.interestAccounts[${i}].ownershipSharePercent`, account.ownershipSharePercent);
  });
  model.income.dividends.forEach((holding, i) => {
    push(`income.dividends[${i}].company`, holding.company);
    push(`income.dividends[${i}].unfranked`, holding.unfranked);
    push(`income.dividends[${i}].franked`, holding.franked);
    push(`income.dividends[${i}].frankingCredits`, holding.frankingCredits);
    push(`income.dividends[${i}].tfnAmountsWithheld`, holding.tfnAmountsWithheld);
  });
  push("income.governmentAllowances", model.income.governmentAllowances);
  push("income.reportableFringeBenefits", model.income.reportableFringeBenefits);
  push("income.reportableEmployerSuper", model.income.reportableEmployerSuper);

  // --- Deductions (PRD FR-5) -------------------------------------------------
  const d = model.deductions;
  push("deductions.workRelatedCar.businessKilometres", d.workRelatedCar.businessKilometres);
  push("deductions.workRelatedCar.ratePerKm", d.workRelatedCar.ratePerKm);
  push("deductions.workRelatedCar.amount", d.workRelatedCar.amount);
  push("deductions.workRelatedCar.substantiationRef", d.workRelatedCar.substantiationRef);
  for (const key of SUBSTANTIATED_DEDUCTION_KEYS) {
    push(`deductions.${key}.amount`, d[key].amount);
    push(`deductions.${key}.substantiationRef`, d[key].substantiationRef);
  }
  push("deductions.workFromHome.hours", d.workFromHome.hours);
  push("deductions.workFromHome.ratePerHour", d.workFromHome.ratePerHour);
  push("deductions.workFromHome.amount", d.workFromHome.amount);
  push("deductions.workFromHome.substantiationRef", d.workFromHome.substantiationRef);

  // --- Rental schedule (PRD FR-24), only when present -------------------------
  if (model.rental.present) {
    const r = model.rental;
    push("rental.property.addressLine1", r.property.addressLine1);
    push("rental.property.suburb", r.property.suburb);
    push("rental.property.state", r.property.state);
    push("rental.property.postcode", r.property.postcode);
    push("rental.property.firstEarnedIncomeOn", r.property.firstEarnedIncomeOn);
    push("rental.soleOwnership", r.soleOwnership);
    push("rental.rentedOrAvailableAllYear", r.rentedOrAvailableAllYear);
    push("rental.noPrivateUse", r.noPrivateUse);
    push("rental.grossRent", r.grossRent);
    push("rental.otherRentalIncome", r.otherRentalIncome);
    for (const key of RENTAL_EXPENSE_KEYS) {
      push(`rental.expenses.${key}.amount`, r.expenses[key].amount);
    }
    // `rental.netRentalResult` is deliberately excluded: it is always a
    // computed roll-up (`recomputeNetRentalResult` stamps it `proposed`,
    // never `confirmed`) that the engine input re-derives from the expense
    // lines rather than reading directly (PRD FR-24) — it is never something
    // the user confirms.
    push("questionnaire.rentalScopeGate", model.questionnaire.rentalScopeGate);
  }

  // --- Private health (PRD FR-11) ---------------------------------------------
  push("privateHealth.held", model.privateHealth.held);
  if (model.privateHealth.held.value === true) {
    push("privateHealth.premiumsEligibleForRebate", model.privateHealth.premiumsEligibleForRebate);
    push("privateHealth.rebateReceived", model.privateHealth.rebateReceived);
    push("privateHealth.oldestCoveredPersonAge", model.privateHealth.oldestCoveredPersonAge);
    push("privateHealth.coverDays", model.privateHealth.coverDays);
  }

  // --- Gap questionnaire (PRD FR-6), non-rental questions ----------------------
  push("questionnaire.residencyFullYear", model.questionnaire.residencyFullYear);
  push("questionnaire.jointAccountSharesProvided", model.questionnaire.jointAccountSharesProvided);
  push("questionnaire.studyLoanHeld", model.questionnaire.studyLoanHeld);
  push("questionnaire.privateCoverDatesConfirmed", model.questionnaire.privateCoverDatesConfirmed);
  push("questionnaire.wfhHoursNotDoubleClaimed", model.questionnaire.wfhHoursNotDoubleClaimed);

  return rows;
}
