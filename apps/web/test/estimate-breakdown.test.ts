/** Estimate-screen breakdown assembly (PRD FR-12, FR-15, FR-23, FR-24). */
import { assess, type FullAssessment } from "@aus-tax-lodge/engine";
import {
  RENTAL_EXPENSE_KEYS,
  toEngineInput,
  type RentalExpenseKey,
  type ReturnModel,
} from "@aus-tax-lodge/model";
import { describe, expect, it } from "vitest";

import { buildEstimateBreakdown, type EstimateRow } from "../lib/estimate/breakdown";
import { answered, confirmedField, notApplicable, readyModel } from "./review-fixtures";

const RETURN_ID = "ret-1";

function assessment(model: ReturnModel): FullAssessment {
  return assess(toEngineInput(model));
}

function build(model: ReturnModel) {
  return buildEstimateBreakdown(model, assessment(model), RETURN_ID);
}

function row(rows: readonly EstimateRow[], label: string): EstimateRow | undefined {
  return rows.find((r) => r.label === label);
}

/** `readyModel()` with a rental schedule: gross rent + only the expense keys in `expenses` set, the rest nil. */
function withRental(
  model: ReturnModel,
  grossRent: number,
  expenses: Partial<Record<RentalExpenseKey, number>>,
): ReturnModel {
  const lines = Object.fromEntries(
    RENTAL_EXPENSE_KEYS.map((key) => [
      key,
      {
        amount:
          expenses[key] === undefined ? notApplicable<number>() : confirmedField(expenses[key]!),
        source: "owner-paid" as const,
      },
    ]),
  ) as ReturnModel["rental"]["expenses"];

  return {
    ...model,
    rental: {
      ...model.rental,
      present: true,
      grossRent: confirmedField(grossRent),
      otherRentalIncome: notApplicable<number>(),
      expenses: lines,
      repairsConfirmedNotCapital: true,
      netRentalResult: confirmedField(
        grossRent - RENTAL_EXPENSE_KEYS.reduce((s, k) => s + (expenses[k] ?? 0), 0),
      ),
    },
  };
}

function withStudyLoan(model: ReturnModel): ReturnModel {
  return {
    ...model,
    context: { ...model.context, holdsStudyLoan: confirmedField(true) },
    questionnaire: { ...model.questionnaire, studyLoanHeld: answered(true) },
  };
}

/** A spouse on a high combined income with no private cover → the surcharge bites. */
function withMlsExposure(model: ReturnModel): ReturnModel {
  return {
    ...model,
    context: {
      ...model.context,
      privateHospitalCoverDays: confirmedField(0),
      spouse: {
        ...model.context.spouse,
        status: confirmedField("had-spouse"),
        name: confirmedField("Sam"),
        dateOfBirth: confirmedField("1985-01-01"),
        estimatedTaxableIncome: confirmedField(180_000),
        privateHospitalCoverDays: confirmedField(0),
      },
    },
    income: {
      ...model.income,
      salaryWages: [
        {
          ...model.income.salaryWages[0]!,
          grossSalaryWages: confirmedField(160_000),
          paygWithheld: confirmedField(40_000),
        },
      ],
    },
  };
}

