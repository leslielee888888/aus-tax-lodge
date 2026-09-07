/**
 * T23 · Acceptance criterion 2 — negatively-geared rental return, full flow.
 *
 * Same end-to-end shape as `no-rental-flow.test.ts`, but the taxpayer also has
 * one solely-owned residential rental that runs at a loss. Everything is the
 * REAL T25 wiring — the rental identity through `lib/details/form.ts`, the three
 * rental documents folded in through `@aus-tax-lodge/model`'s
 * `assembleRentalSchedule` (the exact call path the `extractFigures` server
 * action uses for rental doc types), the scope-gate booleans derived by
 * `lib/questions/form.ts` `applyQuestionsToModel`. Only Claude is mocked.
 *
 * The `harness.ts` `settleRentalWiringGap` shim was DELETED as part of this
 * work — T25 closed the gap it compensated for. `settleRentalScheduleGaps` is
 * kept: it mirrors the review screen, where the user marks the rental expense
 * rows the documents didn't populate as nil (the same thing `detailsModel`
 * does for the untouched income / deduction rows in the no-rental flow).
 *
 * ---------------------------------------------------------------------------
 * HAND-WORKED ARITHMETIC (2025-26 params, `packages/params/src/2025-26`).
 * Never read back from `assess()` — every number below is derived from the
 * fixture figures in `fixtures/documents.ts`.
 *
 *   RENTAL (item 21) — figures from the three rental-document fixtures:
 *     Gross rent (agent statement) ...............  26,000.00
 *     less agent-statement expenses:
 *       Property agent fees ......  2,080.00
 *       Council rates ...........  1,400.00
 *       Repairs & maintenance ...    600.00   (< $1,000 — repairs gate NOT tripped)
 *       Water charges ...........    300.00
 *                                 ─────────
 *                                   4,380.00
 *     less loan interest (loan summary) .........  25,000.00
 *     less Division 43 capital works (QS sched) .   3,000.00
 *     less Division 40 decline in value (QS) ....   1,200.00
 *     ───────────────────────────────────────────────────────
 *     Total rental deductions ...................  33,580.00
 *     NET RENTAL RESULT = 26,000 − 33,580 = ..... −7,580.00   (a loss)
 *
 *   RETURN — the no-rental-flow income side (see that file) plus the loss:
 *     Salary & wages ............................  95,000.00
 *     Gross interest (ATO pre-fill, 100% owned) .     800.00
 *     Dividends grossed up (0 + 700 + 300) ......   1,000.00
 *     Net rental result ......................... − 7,580.00
 *     ───────────────────────────────────────────────────────
 *     Total assessable income ..................   89,220.00
 *     less Deductions (clothing 250 + gift 500) .     750.00
 *     Taxable income = floor(89,220 − 750) .....   88,470
 *
 *     Resident tax on 88,470 (45,000–135,000 band: 4,288 + 30c/$1 over 45,000)
 *       = 4,288 + 0.30 × (88,470 − 45,000) = 4,288 + 13,041 =  17,329.00
 *     LITO (taxable 88,470 > 66,667 cut-out) ....        0
 *     Medicare levy = 2% × 88,470 ..............    1,769.40
 *       (88,470 well over the 35,013 single upper shade-in limit ⇒ full 2%)
 *
 *     FR-23 add-back — net rental LOSS is added back for every income test:
 *       income for MLS / repayment / rebate-tier purposes
 *         = taxable income + |loss| = 88,470 + 7,580 =  96,050
 *     MLS: single, 96,050 ≤ 101,000 base tier ⇒ 0
 *     Study-loan repayment (no loan) ...........        0
 *     ───────────────────────────────────────────────────────
 *     Total tax + levies = 17,329.00 + 1,769.40 =  19,098.40
 *     less Franking credits (refundable) .......      300.00
 *     less PAYG withheld .......................   24,000.00
 *     ───────────────────────────────────────────────────────
 *     net = 19,098.40 − 300.00 − 24,000.00 = ... −5,201.60
 *     ⇒ ESTIMATED REFUND  $5,201.60
 * ---------------------------------------------------------------------------
 */
