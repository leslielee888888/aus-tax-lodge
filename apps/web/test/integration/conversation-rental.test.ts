/**
 * T12 · Scenario 2 — negatively-geared rental, folded in mid-conversation.
 *
 * Pre-fill → income checkpoint → the rental documents are dropped via the
 * interview-document route (`assembleRentalSchedule` runs) → the rental figures
 * are confirmed → repairs-over-$1,000 confirmation → the rental scope gate is
 * settled in-scope → the FR-6 facts → review → approve → exported.
 *
 * ---------------------------------------------------------------------------
 * HAND-WORKED TAX ARITHMETIC (2025-26 params). Asserted against the engine.
 *
 *   Pre-fill income:
 *     Salary & wages ........................... 122,000.00   (PAYG withheld 33,000)
 *     Gross interest (100% owned) .............      800.00
 *     Dividends grossed up (0 + 700 + 300) ...    1,000.00
 *
 *   Rental (item 21):
 *     Gross rent .............................    26,000.00
 *     less  agent fees 2,080 + council rates 1,400 + water 300
 *           + repairs 1,500 + loan interest 25,000
 *           + capital works (Div 43) 3,000 + decline in value (Div 40) 1,200
 *         = 34,480.00
 *     Net rental result = 26,000 − 34,480 ...   −8,480.00   (a LOSS)
 *
 *   Total assessable income = 122,000 + 800 + 1,000 − 8,480 = 115,320.00
 *   Deductions ............................        0
 *   Taxable income = floor(115,320) .......   115,320
 *
 *   FR-23 income for the income tests (net rental LOSS added back):
 *     base = floor(115,320 + 0 + 0 + 8,480) =  123,800
 *     — equals what taxable income would be WITHOUT the rental loss.
 *
 *   Resident tax on 115,320 (45,000–135,000 band): 4,288 + 0.30 × 70,320
 *     = 4,288 + 21,096 = 25,384.00
 *   LITO / beneficiary offset .............        0
 *   Medicare levy = 2% × 115,320 .........    2,306.40
 *     (shade-in 10c/$1 over 28,011 = 8,730.90 > 2,306.40 ⇒ full 2%)
 *   Medicare levy surcharge:
 *     MLS income 123,800 → tier2 (118,001–158,000), rate 1.25%
 *     (WITHOUT the add-back, 115,320 would be tier1 at 1.0% — the loss add-back
 *      MOVES the MLS tier)
 *     = 1.25% × 115,320 × 365/365 ..........   1,441.50
 *   Study-loan (HELP) repayment:
 *     repayment income 123,800 → band 67,001–125,000: 15c/$1 over 67,000
 *     (WITHOUT the add-back it would be 15c × (115,320 − 67,000) = 7,248 — the
 *      HELP threshold uses income BEFORE the rental loss)
 *     = 0.15 × (123,800 − 67,000) = 0.15 × 56,800 = 8,520.00
 *   ─────────────────────────────────────────────────────
 *   Total tax + levies = 25,384.00 + 2,306.40 + 1,441.50 + 8,520.00 = 37,651.90
 *   less Franking credits ................      300.00
 *   less PAYG withheld ..................    33,000.00
 *   ─────────────────────────────────────────────────────
 *   net = 37,651.90 − 33,300.00 = 4,351.90
 *   ⇒ ESTIMATED AMOUNT PAYABLE  $4,351.90
 * ---------------------------------------------------------------------------
 */
import { assess } from "@aus-tax-lodge/engine";
import { toEngineInput } from "@aus-tax-lodge/model";
import { buildReturnJson } from "@aus-tax-lodge/export";
import { isExportBlocked, validateReturn } from "@aus-tax-lodge/validation";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { deterministicallyComplete } from "../../lib/interview";

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../lib/ai/client", () => ({
  getClaudeClient: () => {
    if (!holder.client) throw new Error("scripted Claude not installed");
    return holder.client;
  },
}));

import {
  acceptAllPendingConfirmations,
  approve,
  confirmIncomeCheckpoint,
  createChatReturn,
  createClaudeScript,
  isApplyTurn,
  load,
  postInterviewDocument,
  postPrefill,
  readAesZip,
  send,
  settleRentalGaps,
  setupTestEnv,
  submitIdentity,
  type ClaudeScript,
  type TestEnv,
} from "./harness";
import {
  loanInterestSummaryFixture,
  prefillFixture,
  qsScheduleFixture,
  rentalAgentStatementFixture,
  type RentalFixtureOptions,
} from "./fixtures/documents";

