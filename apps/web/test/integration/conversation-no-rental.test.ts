/**
 * T12 · Scenario 1 — no-rental return, full conversational happy path.
 *
 * Pre-fill upload → income-checkpoint card → confirm → the interview asks
 * deductions + the FR-6 facts → `done` → review-summary card → `approveReturn`
 * → `exported`. Real `@aus-tax-lodge/*`, real conversation state machine, real
 * AES temp-dir store, real prefill route + chat actions. Only Claude is scripted.
 *
 * ---------------------------------------------------------------------------
 * HAND-WORKED TAX ARITHMETIC (2025-26 params, `packages/params/src/2025-26`).
 * Asserted against the engine, never read back from it.
 *
 *   Salary & wages ............................. 95,000.00
 *   Gross interest (100% owned) ...............     800.00
 *   Dividends grossed up (0 + 700 + 300) ......   1,000.00
 *   Net rental result ........................        0.00
 *   ─────────────────────────────────────────────────────
 *   Total assessable income ..................  96,800.00
 *   less Deductions (clothing 250 + donation 500)  750.00
 *   Taxable income = floor(96,800 − 750) .....  96,050
 *
 *   Resident tax on 96,050  (45,000–135,000 band: 4,288 + 30c/$1 over 45,000)
 *     = 4,288 + 0.30 × 51,050 = 4,288 + 15,315 = 19,603.00
 *   LITO (taxable ≥ 66,667 cut-out) ..........       0
 *   Beneficiary offset (allowances 0 ≤ 6,000)        0
 *   Medicare levy = 2% × 96,050 ..............   1,921.00
 *     (shade-in 10c/$1 over 28,011 = 6,803.90 > 1,921 ⇒ full 2%)
 *   MLS: MLS-income 96,050 ≤ 101,000 single base tier ⇒ 0
 *   Study-loan repayment (no loan) ...........       0
 *   ─────────────────────────────────────────────────────
 *   Total tax + levies = 19,603 + 1,921 .....  21,524.00
 *   less Franking credits (refundable) ......     300.00
 *   less PAYG withheld ......................  24,000.00
 *   ─────────────────────────────────────────────────────
 *   net = 21,524.00 − 24,300.00 = −2,776.00
 *   ⇒ ESTIMATED REFUND  $2,776.00
 * ---------------------------------------------------------------------------
 */
import { assess, PARAMS_VERSION, TARGET_YEAR } from "@aus-tax-lodge/engine";
import { toEngineInput } from "@aus-tax-lodge/model";
import { buildReturnJson, buildSourceIndex } from "@aus-tax-lodge/export";
import { validateReturn, isExportBlocked } from "@aus-tax-lodge/validation";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../lib/ai/client", () => ({
  getClaudeClient: () => {
    if (!holder.client) throw new Error("scripted Claude not installed");
    return holder.client;
  },
}));

import {
  approve,
  confirmIncomeCheckpoint,
  createChatReturn,
  createClaudeScript,
  isApplyTurn,
  load,
  postPrefill,
  readAesZip,
  send,
  setupTestEnv,
  type ClaudeScript,
  type TestEnv,
} from "./harness";
import { prefillFixture } from "./fixtures/documents";

const EXPECTED_REFUND = 2776.0;
const EXPECTED_TAXABLE_INCOME = 96050;
const ARCHIVE_PASSWORD = "amber-otter-1234-slate";

let env: TestEnv;
let script: ClaudeScript;

beforeAll(async () => {
  env = await setupTestEnv("atl-int-v2-norental-");
  script = createClaudeScript();
  holder.client = script.client;
});

afterAll(async () => {
  await env.cleanup();
});