describe("buildEstimateBreakdown (PRD FR-12)", () => {
  it("headline reads 'payable' with the amount owing for a return that owes tax", () => {
    const model = readyModel();
    const { headline, rows } = build(model);
    const engine = assessment(model);

    expect(engine.outcome.kind).toBe("payable");
    expect(headline.kind).toBe("payable");
    expect(headline.label).toBe("Estimated amount owing");
    expect(headline.amount).toBe(engine.outcome.amount);
    expect(row(rows, "Estimated amount owing")).toMatchObject({ kind: "net" });
  });

  it("headline reads 'refund' when PAYG withheld exceeds the liability", () => {
    const model: ReturnModel = {
      ...readyModel(),
      income: {
        ...readyModel().income,
        salaryWages: [
          {
            ...readyModel().income.salaryWages[0]!,
            paygWithheld: confirmedField(30_000),
          },
        ],
      },
    };
    const { headline, rows } = build(model);
    const engine = assessment(model);

    expect(engine.outcome.kind).toBe("refund");
    expect(headline.kind).toBe("refund");
    expect(headline.label).toBe("Estimated refund");
    expect(headline.displayAmount).toBe(row(rows, "Estimated refund")!.displayAmount);
  });

  it("omits the rental lines and the loss add-back note when there is no rental", () => {
    const { rows, headline, rentalLossAddBack } = build(readyModel());

    expect(rentalLossAddBack).toBe(false);
    expect(row(rows, "Gross rent")).toBeUndefined();
    expect(row(rows, "less Rental deductions")).toBeUndefined();
    expect(row(rows, "Net rental result")).toBeUndefined();
    expect(headline.caveats).not.toContain(
      "Net rental loss is added back for the study-loan and surcharge income tests",
    );
  });

  it("breaks a negatively geared rental into gross rent − deductions = net result, flagged as a loss, and adds the FR-23 add-back caveat", () => {
    const model = withRental(readyModel(), 24_000, { interestOnLoans: 30_000, agentFees: 2_000 });
    const { rows, headline, rentalLossAddBack } = build(model);

    expect(rentalLossAddBack).toBe(true);

    const gross = row(rows, "Gross rent")!;
    const deductions = row(rows, "less Rental deductions")!;
    const net = row(rows, "Net rental result")!;
    expect(gross.amount).toBe(24_000);
    expect(deductions.amount).toBe(-32_000);
    expect(net.amount).toBe(-8_000);
    expect(net.note).toBe("— a loss");

    // gross − deductions === net (the FR-24 broken-out identity)
    expect(gross.amount + deductions.amount).toBe(net.amount);

    expect(headline.caveats).toContain(
      "Net rental loss is added back for the study-loan and surcharge income tests",
    );
  });

  it("shows the study loan repayment line only when a repayment is due", () => {
    expect(row(build(readyModel()).rows, "plus Study loan repayment")).toBeUndefined();

    const model = withStudyLoan(readyModel());
    const repayment = row(build(model).rows, "plus Study loan repayment");
    const engine = assessment(model);

    expect(engine.studyLoanRepayment).toBeGreaterThan(0);
    expect(repayment).toBeDefined();
    expect(repayment!.amount).toBe(engine.studyLoanRepayment);
  });

  it("shows the Medicare levy surcharge amount, and marks the spouse-driven lines as estimated, when the surcharge applies", () => {
    const model = withMlsExposure(readyModel());
    const { rows, headline } = build(model);
    const engine = assessment(model);

    expect(engine.medicareLevySurcharge).toBeGreaterThan(0);

    const surcharge = row(rows, "Medicare levy surcharge")!;
    expect(surcharge.amount).toBe(engine.medicareLevySurcharge);
    expect(surcharge.note).toBeUndefined();
    expect(surcharge.estimated).toBe(true);

    expect(row(rows, `plus Medicare levy (2%)`)!.estimated).toBe(true);
    expect(headline.caveats).toContain("Spouse income is an estimate");
  });

  it("reads 'adequate cover all year' on the surcharge line when cover was held the whole year", () => {
    const model = readyModel(); // privateHospitalCoverDays = 365
    const surcharge = row(build(model).rows, "Medicare levy surcharge")!;

    expect(assessment(model).medicareLevySurcharge).toBe(0);
    expect(surcharge.amount).toBe(0);
    expect(surcharge.note).toBe("— adequate cover all year");
  });

  it("labels every input line with a link back to the review screen", () => {
    const model = withRental(readyModel(), 24_000, { interestOnLoans: 30_000 });
    const { rows } = build(model);

    for (const r of rows) {
      if (r.kind === "net") {
        expect(r.href).toBeUndefined();
      } else {
        expect(r.href).toBe(`/returns/${RETURN_ID}/review`);
      }
    }
  });

  it("notes the taxpayer's ownership share on gross interest from a jointly held account", () => {
    const model: ReturnModel = {
      ...readyModel(),
      income: {
        ...readyModel().income,
        interestAccounts: [
          {
            id: "a1",
            institution: confirmedField("ING"),
            accountDescription: confirmedField("Joint savings"),
            grossInterest: confirmedField(600),
            tfnAmountsWithheld: notApplicable<number>(),
            ownershipSharePercent: confirmedField(50),
          },
        ],
      },
    };
    const interest = row(build(model).rows, "Gross interest")!;
    expect(interest.note).toBe("your 50% share");
    expect(interest.amount).toBe(300);
  });

  it("shows PAYG withheld and franking credits as negative (credit) lines", () => {
    const model: ReturnModel = {
      ...readyModel(),
      income: {
        ...readyModel().income,
        dividends: [
          {
            id: "d1",
            company: confirmedField("BHP"),
            unfranked: notApplicable<number>(),
            franked: confirmedField(7_000),
            frankingCredits: confirmedField(3_000),
            tfnAmountsWithheld: notApplicable<number>(),
          },
        ],
      },
    };
    const { rows } = build(model);
    const engine = assessment(model);

    expect(row(rows, "less PAYG tax withheld")!.amount).toBe(-engine.paygWithheldCredit);
    const franking = row(rows, "less Franking credits")!;
    expect(franking.amount).toBe(-engine.frankingCreditOffset);
    expect(franking.note).toBe("refundable");
    expect(row(rows, "Dividends incl. franking credits")!.amount).toBe(
      engine.assessableIncome.dividendsGrossedUp,
    );
  });
});