const RENTAL: RentalFixtureOptions = {
  grossRent: 26000,
  agentFees: 2080,
  councilRates: 1400,
  waterCharges: 300,
  repairs: 1500,
  loanInterest: 25000,
  capitalWorks: 3000,
  declineInValue: 1200,
};
const EXPECTED_NET_RENTAL = -8480;
const EXPECTED_TAXABLE_INCOME = 115320;
const EXPECTED_FR23_BASE = 123800;
const EXPECTED_PAYABLE = 4351.9;
const ARCHIVE_PASSWORD = "teal-badger-9182-copper";

let env: TestEnv;
let script: ClaudeScript;

beforeAll(async () => {
  env = await setupTestEnv("atl-int-v2-rental-");
  script = createClaudeScript();
  holder.client = script.client;
});

afterAll(async () => {
  await env.cleanup();
});

describe("Scenario 2 — negatively-geared rental", () => {
  it("folds the rental in, adds the loss back for the income tests, and exports the item-21 schedule", async () => {
    const { loadExportContext, buildExportInput } = await import("../../lib/export/context");
    const { computeExportGate } = await import("../../lib/export/gate");
    const { buildRecordsArchive } = await import("../../lib/export/archive");

    // --- Pre-fill + income checkpoint ------------------------------------
    const returnId = await createChatReturn();
    const prefill = await prefillFixture({ grossSalary: 122000, paygWithheld: 33000 });
    prefill.wire(script);
    script.queueNextTurn('{"kind":"card","card":"income-checkpoint"}');
    await postPrefill(returnId, prefill.filename, prefill.bytes);
    await confirmIncomeCheckpoint(returnId);

    const interestId = (await load(returnId)).model.income.interestAccounts[0]!.id;

    // --- Drop the three rental source documents (PRD FR-24) -------------
    const agent = await rentalAgentStatementFixture(RENTAL);
    const loan = await loanInterestSummaryFixture(RENTAL);
    const qs = await qsScheduleFixture(RENTAL);
    for (const fx of [agent, loan, qs]) fx.wire(script);

    const agentRes = await postInterviewDocument(returnId, agent.filename, agent.bytes);
    expect(agentRes.body.ok).toBe(true);
    // The repairs-over-$1,000 confirmation question was raised in the same turn.
    const afterAgent = await load(returnId);
    expect(afterAgent.model.rental.present).toBe(true);
    const agentLines = afterAgent.conversation.turns
      .filter((t) => t.kind === "message" && t.role === "assistant")
      .map((t) => (t.kind === "message" ? t.text : ""));
    expect(agentLines.some((l) => /repairs and maintenance line is \$1,500/i.test(l))).toBe(true);

    expect((await postInterviewDocument(returnId, loan.filename, loan.bytes)).body).toMatchObject({
      ok: true,
      reason: "rental",
    });
    expect((await postInterviewDocument(returnId, qs.filename, qs.bytes)).body).toMatchObject({
      ok: true,
      reason: "rental",
    });

    // --- Confirm every proposed rental figure (PRD FR-5) ---------------
    const confirmed = await acceptAllPendingConfirmations(returnId);
    expect(confirmed).toBeGreaterThanOrEqual(6); // gross rent + the populated expense lines

    // --- Repairs-over-$1,000: "yes, genuine repair" (PRD Q25) ---------
    script.onAsk(
      "answer:repairs",
      (p, o) => isApplyTurn(p, o) && p.includes("REPAIRS-CONFIRM:"),
      JSON.stringify({
        updates: [{ path: "rental.repairsConfirmedNotCapital", value: true, kind: "boolean" }],
      }),
    );
    await send(
      returnId,
      "REPAIRS-CONFIRM: yes, that plumbing repair was a genuine repair, not an improvement.",
    );

    // --- The rental scope gate, answered in scope (PRD FR-6, FR-24) ---, plus
    // the rental property identity (PRD FR-24, #88 / T15), asked in the same turn.
    script.onAsk(
      "answer:scope-gate",
      (p, o) => isApplyTurn(p, o) && p.includes("RENTAL-SCOPE:"),
      JSON.stringify({
        updates: [
          { path: "questionnaire.rentalScopeGate.solelyOwned", value: true, kind: "boolean" },
          {
            path: "questionnaire.rentalScopeGate.rentedOrAvailableAllYear",
            value: true,
            kind: "boolean",
          },
          { path: "questionnaire.rentalScopeGate.noPrivateUse", value: true, kind: "boolean" },
          {
            path: "questionnaire.rentalScopeGate.notBoughtOrSoldThisYear",
            value: true,
            kind: "boolean",
          },
          { path: "rental.property.addressLine1", value: "10 Landlord Lane", kind: "string" },
          { path: "rental.property.suburb", value: "Brunswick", kind: "string" },
          { path: "rental.property.state", value: "VIC", kind: "string" },
          { path: "rental.property.postcode", value: "3056", kind: "string" },
          {
            path: "rental.property.firstEarnedIncomeOn",
            value: "2019-07-01",
            kind: "date",
          },
        ],
      }),
    );
    await send(
      returnId,
      "RENTAL-SCOPE: I own it on my own, it was rented all year, no private use, and I did not buy " +
        "or sell it this year. It's at 10 Landlord Lane, Brunswick VIC 3056, and it first earned " +
        "rental income on 1 July 2019.",
    );

    // --- Nil the untouched rental expense rows (v1 review-screen action) ---
    await settleRentalGaps(returnId);

    // --- Taxpayer identity + the FR-6 facts (HELP loan held this time) (#88 / T15) ---
    const factUpdates = [
      // Taxpayer identity (PRD FR-1, #88 / T15) — name / DOB / postal address only;
      // the TFN + refund account are NEVER part of a chat reply (PRD FR-17).
      { path: "taxpayer.fullName", value: "Jordan Landlord", kind: "string" },
      { path: "taxpayer.dateOfBirth", value: "1978-11-20", kind: "date" },
      { path: "taxpayer.postalAddress.line1", value: "5 Owner Ave", kind: "string" },
      { path: "taxpayer.postalAddress.suburb", value: "Fitzroy", kind: "string" },
      { path: "taxpayer.postalAddress.state", value: "VIC", kind: "string" },
      { path: "taxpayer.postalAddress.postcode", value: "3065", kind: "string" },
      // No work-related deductions claimed at all (#88 / T15).
      { path: "deductions.workRelatedCar.notClaimed", value: true, kind: "boolean" },
      { path: "deductions.workRelatedTravel.notClaimed", value: true, kind: "boolean" },
      { path: "deductions.workRelatedClothing.notClaimed", value: true, kind: "boolean" },
      { path: "deductions.selfEducation.notClaimed", value: true, kind: "boolean" },
      { path: "deductions.otherWorkRelated.notClaimed", value: true, kind: "boolean" },
      { path: "deductions.workFromHome.notClaimed", value: true, kind: "boolean" },
      { path: "deductions.giftsAndDonations.notClaimed", value: true, kind: "boolean" },
      { path: "deductions.costOfManagingTaxAffairs.notClaimed", value: true, kind: "boolean" },
      { path: "questionnaire.residencyFullYear", value: true, kind: "boolean" },
      { path: "context.spouse.status", value: "none", kind: "string" },
      { path: "context.holdsStudyLoan", value: true, kind: "boolean" },
      { path: "context.privateHospitalCoverDays", value: 0, kind: "number" },
      { path: "context.dependentChildren", value: 0, kind: "number" },
      { path: "questionnaire.jointAccountSharesProvided", value: true, kind: "boolean" },
      { path: "questionnaire.wfhHoursNotDoubleClaimed", value: true, kind: "boolean" },
      { path: "privateHealth.held", value: false, kind: "boolean" },
      { path: "income.governmentAllowances", value: null, kind: "number" },
      { path: "income.reportableFringeBenefits", value: null, kind: "number" },
      { path: "income.reportableEmployerSuper", value: null, kind: "number" },
      {
        path: `income.interestAccounts.${interestId}.ownershipSharePercent`,
        value: 100,
        kind: "number",
      },
    ];
    script.onAsk(
      "answer:facts",
      (p, o) => isApplyTurn(p, o) && p.includes("DEDUCTIONS+FACTS:"),
      JSON.stringify({ updates: factUpdates }),
    );
    await send(
      returnId,
      "DEDUCTIONS+FACTS: I'm Jordan Landlord, born 20/11/1978, at 5 Owner Ave, Fitzroy VIC 3065. " +
        "No deductions to claim. Resident all year, no spouse, I DO have a HELP loan, " +
        "no private hospital cover, no dependent children, the CommBank account is 100% mine, WFH hours " +
        "not double-claimed, and no government payments / fringe benefits / reportable employer super.",
    );

    // The plain identity questions are settled, so the secure `identity` card is
    // raised deterministically (PRD FR-1, FR-17, #88 / T15) before review.
    let afterFacts = await load(returnId);
    const identityCard = afterFacts.conversation.turns.at(-1)!;
    expect(identityCard).toMatchObject({
      role: "assistant",
      kind: "card",
      card: { type: "identity" },
    });
    expect(afterFacts.conversation.phase).toBe("interview");

    // --- Submit the TFN + refund account via the secure card -----------
    const identityResult = await submitIdentity(returnId, {
      tfn: "123456782",
      bsb: "062-000",
      accountNumber: "87654321",
      accountName: "Jordan Landlord",
    });
    expect(identityResult.error).toBeUndefined();
    // PRD FR-17 — the card-response turn carries only a flag, never the values.
    const identityResponseTurn = identityResult.conversation.turns.find(
      (t) => t.kind === "card-response" && t.cardId === identityCard.id,
    );
    expect(identityResponseTurn).toMatchObject({ response: { provided: true } });
    expect(JSON.stringify(identityResponseTurn)).not.toContain("123456782");
    expect(JSON.stringify(identityResponseTurn)).not.toContain("87654321");

    // --- The interview is complete → review ---------------------------
    const reviewed = await load(returnId);
    expect(reviewed.conversation.phase).toBe("review");
    const model = reviewed.model;
    expect(model.rental.netRentalResult.value).toBe(EXPECTED_NET_RENTAL);
    expect(isExportBlocked(validateReturn(model))).toBe(false);

    // --- #88 / T15 — the empty-seeded return is now genuinely complete -------
    expect(deterministicallyComplete(model)).toBe(true);
    expect(validateReturn(model).filter((i) => i.severity === "error")).toEqual([]);

    // --- The engine: the loss lowers taxable income; the income tests add it back
    const engineInput = toEngineInput(model);
    expect(engineInput.income.netRentalResult).toBe(EXPECTED_NET_RENTAL);
    const assessment = assess(engineInput);

    expect(assessment.assessableIncome.netRental).toBe(EXPECTED_NET_RENTAL);
    expect(assessment.taxableIncome).toBe(EXPECTED_TAXABLE_INCOME); // lowered by the loss

    // FR-23 — every income test uses income BEFORE the rental loss (loss added back).
    expect(assessment.incomeTests.repaymentIncome).toBe(EXPECTED_FR23_BASE);
    expect(assessment.incomeTests.mlsIncome).toBe(EXPECTED_FR23_BASE);
    expect(assessment.incomeTests.rebateTierIncome).toBe(EXPECTED_FR23_BASE);
    expect(EXPECTED_FR23_BASE).toBe(EXPECTED_TAXABLE_INCOME + -EXPECTED_NET_RENTAL);

    // The add-back moves the MLS tier (tier2 1.25%, not tier1 1.0%) and lifts the HELP repayment.
    expect(assessment.taxOnTaxableIncome).toBeCloseTo(25384.0, 2);
    expect(assessment.medicareLevy).toBeCloseTo(2306.4, 2);
    expect(assessment.medicareLevySurcharge).toBeCloseTo(1441.5, 2); // 1.25% × 115,320
    expect(assessment.studyLoanRepayment).toBeCloseTo(8520.0, 2); // 15% × (123,800 − 67,000)
    expect(assessment.outcome.kind).toBe("payable");
    expect(assessment.outcome.amount).toBeCloseTo(EXPECTED_PAYABLE, 2);

    // --- Approve + export: the item-21 rental schedule is in the package ---
    let approved = await approve(returnId, ARCHIVE_PASSWORD);
    if (!approved.ok && approved.needsWarningAck) {
      approved = await approve(
        returnId,
        ARCHIVE_PASSWORD,
        (approved.warnings ?? []).map((w) => w.id),
      );
    }
    expect(approved.ok).toBe(true);
    expect((await load(returnId)).conversation.phase).toBe("exported");

    const context = await loadExportContext(returnId);
    const input = buildExportInput(
      context,
      await import("../../lib/export/acknowledgements").then((m) =>
        m.readAcknowledgedWarningIds(returnId),
      ),
      "2026-07-10T09:00:00.000Z",
    );

    expect(
      computeExportGate(context.model, context.assessment, input.acknowledgedWarningIds)
        .downloadsEnabled,
    ).toBe(true);

    const json = buildReturnJson(input);
    expect(json.rentalSchedule).not.toBeNull();
    expect(json.rentalSchedule!.netRentalResult).toBe(EXPECTED_NET_RENTAL);
    expect(json.rentalSchedule!.grossRent).toBe(26000);
    expect(json.assessment.taxableIncome).toBe(EXPECTED_TAXABLE_INCOME);
    expect(json.assessment.outcomeKind).toBe("payable");
    expect(json.assessment.outcomeAmount).toBeCloseTo(EXPECTED_PAYABLE, 2);

    const archive = await buildRecordsArchive(returnId, input, ARCHIVE_PASSWORD);
    expect(archive.bytes.subarray(0, 2).toString("latin1")).toBe("PK");
    const zip = readAesZip(archive.bytes, ARCHIVE_PASSWORD);
    const archivedJson = JSON.parse(
      zip.find((e) => e.name.endsWith(".json"))!.bytes.toString("utf8"),
    );
    expect(archivedJson.rentalSchedule.netRentalResult).toBe(EXPECTED_NET_RENTAL);
    expect(archivedJson.assessment.outcomeAmount).toBeCloseTo(EXPECTED_PAYABLE, 2);
    // The myTax-ordered PDF text carries the item-21 rental schedule.
    const pdfText = zip.find((e) => e.name.endsWith(".pdf"))!.bytes.toString("latin1");
    expect(pdfText.slice(0, 5)).toBe("%PDF-");
  });
});