describe("Scenario 1 — no-rental return, full conversational lifecycle", () => {
  it("drives upload → checkpoint → interview → review → approve → exported", async () => {
    const returns = await import("../../lib/returns");
    const { loadExportContext, buildExportInput } = await import("../../lib/export/context");
    const { computeExportGate } = await import("../../lib/export/gate");
    const { buildRecordsArchive } = await import("../../lib/export/archive");
    const { readExportManifest } = await import("../../lib/export/persist");

    // --- Step 1: create the return, upload the ATO pre-fill report -----------
    const returnId = await createChatReturn();
    const prefill = await prefillFixture({ grossSalary: 95000, paygWithheld: 24000 });
    prefill.wire(script);
    script.queueNextTurn('{"kind":"card","card":"income-checkpoint"}');

    const prefillRes = await postPrefill(returnId, prefill.filename, prefill.bytes);
    expect(prefillRes.body.ok).toBe(true);

    let loaded = await load(returnId);
    expect(loaded.conversation.phase).toBe("interview");

    // Income seeded from the pre-fill report as `proposed` (FR-2, FR-7).
    expect(loaded.model.income.salaryWages[0]!.grossSalaryWages.status).toBe("proposed");
    expect(loaded.model.income.salaryWages[0]!.grossSalaryWages.value).toBe(95000);
    expect(loaded.model.income.salaryWages[0]!.grossSalaryWages.origin).toMatchObject({
      kind: "document",
      confidence: "high",
    });
    // The income checkpoint card was raised.
    const lastTurn = loaded.conversation.turns.at(-1)!;
    expect(lastTurn).toMatchObject({
      role: "assistant",
      kind: "card",
      card: { type: "income-checkpoint" },
    });

    // --- Step 2: confirm the income checkpoint (FR-5 "Looks right") ----------
    await confirmIncomeCheckpoint(returnId);
    loaded = await load(returnId);
    expect(loaded.model.income.salaryWages[0]!.grossSalaryWages.status).toBe("confirmed");
    expect(loaded.model.income.dividends[0]!.frankingCredits.status).toBe("confirmed");

    // --- Step 3: the interview asks for deductions + the FR-6 facts ----------
    const interestId = loaded.model.income.interestAccounts[0]!.id;
    const answerText =
      "DEDUCTIONS+FACTS: work uniform $250, RSPCA donation $500, nothing else. " +
      "I was an Australian resident all year, no spouse, no HELP loan, no private hospital cover, " +
      "no dependent children, my CommBank account is all mine (100%), and my work-from-home hours " +
      "were not also claimed as a separate expense. No government payments, fringe benefits or " +
      "reportable employer super.";
    const updates = [
      { path: "deductions.workRelatedClothing.amount", value: 250, kind: "number" },
      { path: "deductions.giftsAndDonations.amount", value: 500, kind: "number" },
      { path: "deductions.workRelatedCar.amount", value: null, kind: "number" },
      { path: "deductions.workRelatedTravel.amount", value: null, kind: "number" },
      { path: "deductions.selfEducation.amount", value: null, kind: "number" },
      { path: "deductions.otherWorkRelated.amount", value: null, kind: "number" },
      { path: "deductions.workFromHome.amount", value: null, kind: "number" },
      { path: "deductions.workFromHome.hours", value: null, kind: "number" },
      { path: "deductions.costOfManagingTaxAffairs.amount", value: null, kind: "number" },
      { path: "questionnaire.residencyFullYear", value: true, kind: "boolean" },
      { path: "context.spouse.status", value: "none", kind: "string" },
      { path: "context.holdsStudyLoan", value: false, kind: "boolean" },
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
      "answer:deductions+facts",
      (p, o) => isApplyTurn(p, o) && p.includes("DEDUCTIONS+FACTS:"),
      JSON.stringify({ updates }),
    );

    const sent = await send(returnId, answerText);
    expect(sent.error).toBeUndefined();

    loaded = await load(returnId);
    // The interview is complete → the conversation moved to review with the summary card.
    expect(loaded.conversation.phase).toBe("review");
    const reviewCard = loaded.conversation.turns.at(-1)!;
    expect(reviewCard).toMatchObject({
      role: "assistant",
      kind: "card",
      card: { type: "review-summary" },
    });

    const model = loaded.model;

    // --- Persisted ReturnModel: every confirmed figure, right provenance ----
    expect(model.income.salaryWages[0]!.grossSalaryWages).toMatchObject({
      value: 95000,
      status: "confirmed",
      origin: { kind: "document" },
    });
    expect(model.deductions.workRelatedClothing.amount).toMatchObject({
      value: 250,
      status: "confirmed",
      origin: { kind: "user-answer" },
    });
    expect(model.deductions.giftsAndDonations.amount).toMatchObject({
      value: 500,
      status: "confirmed",
    });
    expect(model.context.residency).toMatchObject({
      value: "resident-full-year",
      status: "confirmed",
    });
    expect(model.income.interestAccounts[0]!.ownershipSharePercent).toMatchObject({
      value: 100,
      status: "confirmed",
      origin: { kind: "user-answer" },
    });
    expect(isExportBlocked(validateReturn(model))).toBe(false);

    // --- The engine estimate: hand-worked figures --------------------------
    const assessment = assess(toEngineInput(model));
    expect(assessment.taxableIncome).toBe(EXPECTED_TAXABLE_INCOME);
    expect(assessment.taxOnTaxableIncome).toBeCloseTo(19603.0, 2);
    expect(assessment.medicareLevy).toBeCloseTo(1921.0, 2);
    expect(assessment.medicareLevySurcharge).toBe(0);
    expect(assessment.studyLoanRepayment).toBe(0);
    expect(assessment.frankingCreditOffset).toBeCloseTo(300.0, 2);
    expect(assessment.paygWithheldCredit).toBeCloseTo(24000.0, 2);
    expect(assessment.outcome.kind).toBe("refund");
    expect(assessment.outcome.amount).toBeCloseTo(EXPECTED_REFUND, 2);

    // --- Step 4: approve with a ≥12-char password → exported ---------------
    const approved = await approve(returnId, ARCHIVE_PASSWORD);
    expect(approved.ok).toBe(true);
    expect(approved.archiveReady).toBe(true);

    loaded = await load(returnId);
    expect(loaded.conversation.phase).toBe("exported");

    // markReturnExported recorded on the envelope.
    const reloaded = await returns.getReturnRepository().loadReturn(returnId);
    expect(reloaded.envelope.status).toBe("exported");

    // --- The export package (assembleExportPackage / buildRecordsArchive) ---
    const context = await loadExportContext(returnId);
    expect(context.ready).toBe(true);
    expect(context.assessment).not.toBeNull();

    const gate = computeExportGate(context.model, context.assessment, []);
    expect(gate.blocked).toBe(false);
    expect(gate.downloadsEnabled).toBe(true);

    const input = buildExportInput(context, [], "2026-07-10T09:00:00.000Z");

    // FR-14 — exported JSON figures equal the model / assessment.
    const json = buildReturnJson(input);
    expect(json.meta.atoTransmission).toBe("none");
    expect(json.assessment.taxableIncome).toBe(assessment.taxableIncome);
    expect(json.assessment.outcomeKind).toBe("refund");
    expect(json.assessment.outcomeAmount).toBeCloseTo(EXPECTED_REFUND, 2);
    expect(json.labels["1"]!.amount).toBe(95000);
    expect(json.labels["1"]!.amount).toBe(assessment.assessableIncome.salaryWages);
    expect(json.labels["11U"]!.amount).toBe(300);
    expect(json.labels["D9"]!.amount).toBe(500);
    expect(json.rentalSchedule).toBeNull();

    // FR-22 — every dollar in the source index traces to a document or an answer.
    const sourceIndex = buildSourceIndex(input);
    expect(sourceIndex.entries.length).toBeGreaterThan(8);
    for (const entry of sourceIndex.entries) {
      if (entry.value === 0) continue;
      expect(["document", "user-answer", "computed"]).toContain(entry.origin.kind);
    }
    const salaryEntry = sourceIndex.entries.find(
      (e) => e.path === "income.salaryWages[0].grossSalaryWages",
    )!;
    expect(salaryEntry.origin.kind).toBe("document");
    if (salaryEntry.origin.kind === "document") {
      expect(salaryEntry.origin.filename).toBe("ato-prefill-report.pdf");
    }
    const clothingEntry = sourceIndex.entries.find(
      (e) => e.path === "deductions.workRelatedClothing.amount",
    )!;
    expect(clothingEntry.origin.kind).toBe("user-answer");

    // --- The encrypted records archive -----------------------------------
    const archive = await buildRecordsArchive(returnId, input, ARCHIVE_PASSWORD);
    expect(archive.filename).toBe(`tax-records-${TARGET_YEAR}.zip`);
    expect(archive.bytes.subarray(0, 2).toString("latin1")).toBe("PK");
    expect(() => readAesZip(archive.bytes, "not-the-password")).toThrow(/bad password/);

    const zipEntries = readAesZip(archive.bytes, ARCHIVE_PASSWORD);
    const names = zipEntries.map((e) => e.name).sort();
    expect(names).toEqual(
      [
        `how-to-lodge-in-myTax-${TARGET_YEAR}.txt`,
        `return-data-${TARGET_YEAR}.json`,
        `return-summary-${TARGET_YEAR}.pdf`,
        `source-index-${TARGET_YEAR}.txt`,
        `validation-report-${TARGET_YEAR}.txt`,
        `source-documents/${prefill.filename}`,
      ].sort(),
    );
    const jsonEntry = zipEntries.find((e) => e.name.endsWith(".json"))!;
    const archivedJson = JSON.parse(jsonEntry.bytes.toString("utf8"));
    expect(archivedJson.assessment.outcomeAmount).toBeCloseTo(EXPECTED_REFUND, 2);
    expect(
      zipEntries
        .find((e) => e.name.endsWith(".pdf"))!
        .bytes.subarray(0, 5)
        .toString("latin1"),
    ).toBe("%PDF-");

    // --- The four artifacts persist encrypted at rest -------------------
    const { persistExportArtifacts } = await import("../../lib/export/persist");
    await persistExportArtifacts(returnId, archive.pkg, {
      generatedAt: "2026-07-10T09:00:00.000Z",
      paramsVersion: input.paramsVersion,
    });

    // --- Exported figures == confirmed model + estimate ------------------
    const manifest = await readExportManifest(returnId);
    expect(manifest?.artifacts).toHaveLength(4);
    expect(json.labels["1"]!.amount).toBe(model.income.salaryWages[0]!.grossSalaryWages.value);
    expect(json.assessment.outcomeAmount).toBe(assessment.outcome.amount);
    expect(input.paramsVersion).toBe(PARAMS_VERSION);
  });
});
