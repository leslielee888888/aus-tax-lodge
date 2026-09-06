/**
 * T23 · Acceptance criterion 1 — no-rental return, full flow.
 *
 * upload → extract → apply → reconcile → review/confirm → questionnaire →
 * estimate → export, driven through the real `apps/web/lib/*` glue and the real
 * `@aus-tax-lodge/*` packages against a real encrypted temp-dir store. Only
 * Claude is mocked.
 *
 * ---------------------------------------------------------------------------
 * HAND-WORKED TAX ARITHMETIC (2025-26 params, `packages/params/src/2025-26`).
 * Never read back from `assess()`.
 *
 *   Salary & wages ............................. 95,000.00
 *   Gross interest (100% owned) ................     800.00
 *   Dividends grossed up (0 + 700 + 300) ......   1,000.00
 *   Net rental result .........................       0.00
 *   ─────────────────────────────────────────────────────
 *   Total assessable income ...................  96,800.00
 *   less Deductions (clothing 250 + donation 500)   750.00
 *   Taxable income  = floor(96,800 − 750) .....  96,050
 *
 *   Resident tax on 96,050  (45,000–135,000 band: $4,288 + 30c/$1 over 45,000)
 *     = 4,288 + 0.30 × (96,050 − 45,000)
 *     = 4,288 + 0.30 × 51,050  = 4,288 + 15,315 = 19,603.00
 *   LITO (taxable ≥ 66,667 cut-out) ............       0
 *   Beneficiary offset (allowances ≤ 6,000) ...       0
 *   Medicare levy = 2% × 96,050 ...............   1,921.00
 *     (shade-in 10c/$1 over 28,011 = 6,803.90 > 1,921 ⇒ full 2%)
 *   MLS: income 96,050 ≤ 101,000 single base tier ⇒ 0
 *   Study-loan repayment (no loan) ............       0
 *   ─────────────────────────────────────────────────────
 *   Total tax + levies = 19,603 + 1,921 ......  21,524.00
 *   less Franking credits (refundable) .......     300.00
 *   less PAYG withheld .......................  24,000.00
 *   ─────────────────────────────────────────────────────
 *   net = 21,524.00 − 24,300.00 = −2,776.00
 *   ⇒ ESTIMATED REFUND  $2,776.00
 * ---------------------------------------------------------------------------
 */
import { assess, getTaxonomy, PARAMS_VERSION, TARGET_YEAR } from "@aus-tax-lodge/engine";
import {
  applyExtractions,
  extractDocument,
  resolveReconciliation,
} from "@aus-tax-lodge/extraction";
import { buildReturnJson, buildSourceIndex } from "@aus-tax-lodge/export";
import { isReadyForEstimate, toEngineInput } from "@aus-tax-lodge/model";
import { validateReturn, isExportBlocked } from "@aus-tax-lodge/validation";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  applyQuestionsToModel,
  parseQuestionsFormData,
  validateQuestionsForm,
  residencyDisagrees,
  studyLoanDisagrees,
  unsettledJointAccounts,
} from "../../lib/questions/form";
import { incomeDocRoutes, incomeDocs } from "./fixtures/documents";
import {
  confirmAllProposed,
  createMockClaude,
  detailsModel,
  fakeTextLayer,
  readAesZip,
  setupTestEnv,
  type TestEnv,
} from "./harness";

const EXPECTED_REFUND = 2776.0;
const EXPECTED_TAXABLE_INCOME = 96050;

let env: TestEnv;

beforeAll(async () => {
  env = await setupTestEnv("atl-int-norental-");
});

afterAll(async () => {
  await env.cleanup();
});

