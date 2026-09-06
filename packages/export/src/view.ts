/**
 * Resolves a {@link ExportPackageInput} to a single label-keyed {@link ReturnView}
 * (PRD FR-14). The PDF and the JSON both read from this — so a figure on the PDF
 * can never disagree with the same figure in the JSON, and both are pinned to
 * the confirmed model figures and the engine assessment (FR-14 "figures must
 * match").
 */
import {
  apportionedInterest,
  RENTAL_EXPENSE_KEYS,
  totalRentalDeductions,
  totalWorkAndPersonalDeductions,
  type ReturnModel,
} from "@aus-tax-lodge/model";
import type { MyTaxSection } from "@aus-tax-lodge/params";

import { formatDollars, sumToCents } from "./money";
import type {
  ExportPackageInput,
  ReturnView,
  ReturnViewDetailLine,
  ReturnViewLabel,
  ReturnViewRentalSchedule,
  ReturnViewSection,
  ReturnViewTaxpayer,
} from "./types";

const SECTION_TITLES: Readonly<Record<MyTaxSection, string>> = {
  personalise: "Personalise your return",
  income: "Income",
  deductions: "Deductions",
  "tax-losses": "Tax losses",
  "tax-offsets": "Tax offsets",
  adjustments: "Adjustments",
  "medicare-and-phi": "Medicare and private health insurance",
  "spouse-and-income-tests": "Spouse details and income tests",
  estimate: "Estimate",
};

const RESIDENCY_DISPLAY: Readonly<Record<string, string>> = {
  "resident-full-year": "Yes — Australian resident for tax purposes for the full year",
  "non-resident": "No — non-resident (out of scope)",
  "part-year-resident": "No — part-year resident (out of scope)",
};

/** What one binding resolves a label to. `undefined` = the label does not apply to this return. */
interface LabelResolution {
  readonly amount: number | null;
  readonly computed: boolean;
  readonly detail?: readonly ReturnViewDetailLine[];
  readonly note?: string;
  /** Overrides the default `formatDollars(amount)` rendering (counts, yes/no, "Nil"). */
  readonly display?: string;
}

function n(field: { readonly value: number | null }): number {
  return field.value ?? 0;
}

function detailLine(label: string, amount: number | null): ReturnViewDetailLine {
  return { label, amount, display: formatDollars(amount) };
}

type Binding = (input: ExportPackageInput) => LabelResolution | undefined;

