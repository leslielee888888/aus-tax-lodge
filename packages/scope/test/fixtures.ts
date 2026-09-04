/** Minimal return-model builders for the scope suite. */
import {
  answer,
  confirm,
  createEmptyReturnModel,
  propose,
  type Provenanced,
  type RentalScopeGateAnswer,
  type ReturnModel,
  unsetField,
} from "@aus-tax-lodge/model";

export type ResidencyStatus = NonNullable<ReturnModel["context"]["residency"]["value"]>;

export function conf<T>(value: T): Provenanced<T> {
  return confirm(propose(unsetField<T>(), value, { kind: "computed", from: "test" }));
}

/**
 * A clean return: full-year resident, salary only, no rental. `detectOutOfScope`
 * should return `[]`.
 */
export function cleanSalaryReturn(): ReturnModel {
  const base = createEmptyReturnModel();
  return {
    ...base,
    context: { ...base.context, residency: conf<ResidencyStatus>("resident-full-year") },
    questionnaire: {
      ...base.questionnaire,
      residencyFullYear: answer(unsetField<boolean>(), true),
    },
  };
}

/**
 * A clean return with one compliant rental — solely owned, available all year,
 * no private use, not bought or sold. Still in scope (FR-24).
 */
export function cleanRentalReturn(): ReturnModel {
  const base = cleanSalaryReturn();
  return {
    ...base,
    rental: {
      ...base.rental,
      present: true,
      soleOwnership: conf(true),
      rentedOrAvailableAllYear: conf(true),
      noPrivateUse: conf(true),
    },
    questionnaire: {
      ...base.questionnaire,
      rentalScopeGate: answer<RentalScopeGateAnswer>(unsetField<RentalScopeGateAnswer>(), {
        solelyOwned: true,
        rentedOrAvailableAllYear: true,
        noPrivateUse: true,
        notBoughtOrSoldThisYear: true,
      }),
    },
  };
}

/** Set the rental scope gate answer on a return (marks the rental present). */
export function withRentalScopeGate(model: ReturnModel, gate: RentalScopeGateAnswer): ReturnModel {
  return {
    ...model,
    rental: { ...model.rental, present: true },
    questionnaire: {
      ...model.questionnaire,
      rentalScopeGate: answer<RentalScopeGateAnswer>(unsetField<RentalScopeGateAnswer>(), gate),
    },
  };
}