import { assess, PARAMS_VERSION, TARGET_YEAR } from "@aus-tax-lodge/engine";
import {
  applyExtractions,
  extractDocument,
  resolveReconciliation,
} from "@aus-tax-lodge/extraction";
import { buildReturnJson, buildSourceIndex, renderReturnPdfText } from "@aus-tax-lodge/export";
import {
  assembleRentalSchedule,
  isReadyForEstimate,
  needsRepairsConfirmation,
  toEngineInput,
} from "@aus-tax-lodge/model";
import { isExportBlocked, validateReturn } from "@aus-tax-lodge/validation";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  applyDetailsToModel,
  parseDetailsFormData,
  validateDetailsForm,
} from "../../lib/details/form";
import {
  applyQuestionsToModel,
  parseQuestionsFormData,
  residencyDisagrees,
  studyLoanDisagrees,
  unsettledJointAccounts,
  validateQuestionsForm,
} from "../../lib/questions/form";
import {
  incomeDocRoutes,
  incomeDocs,
  rentalDocRoutes,
  rentalDocs,
  RENTAL_AGENT_STATEMENT_REPLY,
  RENTAL_LOAN_SUMMARY_REPLY,
  RENTAL_QS_SCHEDULE_REPLY,
} from "./fixtures/documents";
import {
  confirmAllProposed,
  createMockClaude,
  detailsModel,
  fakeTextLayer,
  readAesZip,
  setupTestEnv,
  settleRentalScheduleGaps,
  type TestEnv,
} from "./harness";

// --- Expected figures, computed from the fixtures (never from `assess()`) ----
const GROSS_RENT = 26_000;
const AGENT_EXPENSES = 2_080 + 1_400 + 600 + 300; // agent fees + council + repairs + water
const LOAN_INTEREST = 25_000;
const DIV_43_CAPITAL_WORKS = 3_000;
const DIV_40_DECLINE_IN_VALUE = 1_200;
const TOTAL_RENTAL_DEDUCTIONS =
  AGENT_EXPENSES + LOAN_INTEREST + DIV_43_CAPITAL_WORKS + DIV_40_DECLINE_IN_VALUE; // 33,580
const EXPECTED_NET_RENTAL = GROSS_RENT - TOTAL_RENTAL_DEDUCTIONS; // −7,580
const RENTAL_LOSS = -EXPECTED_NET_RENTAL; // 7,580

// Income side is identical to no-rental-flow.test.ts.
const ASSESSABLE_BEFORE_RENTAL = 95_000 + 800 + 1_000; // 96,800
const DEDUCTIONS_TOTAL = 250 + 500; // 750
const EXPECTED_TAXABLE_INCOME = Math.floor(
  ASSESSABLE_BEFORE_RENTAL + EXPECTED_NET_RENTAL - DEDUCTIONS_TOTAL,
); // 88,470
const EXPECTED_ADDBACK_INCOME = EXPECTED_TAXABLE_INCOME + RENTAL_LOSS; // 96,050
const EXPECTED_REFUND = 5_201.6;

// Repairs line is $600 in the fixture — deliberately under the $1,000
// confirmation threshold, so the repairs-vs-capital gate is exercised only to
// prove it stays closed.
const FIXTURE_REPAIRS_LINE = 600;

let env: TestEnv;

beforeAll(async () => {
  env = await setupTestEnv("atl-int-rental-");
});

afterAll(async () => {
  await env.cleanup();
});

/** The T15 details form values for a resident with one solely-owned rental. */
function rentalDetailsFormData(): FormData {
  const fd = new FormData();
  fd.set("fullName", "Priya Example");
  fd.set("dob", "02/03/1985");
  fd.set("line1", "1 Test St");
  fd.set("suburb", "Sydney");
  fd.set("state", "NSW");
  fd.set("postcode", "2000");
  fd.set("tfn", "123456782");
  fd.set("residency", "resident-full-year");
  fd.set("bsb", "062-000");
  fd.set("accountNumber", "12345678");
  fd.set("accountName", "Priya Example");
  fd.set("studyLoan", "no");
  fd.set("privateCoverDays", "0");
  fd.set("dependentChildren", "0");
  fd.set("hasRental", "on");
  fd.set("rentalAddressLine1", "12 Rous Road");
  fd.set("rentalSuburb", "Coffs Harbour");
  fd.set("rentalState", "NSW");
  fd.set("rentalPostcode", "2450");
  fd.set("rentalFirstEarnedOn", "01/07/2019");
  return fd;
}