function buildBindings(): Readonly<Record<string, Binding>> {
  const salaryTotal = (m: ReturnModel) =>
    sumToCents(m.income.salaryWages.map((e) => e.grossSalaryWages.value));
  const paygTotal = (m: ReturnModel) =>
    sumToCents(m.income.salaryWages.map((e) => e.paygWithheld.value));

  return {
    "personalise.residency": ({ model }) => ({
      amount: null,
      computed: false,
      display:
        RESIDENCY_DISPLAY[model.context.residency.value ?? ""] ?? "Not answered",
    }),
    "personalise.spouse": ({ model }) => ({
      amount: null,
      computed: false,
      display: model.context.spouse.status.value === "had-spouse" ? "Yes" : "No",
    }),

    // --- Income -----------------------------------------------------------
    "1": ({ model }) => ({
      amount: salaryTotal(model),
      computed: false,
      detail: model.income.salaryWages.map((e) =>
        detailLine(
          `${e.payerName.value ?? "Employer"}${e.payerAbn.value ? ` (ABN ${e.payerAbn.value})` : ""}`,
          e.grossSalaryWages.value,
        ),
      ),
    }),
    "1.taxWithheld": ({ model }) => ({
      amount: paygTotal(model),
      computed: false,
      detail: model.income.salaryWages.map((e) =>
        detailLine(e.payerName.value ?? "Employer", e.paygWithheld.value),
      ),
    }),
    "2": () => ({ amount: null, computed: false, display: "Nil" }),
    "5": ({ model }) => ({
      amount: model.income.governmentAllowances.value,
      computed: false,
      display:
        model.income.governmentAllowances.value == null
          ? "Nil"
          : formatDollars(model.income.governmentAllowances.value),
    }),
    "10L": ({ model }) => ({
      amount: sumToCents(model.income.interestAccounts.map((a) => apportionedInterest(a))),
      computed: false,
      detail: model.income.interestAccounts.map((a) =>
        detailLine(
          `${a.institution.value ?? "Account"}${
            a.ownershipSharePercent.value != null && a.ownershipSharePercent.value < 100
              ? ` — your ${a.ownershipSharePercent.value}% share`
              : ""
          }`,
          apportionedInterest(a),
        ),
      ),
    }),
    "10M": ({ model }) => ({
      amount: sumToCents(model.income.interestAccounts.map((a) => a.tfnAmountsWithheld.value)),
      computed: false,
    }),
    "11S": ({ model }) => ({
      amount: sumToCents(model.income.dividends.map((d) => d.unfranked.value)),
      computed: false,
      detail: model.income.dividends.map((d) =>
        detailLine(d.company.value ?? "Holding", d.unfranked.value),
      ),
    }),
    "11T": ({ model }) => ({
      amount: sumToCents(model.income.dividends.map((d) => d.franked.value)),
      computed: false,
      detail: model.income.dividends.map((d) =>
        detailLine(d.company.value ?? "Holding", d.franked.value),
      ),
    }),
    "11U": ({ model }) => ({
      amount: sumToCents(model.income.dividends.map((d) => d.frankingCredits.value)),
      computed: false,
      detail: model.income.dividends.map((d) =>
        detailLine(d.company.value ?? "Holding", d.frankingCredits.value),
      ),
    }),
    "11V": ({ model }) => ({
      amount: sumToCents(model.income.dividends.map((d) => d.tfnAmountsWithheld.value)),
      computed: false,
    }),
    "21": ({ model, assessment }) => {
      if (!model.rental.present) return undefined;
      const net = assessment.assessableIncome.netRental;
      return {
        amount: net,
        computed: true,
        note: net < 0 ? "net rental loss" : undefined,
        detail: [
          detailLine("Gross rent + other rental income", rentalGrossIncome(model)),
          detailLine("less Total rental deductions", -totalRentalDeductions(model.rental)),
        ],
      };
    },

    // --- Deductions ------------------------------------------------------
    D1: ({ model }) => {
      const car = model.deductions.workRelatedCar;
      return {
        amount: car.amount.value,
        computed: false,
        display: car.amount.value == null ? "Nil" : formatDollars(car.amount.value),
        detail:
          car.businessKilometres.value != null && car.ratePerKm.value != null
            ? [
                {
                  label: `${car.businessKilometres.value} business km × $${car.ratePerKm.value}/km (cents-per-km method)`,
                  amount: null,
                  display: "",
                },
              ]
            : undefined,
      };
    },
    D2: ({ model }) => amountLabel(model.deductions.workRelatedTravel.amount.value),
    D3: ({ model }) => amountLabel(model.deductions.workRelatedClothing.amount.value),
    D4: ({ model }) => amountLabel(model.deductions.selfEducation.amount.value),
    D5: ({ model }) => {
      const other = model.deductions.otherWorkRelated.amount.value;
      const wfh = model.deductions.workFromHome.amount.value;
      const total = sumToCents([other, wfh]);
      const detail: ReturnViewDetailLine[] = [];
      if (other != null) detail.push(detailLine("Other work-related expenses", other));
      if (wfh != null) {
        const hours = model.deductions.workFromHome.hours.value;
        detail.push(
          detailLine(
            `Working from home (fixed rate${hours != null ? `, ${hours} hours` : ""})`,
            wfh,
          ),
        );
      }
      return {
        amount: other == null && wfh == null ? null : total,
        computed: false,
        display: other == null && wfh == null ? "Nil" : formatDollars(total),
        detail: detail.length > 0 ? detail : undefined,
      };
    },
    D9: ({ model }) => amountLabel(model.deductions.giftsAndDonations.amount.value),
    D10: ({ model }) => amountLabel(model.deductions.costOfManagingTaxAffairs.amount.value),
    "D.total": ({ model }) => ({
      amount: totalWorkAndPersonalDeductions(model.deductions),
      computed: true,
      note: "sum of D1–D10",
    }),

    // --- Tax offsets ---------------------------------------------------
    "offset.lito": ({ assessment }) => ({
      amount: assessment.lowIncomeTaxOffset,
      computed: true,
      note: "non-refundable — calculated by the ATO",
    }),
    "offset.beneficiary": ({ assessment }) => ({
      amount: assessment.beneficiaryTaxOffset,
      computed: true,
      note: "non-refundable",
    }),
    "offset.frankingCredits": ({ assessment }) => ({
      amount: assessment.frankingCreditOffset,
      computed: true,
      note: "refundable — from item 11 label U",
    }),
    "offset.phiRebate": ({ assessment }) => {
      const phi = assessment.privateHealthRebateReconciliation;
      if (!phi) return undefined;
      return {
        amount: phi.adjustment,
        computed: true,
        note:
          phi.adjustment > 0
            ? "refundable top-up"
            : phi.adjustment < 0
              ? "excess rebate to repay"
              : "reconciled — no adjustment",
      };
    },

    // --- Medicare & PHI ----------------------------------------------
    M1: ({ assessment }) => ({
      amount: assessment.medicareLevy,
      computed: true,
      note: "Medicare levy payable — calculated by the ATO",
    }),
    M2: ({ assessment }) => ({
      amount: assessment.medicareLevySurcharge,
      computed: true,
      note:
        assessment.medicareLevySurcharge === 0
          ? "nil — adequate cover, or below the surcharge threshold"
          : "for the days without adequate private hospital cover",
    }),
    "phi.policyDetails": ({ model }) => {
      const phi = model.privateHealth;
      if (phi.held.value !== true) return undefined;
      return {
        amount: null,
        computed: false,
        display: "See detail",
        detail: [
          detailLine("Premiums eligible for the Australian Government rebate", phi.premiumsEligibleForRebate.value),
          detailLine("Rebate received (reduced premium or paid direct)", phi.rebateReceived.value),
          {
            label: `Age of oldest person covered (at 30 June): ${phi.oldestCoveredPersonAge.value ?? "—"}`,
            amount: null,
            display: "",
          },
          {
            label: `Days of hospital cover: ${phi.coverDays.value ?? "—"}`,
            amount: null,
            display: "",
          },
        ],
      };
    },

    // --- Spouse & income tests -------------------------------------
    "spouse.details": ({ model }) => {
      const s = model.context.spouse;
      if (s.status.value !== "had-spouse") return undefined;
      return {
        amount: null,
        computed: false,
        display: "See detail",
        note: "spouse taxable income is an estimate you entered",
        detail: [
          { label: `Name: ${s.name.value ?? "—"}`, amount: null, display: "" },
          { label: `Date of birth: ${s.dateOfBirth.value ?? "—"}`, amount: null, display: "" },
          detailLine("Estimated taxable income (estimated)", s.estimatedTaxableIncome.value),
          {
            label: `Days with private hospital cover: ${s.privateHospitalCoverDays.value ?? "—"}`,
            amount: null,
            display: "",
          },
        ],
      };
    },
    IT1: ({ model }) => amountLabel(model.income.reportableFringeBenefits.value),
    IT2: ({ model }) => amountLabel(model.income.reportableEmployerSuper.value),
    IT3: () => ({ amount: null, computed: false, display: "Nil" }),
    IT5: () => ({ amount: 0, computed: false, note: "treated as nil for this tool's scope" }),
    IT6: ({ model, assessment }) => ({
      amount: model.rental.present ? Math.max(0, -assessment.assessableIncome.netRental) : 0,
      computed: true,
      note: "net rental loss added back for the income tests (FR-23)",
    }),
    IT7: () => ({ amount: null, computed: false, display: "Nil" }),
    IT8: ({ model }) => ({
      amount: null,
      computed: false,
      display: String(model.context.dependentChildren.value ?? 0),
    }),

    // --- Estimate ------------------------------------------------------
    "estimate.totalTaxWithheld": ({ model, assessment }) => {
      const interestTfn = sumToCents(model.income.interestAccounts.map((a) => a.tfnAmountsWithheld.value));
      const dividendTfn = sumToCents(model.income.dividends.map((d) => d.tfnAmountsWithheld.value));
      return {
        amount: sumToCents([assessment.paygWithheldCredit, interestTfn, dividendTfn]),
        computed: true,
        note: "PAYG withheld + TFN amounts withheld",
      };
    },
    "estimate.result": ({ assessment }) => {
      const { outcome } = assessment;
      const signed = outcome.kind === "refund" ? outcome.amount : -outcome.amount;
      return {
        amount: signed,
        computed: true,
        display: `${formatDollars(outcome.amount)} ${outcome.kind === "refund" ? "estimated refund" : "estimated amount owing"}`,
        note: "an estimate — not the ATO's assessment",
      };
    },
  };
}

