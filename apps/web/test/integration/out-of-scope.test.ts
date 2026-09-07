/**
 * T23 · Acceptance criterion 3 — out-of-scope hard stop, no override.
 *
 * Exercises the REAL `@aus-tax-lodge/scope` package end to end: the one Claude
 * content check (`checkDocumentForOutOfScopeContent`, Claude mocked), the pure
 * detector (`detectOutOfScope`), the enforcement helpers (`isBlocked` /
 * `assertInScope` / `OutOfScopeError`), and the FR-13 export gate
 * (`validateReturn` → `isExportBlocked`, `lib/export/gate.ts` `computeExportGate`).
 *
 * FR-20 requires the stop to be UNCONDITIONAL. Grep result (run against
 * `packages/scope/src/**` and `apps/web/lib/**` for
 * override|bypass|force|acknowledge|suppress|ignore|skip|opt-out):
 *   - NO override / bypass / force / acknowledge path exists for an
 *     out-of-scope finding. `detectOutOfScope` has no suppression option,
 *     `assertInScope` has no bypass parameter, `isBlocked` is a pure predicate.
 *   - The only "acknowledge" concept in the codebase is FR-13 *warnings*
 *     (`computeExportGate` `acknowledgedWarningIds`) — those apply to
 *     `severity: "warning"` issues only; an `out-of-scope:*` issue is always
 *     `severity: "error"` and cannot be acknowledged away.
 * The last test below asserts this holds.
 *
 * Pre-existing gap noted (NOT introduced or fixed here — out of T23 scope):
 * the web review page and `validateReturn` call `detectOutOfScope({ model })`
 * WITHOUT `contentFindings`, so a document whose *content* is out of scope
 * (e.g. a "dividend statement" that is really a trust distribution) is not yet
 * caught in the running app — `apps/web/app/returns/[returnId]/review/page.tsx`
 * documents this as a follow-up for whoever wires T11's content check into the
 * extraction pipeline. This test drives the scope package's content path
 * directly, which is where FR-20 detection lives.
 */
import {
  assertInScope,
  checkDocumentForOutOfScopeContent,
  detectOutOfScope,
  isBlocked,
  OutOfScopeError,
  parseScopeContentReply,
  scopeFinding,
} from "@aus-tax-lodge/scope";
import { createEmptyReturnModel } from "@aus-tax-lodge/model";
import { isExportBlocked, validateReturn } from "@aus-tax-lodge/validation";
import { describe, expect, it } from "vitest";

import { computeExportGate } from "../../lib/export/gate";
import { applyQuestionsToModel, parseQuestionsFormData } from "../../lib/questions/form";
import { createMockClaude, fakePdf } from "./harness";