describe("AC2 — negatively-geared rental return, full lifecycle (FR-6, FR-7, FR-12, FR-14, FR-21, FR-23, FR-24)", () => {
  it("declares a rental, folds the three rental documents in, and flows the loss both ways", async () => {
    const { getReturnRepository } = await import("../../lib/returns");
    const { getDocumentStore } = await import("../../lib/store");
    const { loadExportContext, buildExportInput } = await import("../../lib/export/context");
    const { computeExportGate } = await import("../../lib/export/gate");
    const { buildRecordsArchive } = await import("../../lib/export/archive");

    const repo = getReturnRepository();
    const store = getDocumentStore();

    // --- Step 1: T15 details form — declare the rental + property identity ---
    const detailsValues = parseDetailsFormData(rentalDetailsFormData());
    expect(validateDetailsForm(detailsValues)).toEqual({});

    let model = applyDetailsToModel(detailsModel({ holdsStudyLoan: false }), detailsValues);
    expect(model.rental.present).toBe(true);
    expect(model.rental.property.addressLine1).toMatchObject({
      value: "12 Rous Road",
      status: "confirmed",
      origin: { kind: "user-answer" },
    });
    expect(model.rental.property.state.value).toBe("NSW");
    expect(model.rental.property.firstEarnedIncomeOn.value).toBe("2019-07-01");

    const created = await repo.createReturn({ data: model, currentStep: "documents" });
    const returnId = created.returnId;

    // --- Step 2: upload the income docs AND the three rental docs -----------
    const income = incomeDocs();
    const rental = rentalDocs();

    const storedIncome = await Promise.all(
      income.map((d) =>
        store.putDocument(returnId, {
          filename: d.filename,
          mimeType: d.mimeType,
          bytes: d.bytes,
          detectedType: d.detectedType,
        }),
      ),
    );
    const storedRental = {
      agentStatement: await store.putDocument(returnId, { ...rental.agentStatement }),
      loanSummary: await store.putDocument(returnId, { ...rental.loanSummary }),
      qsSchedule: await store.putDocument(returnId, { ...rental.qsSchedule }),
    };

    // One mock Claude, routed for both the generic extraction prompts and the
    // three rental-assembly prompts.
    const claude = createMockClaude([...incomeDocRoutes(income), ...rentalDocRoutes()]);

    // --- Step 3a: generic figure extraction (FR-3), same as the no-rental flow
    const extractions = await Promise.all(
      storedIncome.map((meta) =>
        extractDocument(returnId, meta.docId, {
          store,
          client: claude,
          extractTextLayer: fakeTextLayer,
        }),
      ),
    );
    const applied = applyExtractions(model, extractions);

    // FR-21: the $800 pre-fill vs $820 bank-notice interest disagreement — same
    // as AC1 — surfaced and resolved to the pre-fill figure.
    expect(applied.pendingReconciliation).toHaveLength(1);
    const pending = applied.pendingReconciliation[0]!;
    const prefillIdx = pending.candidates.findIndex((c) => c.documentType === "ato-prefill-report");
    const resolved = resolveReconciliation(applied.model, applied.pendingReconciliation, [
      { modelPath: pending.modelPath, chosenIndex: prefillIdx },
    ]);
    expect(resolved.unresolved).toHaveLength(0);
    model = resolved.model;

    // --- Step 3b: rental documents → assembleRentalSchedule (FR-24) ---------
    // This is the exact call path `extractFigures` (documents/actions.ts) takes
    // for the three rental document types — never the generic prompt table.
    const rentalSchedule = await assembleRentalSchedule(
      model,
      {
        agentStatement: {
          docId: storedRental.agentStatement.docId,
          bytes: rental.agentStatement.bytes,
          mimeType: rental.agentStatement.mimeType,
        },
        loanSummary: {
          docId: storedRental.loanSummary.docId,
          bytes: rental.loanSummary.bytes,
          mimeType: rental.loanSummary.mimeType,
        },
        qsSchedule: {
          docId: storedRental.qsSchedule.docId,
          bytes: rental.qsSchedule.bytes,
          mimeType: rental.qsSchedule.mimeType,
        },
      },
      claude as unknown as Parameters<typeof assembleRentalSchedule>[2],
    );
    model = { ...model, rental: rentalSchedule };

    // The parsed rental figures land `proposed` against a document origin.
    expect(model.rental.grossRent).toMatchObject({ value: GROSS_RENT, status: "proposed" });
    expect(model.rental.grossRent.origin).toMatchObject({ kind: "document" });
    expect(model.rental.expenses.interestOnLoans.amount.value).toBe(LOAN_INTEREST);
    expect(model.rental.expenses.interestOnLoans.source).toBe("loan-summary");
    expect(model.rental.expenses.capitalWorks.amount.value).toBe(DIV_43_CAPITAL_WORKS);
    expect(model.rental.expenses.declineInValue.amount.value).toBe(DIV_40_DECLINE_IN_VALUE);
    expect(model.rental.expenses.agentFees.source).toBe("agent-statement");

    // Repairs gate: the fixture keeps this line under the $1,000 threshold, so
    // it never needs confirmation.
    expect(model.rental.expenses.repairsAndMaintenance.amount.value).toBe(FIXTURE_REPAIRS_LINE);
    expect(needsRepairsConfirmation(model.rental)).toBe(false);

    // --- Step 4: review — confirm every proposed figure, mark the untouched
    //             rental expense rows nil (FR-7). --------------------------
    model = confirmAllProposed(model);
    model = settleRentalScheduleGaps(model);
    expect(model.rental.grossRent.status).toBe("confirmed");
    expect(model.rental.expenses.interestOnLoans.amount.status).toBe("confirmed");
    expect(model.rental.expenses.insurance.amount.status).toBe("not-applicable");
    expect(model.rental.otherRentalIncome.status).toBe("not-applicable");

    // --- Step 5: gap questionnaire (FR-6) incl. the rental scope gate ------
    const jointIds = unsettledJointAccounts(model).map((r) => r.accountId);
    expect(jointIds).toHaveLength(1);
    const qfd = new FormData();
    qfd.set("residencyFullYear", "yes");
    qfd.set("studyLoanHeld", "no");
    qfd.set("privateCoverDates", "none");
    qfd.set("privateCoverDays", "0");
    qfd.set("wfhDoubleClaimed", "no");
    qfd.set("rentalSoleOwnershipAllYear", "yes");
    qfd.set("rentalBoughtOrSold", "no");
    qfd.set(`jointShare.${jointIds[0]}`, "100");
    const qValues = parseQuestionsFormData(qfd, jointIds);
    expect(
      validateQuestionsForm(qValues, {
        residencyDisagreementPresent: residencyDisagrees(model, true),
        studyLoanDisagreementPresent: studyLoanDisagrees(model, false),
      }),
    ).toEqual({});
    model = applyQuestionsToModel(model, qValues);

    // FR-24 / T25: the three rental scope booleans are derived here, and only
    // here, from the answered gate — as `{status:"confirmed", origin:"user-answer"}`.
    for (const key of ["soleOwnership", "rentedOrAvailableAllYear", "noPrivateUse"] as const) {
      expect(model.rental[key]).toMatchObject({
        value: true,
        status: "confirmed",
        origin: { kind: "user-answer" },
      });
    }
    expect(model.questionnaire.rentalScopeGate.status).toBe("confirmed");

    // --- Step 6: the model is ready and not export-blocked -----------------
    expect(isReadyForEstimate(model)).toBe(true);
    const assessment = assess(toEngineInput(model));
    expect(isExportBlocked(validateReturn(model, assessment))).toBe(false);

    // --- Step 7: the net rental loss flows BOTH ways ----------------------
    // (a) it reduces assessable / taxable income
    expect(assessment.assessableIncome.netRental).toBe(EXPECTED_NET_RENTAL); // −7,580
    expect(assessment.taxableIncome).toBe(EXPECTED_TAXABLE_INCOME); // 88,470
    // (b) FR-23 — it is added back for every income test
    expect(assessment.incomeTests.repaymentIncome).toBe(EXPECTED_ADDBACK_INCOME); // 96,050
    expect(assessment.incomeTests.mlsIncome).toBe(EXPECTED_ADDBACK_INCOME);
    expect(assessment.incomeTests.rebateTierIncome).toBe(EXPECTED_ADDBACK_INCOME);
    expect(assessment.incomeTests.mlsIncome).toBe(EXPECTED_TAXABLE_INCOME + RENTAL_LOSS);

    expect(assessment.taxOnTaxableIncome).toBeCloseTo(17_329.0, 2);
    expect(assessment.medicareLevy).toBeCloseTo(1_769.4, 2);
    expect(assessment.medicareLevySurcharge).toBe(0);
    expect(assessment.studyLoanRepayment).toBe(0);
    expect(assessment.outcome.kind).toBe("refund");
    expect(assessment.outcome.amount).toBeCloseTo(EXPECTED_REFUND, 2);

    // --- Step 8: export — the item-21 schedule appears everywhere ----------
    const saved = await repo.saveReturn(returnId, { data: model, currentStep: "export" });
    expect(saved.conflict).toBe(false);

    const context = await loadExportContext(returnId);
    expect(context.ready).toBe(true);
    const gate = computeExportGate(context.model, context.assessment, []);
    expect(gate.blocked).toBe(false);

    const generatedAt = "2026-07-11T09:00:00.000Z";
    const input = buildExportInput(context, [], generatedAt);

    // FR-14: the export JSON carries the rental schedule with the net loss.
    const json = buildReturnJson(input);
    expect(json.rentalSchedule).not.toBeNull();
    expect(json.rentalSchedule!.netRentalResult).toBe(EXPECTED_NET_RENTAL);
    expect(json.rentalSchedule!.grossRent).toBe(GROSS_RENT);
    expect(json.rentalSchedule!.totalDeductions).toBe(TOTAL_RENTAL_DEDUCTIONS);
    expect(json.labels["21"]!.amount).toBe(EXPECTED_NET_RENTAL);

    // FR-14 a: the rental labels are in the PDF text.
    const pdfText = renderReturnPdfText(input);
    expect(pdfText).toMatch(/Item 21 — Rental property schedule/);
    expect(pdfText).toMatch(/Gross rent \(label P\)/);
    expect(pdfText).toMatch(/Interest on loan\(s\) \(label Q\)/);
    expect(pdfText).toMatch(/Net rent \(label 21, net\).*\(a loss\)/);
    expect(pdfText).toContain("12 Rous Road, Coffs Harbour, NSW, 2450");

    // FR-14 d / FR-22: every rental figure traces to its document in the source index.
    const sourceIndex = buildSourceIndex(input);
    const grossRentEntry = sourceIndex.entries.find((e) => e.path === "rental.grossRent")!;
    expect(grossRentEntry.value).toBe(GROSS_RENT);
    expect(grossRentEntry.origin.kind).toBe("document");
    const interestEntry = sourceIndex.entries.find(
      (e) => e.path === "rental.expenses.interestOnLoans.amount",
    )!;
    expect(interestEntry.value).toBe(LOAN_INTEREST);
    expect(interestEntry.origin.kind).toBe("document");
    if (interestEntry.origin.kind === "document") {
      expect(interestEntry.origin.filename).toBe("loan-interest-summary.pdf");
    }

    // --- Step 9: the encrypted records archive holds the 3 rental docs -----
    const password = "amber-otter-1234-slate";
    const archive = await buildRecordsArchive(returnId, input, password);
    expect(archive.filename).toBe(`tax-records-${TARGET_YEAR}.zip`);
    expect(() => readAesZip(archive.bytes, "not-the-password")).toThrow(/bad password/);

    const names = readAesZip(archive.bytes, password)
      .map((e) => e.name)
      .sort();
    expect(names).toEqual(
      [
        `how-to-lodge-in-myTax-${TARGET_YEAR}.txt`,
        `return-data-${TARGET_YEAR}.json`,
        `return-summary-${TARGET_YEAR}.pdf`,
        `source-index-${TARGET_YEAR}.txt`,
        `validation-report-${TARGET_YEAR}.txt`,
        ...income.map((d) => `source-documents/${d.filename}`),
        "source-documents/rental-agent-statement.pdf",
        "source-documents/loan-interest-summary.pdf",
        "source-documents/qs-depreciation-schedule.pdf",
      ].sort(),
    );

    expect(input.paramsVersion).toBe(PARAMS_VERSION);
  });

  it("keeps the rental-document fixture replies self-consistent with the hand-worked figures", () => {
    // Guards the arithmetic above against a fixture edit.
    const agent = JSON.parse(RENTAL_AGENT_STATEMENT_REPLY);
    const loan = JSON.parse(RENTAL_LOAN_SUMMARY_REPLY);
    const qs = JSON.parse(RENTAL_QS_SCHEDULE_REPLY);
    expect(agent.grossRent.amount).toBe(GROSS_RENT);
    expect(agent.expenses.reduce((s: number, e: { amount: number }) => s + e.amount, 0)).toBe(
      AGENT_EXPENSES,
    );
    expect(loan.interestOnLoans.amount).toBe(LOAN_INTEREST);
    expect(qs.capitalWorks.amount).toBe(DIV_43_CAPITAL_WORKS);
    expect(qs.declineInValue.amount).toBe(DIV_40_DECLINE_IN_VALUE);
    const repairs = agent.expenses.find((e: { key: string }) => e.key === "repairsAndMaintenance");
    expect(repairs.amount).toBe(FIXTURE_REPAIRS_LINE);
    expect(repairs.amount).toBeLessThan(1_000);
  });
});