function amountLabel(value: number | null): LabelResolution {
  return {
    amount: value,
    computed: false,
    display: value == null ? "Nil" : formatDollars(value),
  };
}

function rentalGrossIncome(model: ReturnModel): number {
  return sumToCents([model.rental.grossRent.value, model.rental.otherRentalIncome.value]);
}

function addressOf(model: ReturnModel): string | null {
  const a = model.taxpayer.postalAddress.value;
  if (!a) return null;
  return [a.line1, a.line2, `${a.suburb} ${a.state} ${a.postcode}`, a.country]
    .filter((part) => part && part.trim().length > 0)
    .join(", ");
}

function buildTaxpayer(model: ReturnModel): ReturnViewTaxpayer {
  const s = model.context.spouse;
  const refund = model.taxpayer.refundAccount.value;
  return {
    fullName: model.taxpayer.fullName.value,
    dateOfBirth: model.taxpayer.dateOfBirth.value,
    address: addressOf(model),
    taxFileNumber: model.taxpayer.taxFileNumber.value,
    refundBsb: refund?.bsb ?? null,
    refundAccountNumber: refund?.accountNumber ?? null,
    refundAccountName: refund?.accountName ?? null,
    residency: model.context.residency.value,
    spouse: {
      hasSpouse: s.status.value === "had-spouse",
      name: s.name.value,
      dateOfBirth: s.dateOfBirth.value,
      estimatedTaxableIncome: s.estimatedTaxableIncome.value,
      privateHospitalCoverDays: s.privateHospitalCoverDays.value,
    },
    holdsStudyLoan: model.context.holdsStudyLoan.value,
    privateHospitalCoverDays: model.context.privateHospitalCoverDays.value,
  };
}