describe("AC3 — out-of-scope hard stop, no override (FR-13, FR-20)", () => {
  it("stops on a managed-fund / trust distribution statement (content check → finding → hard stop)", async () => {
    // The real content check, Claude mocked to flag the trust-distribution category.
    const claude = createMockClaude([
      {
        match: /Does this document contain, report or evidence ANY of the following/,
        reply: JSON.stringify(["trust-partnership-managed-fund-distribution"]),
      },
    ]);

    const classification = await checkDocumentForOutOfScopeContent(
      {
        docId: "d-trust",
        filename: "managed-fund-annual-tax-statement.pdf",
        parts: [
          {
            kind: "pdf",
            mimeType: "application/pdf",
            bytes: fakePdf(
              "ACME Diversified Fund — Annual tax statement. Net cash distribution. " +
                "Franked distribution. Foreign income. Net capital gains. AMIT cost base net amount.",
            ),
          },
        ],
      },
      claude,
    );
    expect(classification.categories).toEqual(["trust-partnership-managed-fund-distribution"]);
    // The parser is the same one the pipeline uses.
    expect(parseScopeContentReply('["trust-partnership-managed-fund-distribution"]')).toEqual([
      "trust-partnership-managed-fund-distribution",
    ]);

    const model = createEmptyReturnModel("2025-26");
    const findings = detectOutOfScope({ model, contentFindings: [classification] });

    const trust = findings.find((f) => f.code === "trust-partnership-managed-fund-distribution");
    expect(trust).toBeDefined();
    expect(trust!.item).toBe("Trust, partnership or managed-fund distribution");
    expect(trust!.source).toBe("document");
    // The finding names the specific file it was spotted in.
    expect(trust!.detail).toContain("managed-fund-annual-tax-statement.pdf");

    expect(isBlocked(findings)).toBe(true);

    // `assertInScope` throws and carries every finding — no way to proceed.
    let thrown: unknown;
    try {
      assertInScope(findings);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(OutOfScopeError);
    expect((thrown as OutOfScopeError).findings).toEqual(findings);
    expect((thrown as Error).message).toContain("Trust, partnership or managed-fund distribution");
  });

  it("stops on a co-owned rental answered at the questionnaire scope gate", () => {
    const base = createEmptyReturnModel("2025-26");
    let model = { ...base, rental: { ...base.rental, present: true } };

    // Answer the scope gate "no" — the co-owned / not-sole-ownership path.
    const fd = new FormData();
    fd.set("residencyFullYear", "yes");
    fd.set("studyLoanHeld", "no");
    fd.set("privateCoverDates", "none");
    fd.set("privateCoverDays", "0");
    fd.set("wfhDoubleClaimed", "no");
    fd.set("rentalSoleOwnershipAllYear", "no");
    fd.set("rentalBoughtOrSold", "no");
    model = applyQuestionsToModel(model, parseQuestionsFormData(fd, []));

    expect(model.rental.soleOwnership).toMatchObject({ value: false, status: "confirmed" });
    expect(model.questionnaire.rentalScopeGate.value?.solelyOwned).toBe(false);

    const findings = detectOutOfScope({ model });
    const coOwned = findings.find((f) => f.code === "rental-co-owned");
    expect(coOwned).toBeDefined();
    expect(coOwned!.item).toBe("Rental property co-owned with another person");
    expect(coOwned!.source).toBe("answer");
    expect(isBlocked(findings)).toBe(true);
    expect(() => assertInScope(findings)).toThrow(OutOfScopeError);

    // The FR-13 export path is blocked while the finding stands.
    const issues = validateReturn(model);
    expect(isExportBlocked(issues)).toBe(true);
    expect(issues.some((i) => i.code === "out-of-scope:rental-co-owned")).toBe(true);

    const gate = computeExportGate(model, null, []);
    expect(gate.blocked).toBe(true);
    expect(gate.errors.some((e) => e.code === "out-of-scope:rental-co-owned")).toBe(true);
    // The scope error is an `error`, never a `warning` — it can't be acknowledged.
    expect(gate.warnings.some((w) => w.code.startsWith("out-of-scope:"))).toBe(false);
  });

  it("has NO override / force / acknowledge / bypass for an out-of-scope finding (FR-20)", () => {
    // `detectOutOfScope(input)` — one argument, an input object. Its only
    // document-related keys are `documents` and `contentFindings`; there is no
    // key that suppresses a finding.
    expect(detectOutOfScope).toHaveLength(1);
    // `assertInScope(findings)` — one argument, the findings. No bypass flag.
    expect(assertInScope).toHaveLength(1);
    // `isBlocked(findings)` — a pure predicate over the findings array.
    expect(isBlocked).toHaveLength(1);

    // Any non-empty findings list ALWAYS blocks / throws — no flag turns it off.
    const anyFinding = [scopeFinding("capital-gains", "document")];
    expect(isBlocked(anyFinding)).toBe(true);
    expect(() => assertInScope(anyFinding)).toThrow(OutOfScopeError);

    // Every out-of-scope issue `validateReturn` emits is a blocking `error`.
    const outOfScopeModel = (() => {
      const b = createEmptyReturnModel("2025-26");
      return { ...b, context: { ...b.context, residency: { ...b.context.residency } } };
    })();
    const nonResident = {
      ...outOfScopeModel,
      context: {
        ...outOfScopeModel.context,
        residency: {
          value: "non-resident" as const,
          status: "confirmed" as const,
          origin: { kind: "user-answer" as const },
          proposedValue: "non-resident" as const,
          edits: [],
        },
      },
    };
    const issues = validateReturn(nonResident);
    const scopeIssues = issues.filter((i) => i.code.startsWith("out-of-scope:"));
    expect(scopeIssues.length).toBeGreaterThan(0);
    expect(scopeIssues.every((i) => i.severity === "error")).toBe(true);
  });
});