describe("AC1 — no-rental return, full lifecycle (FR-2, FR-3, FR-7, FR-12, FR-14, FR-21)", () => {
  it("runs upload → extract → confirm → questionnaire → estimate → export end to end", async () => {
    const { getReturnRepository } = await import("../../lib/returns");
    const { getDocumentStore } = await import("../../lib/store");
    const { loadExportContext, buildExportInput } = await import("../../lib/export/context");
    const { computeExportGate } = await import("../../lib/export/gate");
    const { buildRecordsArchive } = await import("../../lib/export/archive");
    const { persistExportArtifacts, readExportManifest, readPersistedArtifact } =
      await import("../../lib/export/persist");

    const repo = getReturnRepository();
    const store = getDocumentStore();

    // --- Step 1-2: create a return and upload the documents (encrypted) ------
    const created = await repo.createReturn({
      data: detailsModel({ holdsStudyLoan: false }),
      currentStep: "documents",
    });
    const returnId = created.returnId;

    const docs = incomeDocs();
    const stored = await Promise.all(
      docs.map((d) =>
        store.putDocument(returnId, {
          filename: d.filename,
          mimeType: d.mimeType,
          bytes: d.bytes,
          detectedType: d.detectedType,
        }),
      ),
    );

    // --- Step 3: extraction (FR-3) — Claude mocked, everything else real ----
    const claude = createMockClaude(incomeDocRoutes(docs));
    const extractions = await Promise.all(
      stored.map((meta) =>
        extractDocument(returnId, meta.docId, {
          store,
          client: claude,
          extractTextLayer: fakeTextLayer,
        }),
      ),
    );

    // Every extracted figure is `high` confidence (snippets locate) — never
    // `unverified`, which would block confirmation (FR-3/FR-7).
    const allFigures = extractions.flatMap((e) => e.figures);
    expect(allFigures.length).toBeGreaterThan(10);
    expect(allFigures.every((f) => f.confidence !== "unverified")).toBe(true);
    expect(allFigures.filter((f) => f.confidence === "high").length).toBeGreaterThan(8);

    // --- Step 4: apply (FR-2 pre-fill-first, FR-7 proposed only) -----------
    const applied = applyExtractions(created.data as never, extractions);
    expect(applied.model.income.salaryWages[0]!.grossSalaryWages.status).toBe("proposed");
    expect(applied.model.income.salaryWages[0]!.grossSalaryWages.value).toBe(95000);

    // --- FR-21: the pre-fill report ($800) and the bank notice ($820) -----
    //          disagree on interest — surfaced, never auto-resolved.
    expect(applied.pendingReconciliation).toHaveLength(1);
    const pending = applied.pendingReconciliation[0]!;
    expect(pending.modelPath).toBe("income.interestAccounts[0].grossInterest");
    expect(pending.candidates.map((c) => c.value).sort()).toEqual([800, 820]);
    const prefillIdx = pending.candidates.findIndex((c) => c.documentType === "ato-prefill-report");
    const resolved = resolveReconciliation(applied.model, applied.pendingReconciliation, [
      { modelPath: pending.modelPath, chosenIndex: prefillIdx },
    ]);
    expect(resolved.unresolved).toHaveLength(0);
    expect(resolved.model.income.interestAccounts[0]!.grossInterest.value).toBe(800);

    // --- Step 5: review — the user confirms every proposed figure (FR-7) ---
    let model = confirmAllProposed(resolved.model);
    expect(model.income.salaryWages[0]!.grossSalaryWages.status).toBe("confirmed");
    expect(model.deductions.giftsAndDonations.amount.value).toBe(500);

    // --- Step 6: gap questionnaire (FR-6) — joint-account share + no rental
    const jointIds = unsettledJointAccounts(model).map((r) => r.accountId);
    expect(jointIds).toHaveLength(1);
    const fd = new FormData();
    fd.set("residencyFullYear", "yes");
    fd.set("studyLoanHeld", "no");
    fd.set("privateCoverDates", "none");
    fd.set("privateCoverDays", "0");
    fd.set("wfhDoubleClaimed", "no");
    fd.set(`jointShare.${jointIds[0]}`, "100");
    const values = parseQuestionsFormData(fd, jointIds);
    const qErrors = validateQuestionsForm(values, {
      residencyDisagreementPresent: residencyDisagrees(model, true),
      studyLoanDisagreementPresent: studyLoanDisagrees(model, false),
    });
    expect(qErrors).toEqual({});
    model = applyQuestionsToModel(model, values);
    expect(model.income.interestAccounts[0]!.ownershipSharePercent).toMatchObject({
      value: 100,
      status: "confirmed",
      origin: { kind: "user-answer" },
    });

    // --- The model is ready for the estimate (FR-7) -----------------------
    expect(isReadyForEstimate(model)).toBe(true);
    // ...and clean under the FR-13 gate.
    expect(isExportBlocked(validateReturn(model))).toBe(false);

    // --- Step 7: estimate — the deterministic engine (no LLM) -------------
    const assessment = assess(toEngineInput(model));
    expect(assessment.taxableIncome).toBe(EXPECTED_TAXABLE_INCOME);
    expect(assessment.taxOnTaxableIncome).toBeCloseTo(19603.0, 2);
    expect(assessment.medicareLevy).toBeCloseTo(1921.0, 2);
    expect(assessment.medicareLevySurcharge).toBe(0);
    expect(assessment.studyLoanRepayment).toBe(0);
    expect(assessment.outcome.kind).toBe("refund");
    expect(assessment.outcome.amount).toBeCloseTo(EXPECTED_REFUND, 2);

    // --- Persist the reviewed model so the export glue can load it --------
    const saved = await repo.saveReturn(returnId, { data: model, currentStep: "export" });
    expect(saved.conflict).toBe(false);

    // --- Step 8: export package (FR-14) ----------------------------------
    const context = await loadExportContext(returnId);
    expect(context.ready).toBe(true);
    expect(context.assessment).not.toBeNull();
    expect(context.missingFigures).toBeNull();

    const gate = computeExportGate(context.model, context.assessment, []);
    expect(gate.blocked).toBe(false);
    expect(gate.downloadsEnabled).toBe(true);

    const generatedAt = "2026-07-10T09:00:00.000Z";
    const input = buildExportInput(context, [], generatedAt);

    // FR-14: the export JSON figures equal the model / assessment.
    const json = buildReturnJson(input);
    expect(json.meta.atoTransmission).toBe("none");
    expect(json.assessment.taxableIncome).toBe(assessment.taxableIncome);
    expect(json.assessment.outcomeKind).toBe("refund");
    expect(json.assessment.outcomeAmount).toBeCloseTo(EXPECTED_REFUND, 2);
    expect(json.labels["1"]!.amount).toBe(95000); // salary & wages
    expect(json.labels["1"]!.amount).toBe(assessment.assessableIncome.salaryWages);
    expect(json.labels["10L"]!.amount).toBe(800); // gross interest, apportioned
    expect(json.labels["11U"]!.amount).toBe(300); // franking credits
    expect(json.labels["D9"]!.amount).toBe(500); // gifts / donations
    expect(json.rentalSchedule).toBeNull();

    // FR-14 d / FR-22: every dollar in the source index traces to a document
    // or a questionnaire answer — nothing "computed" or origin-less.
    const sourceIndex = buildSourceIndex(input);
    expect(sourceIndex.entries.length).toBeGreaterThan(8);
    for (const entry of sourceIndex.entries) {
      expect(["document", "user-answer"]).toContain(entry.origin.kind);
    }
    // The interest figure carries the pre-fill report as its resolved source.
    const interestEntry = sourceIndex.entries.find(
      (e) => e.path === "income.interestAccounts[0].grossInterest",
    )!;
    expect(interestEntry.value).toBe(800);
    expect(interestEntry.origin.kind).toBe("document");
    if (interestEntry.origin.kind === "document") {
      expect(interestEntry.origin.filename).toBe("ato-prefill-report.pdf");
    }

    // --- The encrypted records archive (FR-14) --------------------------
    const password = "amber-otter-1234-slate";
    const archive = await buildRecordsArchive(returnId, input, password);
    expect(archive.filename).toBe(`tax-records-${TARGET_YEAR}.zip`);
    expect(archive.bytes.subarray(0, 2).toString("latin1")).toBe("PK");

    // A wrong password fails the WinZip-AES key check.
    expect(() => readAesZip(archive.bytes, "not-the-password")).toThrow(/bad password/);

    const zipEntries = readAesZip(archive.bytes, password);
    const names = zipEntries.map((e) => e.name).sort();
    expect(names).toEqual(
      [
        `how-to-lodge-in-myTax-${TARGET_YEAR}.txt`,
        `return-data-${TARGET_YEAR}.json`,
        `return-summary-${TARGET_YEAR}.pdf`,
        `source-index-${TARGET_YEAR}.txt`,
        `validation-report-${TARGET_YEAR}.txt`,
        ...docs.map((d) => `source-documents/${d.filename}`),
      ].sort(),
    );

    const pdfEntry = zipEntries.find((e) => e.name.endsWith(".pdf"))!;
    expect(pdfEntry.bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");

    const jsonEntry = zipEntries.find((e) => e.name.endsWith(".json"))!;
    const archivedJson = JSON.parse(jsonEntry.bytes.toString("utf8"));
    expect(archivedJson.assessment.outcomeAmount).toBeCloseTo(EXPECTED_REFUND, 2);
    expect(archivedJson.labels["1"].amount).toBe(95000);

    const noteEntry = zipEntries.find((e) => e.name.startsWith("how-to-lodge"))!;
    expect(noteEntry.bytes.toString("utf8")).toMatch(/myTax/i);

    // --- The four artifacts persist encrypted at rest; the return is exported.
    await persistExportArtifacts(returnId, archive.pkg, {
      generatedAt,
      paramsVersion: input.paramsVersion,
    });
    const manifest = await readExportManifest(returnId);
    expect(manifest?.artifacts).toHaveLength(4);
    const persistedPdf = await readPersistedArtifact(returnId, "pdf");
    expect(persistedPdf?.bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const reloaded = await repo.loadReturn(returnId);
    expect(reloaded.envelope.status).toBe("exported");

    // The taxonomy / params version the export pins matches the active dataset.
    expect(input.paramsVersion).toBe(PARAMS_VERSION);
    expect(getTaxonomy(TARGET_YEAR).labels.length).toBeGreaterThan(0);
  });
});