function buildRentalSchedule(input: ExportPackageInput): ReturnViewRentalSchedule | null {
  const { model, taxonomy } = input;
  if (!model.rental.present) return null;
  const nameByKey = new Map(taxonomy.rentalSchedule.map((l) => [l.key, l]));
  const expenses = RENTAL_EXPENSE_KEYS.map((key) => {
    const meta = nameByKey.get(key);
    const amount = model.rental.expenses[key].amount.value;
    return {
      key,
      name: meta?.name ?? key,
      paperLabel: meta?.paperLabel ?? "U",
      amount,
      display: amount == null ? "Nil" : formatDollars(amount),
    };
  });
  return {
    property: {
      address: [
        model.rental.property.addressLine1.value,
        model.rental.property.suburb.value,
        model.rental.property.state.value,
        model.rental.property.postcode.value,
      ]
        .filter((part) => part && part.trim().length > 0)
        .join(", ") || null,
      firstEarnedIncomeOn: model.rental.property.firstEarnedIncomeOn.value,
    },
    grossRent: n(model.rental.grossRent),
    otherRentalIncome: n(model.rental.otherRentalIncome),
    expenses,
    totalDeductions: totalRentalDeductions(model.rental),
    netRentalResult: input.assessment.assessableIncome.netRental,
  };
}

/**
 * Build the full label-keyed view. In-scope labels are emitted in myTax
 * on-screen section order (PRD FR-14); a label that does not apply to this
 * return (rental with no rental, PHI detail with no cover, spouse with no
 * spouse) is dropped.
 */
export function buildReturnView(input: ExportPackageInput): ReturnView {
  const { taxonomy, targetYear, paramsVersion, assessment } = input;
  const bindings = buildBindings();
  const generatedAt = input.generatedAt ?? new Date().toISOString();

  const sectionOrder = new Map(taxonomy.myTaxSectionOrder.map((s, i) => [s, i]));
  const bySection = new Map<MyTaxSection, ReturnViewLabel[]>();

  for (const label of taxonomy.labels) {
    if (!label.inScope) continue;
    const binding = bindings[label.code];
    if (!binding) continue;
    const resolved = binding(input);
    if (!resolved) continue;
    const rows = bySection.get(label.section) ?? [];
    rows.push({
      code: label.code,
      name: label.name,
      section: label.section,
      form: label.form,
      amount: resolved.amount,
      display: resolved.display ?? formatDollars(resolved.amount),
      computed: resolved.computed,
      detail: resolved.detail ?? [],
      note: resolved.note,
    });
    bySection.set(label.section, rows);
  }

  const sections: ReturnViewSection[] = [...bySection.entries()]
    .sort(([a], [b]) => (sectionOrder.get(a) ?? 99) - (sectionOrder.get(b) ?? 99))
    .map(([section, labels]) => ({
      section,
      title: SECTION_TITLES[section],
      labels,
    }));

  const ai = assessment.assessableIncome;
  return {
    targetYear,
    paramsVersion,
    generatedAt,
    taxpayer: buildTaxpayer(input.model),
    sections,
    rentalSchedule: buildRentalSchedule(input),
    estimate: {
      assessableIncome: ai.total,
      deductionsTotal: assessment.deductionsTotal,
      taxableIncome: assessment.taxableIncome,
      taxOnTaxableIncome: assessment.taxOnTaxableIncome,
      medicareLevy: assessment.medicareLevy,
      medicareLevySurcharge: assessment.medicareLevySurcharge,
      studyLoanRepayment: assessment.studyLoanRepayment,
      totalOffsets: assessment.nonRefundableOffsetsApplied,
      totalCredits: assessment.totalCredits,
      outcomeKind: assessment.outcome.kind,
      outcomeAmount: assessment.outcome.amount,
    },
  };
}
