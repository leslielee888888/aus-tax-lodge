/**
 * The FR-13 pre-export validation gate.
 *
 * {@link validateReturn} runs every correctness and plausibility check the PRD
 * requires before a return may be exported and returns a flat list of
 * {@link ValidationIssue}s: `error`s block export
 * ({@link isExportBlocked}); `warning`s are shown and can be acknowledged by
 * the caller (the acknowledgement itself is *not* tracked here — see FR-13).
 *
 * Explicitly out of scope for this module (see the T8 task brief): detecting
 * out-of-scope material itself (`@aus-tax-lodge/scope` does that; this module
 * only calls it), the UI that renders pass/warn (T17/T20), and the export
 * builder that will call this (T20).
 */
import type { FullAssessment } from "@aus-tax-lodge/engine";
import {
  needsRepairsConfirmation,
  RENTAL_EXPENSE_KEYS,
  requiredLabels,
  type ReturnModel,
} from "@aus-tax-lodge/model";
import { detectOutOfScope } from "@aus-tax-lodge/scope";

import { isValidBsb } from "./bsb";
import { collectInScopeFields } from "./fields";
import { isValidTfn } from "./tfn";
import type { ValidationIssue } from "./types";
import { walkProvenancedFields } from "./walk";

// ---------------------------------------------------------------------------
// Plausibility constants (PRD FR-13)
// ---------------------------------------------------------------------------

/** 2025-26 company tax rate gross-up: franking credits ≈ `franked × 30 ÷ 70`. */
const FRANKING_GROSS_UP_RATIO = 30 / 70;
/** "Off by more than a few percent" — a 5% relative tolerance either side of the gross-up ratio. */
const FRANKING_TOLERANCE_RATIO = 0.05;

/** PAYG withheld plausible range, as a fraction of gross salary and wages. */
const PAYG_MIN_RATIO = 0.05;
const PAYG_MAX_RATIO = 0.55;

/** Division 43 capital works is capped at 2.5% of construction cost per year. */
const CAPITAL_WORKS_MAX_RATIO = 0.025;

/** Loan interest more than this multiple of gross rent is implausible. */
const LOAN_INTEREST_MAX_MULTIPLE_OF_RENT = 3;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * A forward-compatible read of an optional construction-cost figure that may
 * one day live on the rental property (PRD FR-13 — "capital works ≈ up to
 * 2.5% of a stated construction cost, ONLY if the model carries one"). The
 * model does not have this field yet; this check simply never fires until it
 * does, matching the same forward-compatibility pattern
 * `@aus-tax-lodge/scope`'s `detect.ts` uses for a possible future multi-rental
 * shape.
 */
function readConstructionCost(model: ReturnModel): number | null {
  const property = model.rental.property as unknown as {
    readonly constructionCost?: { readonly value: number | null };
  };
  return property.constructionCost?.value ?? null;
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

/**
 * Run every FR-13 correctness and plausibility check over `model` (and,
 * where useful, `assessment`) and return the full list of issues. An empty
 * array means the return is clean. `assessment` is accepted for callers that
 * already have one to hand but is not currently required by any check here —
 * every check below is derivable from the model alone.
 */
export function validateReturn(
  model: ReturnModel,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- part of the FR-13 contract; no current check needs it.
  assessment?: FullAssessment,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // --- Mandatory labels present (PRD FR-13) ---------------------------------
  for (const row of requiredLabels(model)) {
    if (!row.satisfied) {
      issues.push({
        code: "mandatory-label-missing",
        severity: "error",
        message: `Mandatory label not confirmed: ${row.name} (${row.code}).`,
        path: row.code,
      });
    }
  }

  // --- Out-of-scope (PRD FR-13, FR-20) ---------------------------------------
  for (const finding of detectOutOfScope({ model })) {
    issues.push({
      code: `out-of-scope:${finding.code}`,
      severity: "error",
      message: `${finding.item} — ${finding.detail}`,
    });
  }

  // --- TFN / BSB well-formed (PRD FR-1, FR-13) --------------------------------
  const tfn = model.taxpayer.taxFileNumber.value;
  if (tfn !== null && !isValidTfn(tfn)) {
    issues.push({
      code: "tfn-invalid",
      severity: "error",
      message: "The tax file number is not well-formed (it fails the ATO checksum).",
      path: "taxpayer.taxFileNumber",
    });
  }
  const bsb = model.taxpayer.refundAccount.value?.bsb ?? null;
  if (bsb !== null && !isValidBsb(bsb)) {
    issues.push({
      code: "bsb-invalid",
      severity: "error",
      message: "The refund account BSB is not well-formed (expected NNN-NNN).",
      path: "taxpayer.refundAccount.bsb",
    });
  }

  // --- No disallowed negatives (PRD FR-13) ------------------------------------
  // The net rental result and the final assessment outcome may be negative or
  // either sign — deliberately not checked here.
  const rejectNegative = (path: string, value: number | null, label: string): void => {
    if (value !== null && value < 0) {
      issues.push({
        code: "negative-amount",
        severity: "error",
        message: `${label} cannot be negative.`,
        path,
      });
    }
  };
  model.income.salaryWages.forEach((employer, i) => {
    rejectNegative(
      `income.salaryWages[${i}].grossSalaryWages`,
      employer.grossSalaryWages.value,
      `Salary and wages (employer ${i + 1})`,
    );
    rejectNegative(
      `income.salaryWages[${i}].paygWithheld`,
      employer.paygWithheld.value,
      `PAYG tax withheld (employer ${i + 1})`,
    );
  });
  model.income.interestAccounts.forEach((account, i) => {
    rejectNegative(
      `income.interestAccounts[${i}].grossInterest`,
      account.grossInterest.value,
      `Gross interest (account ${i + 1})`,
    );
  });
  model.income.dividends.forEach((holding, i) => {
    rejectNegative(
      `income.dividends[${i}].unfranked`,
      holding.unfranked.value,
      `Unfranked dividend amount (holding ${i + 1})`,
    );
    rejectNegative(
      `income.dividends[${i}].franked`,
      holding.franked.value,
      `Franked dividend amount (holding ${i + 1})`,
    );
    rejectNegative(
      `income.dividends[${i}].frankingCredits`,
      holding.frankingCredits.value,
      `Franking credits (holding ${i + 1})`,
    );
  });
  if (model.rental.present) {
    rejectNegative("rental.grossRent", model.rental.grossRent.value, "Gross rent");
    for (const key of RENTAL_EXPENSE_KEYS) {
      rejectNegative(
        `rental.expenses.${key}.amount`,
        model.rental.expenses[key].amount.value,
        `Rental expense — ${key}`,
      );
    }
  }

  // --- Plausible ranges (PRD FR-13 — all warnings) ----------------------------
  model.income.dividends.forEach((holding, i) => {
    const franked = holding.franked.value;
    const credits = holding.frankingCredits.value;
    if (franked !== null && franked > 0 && credits !== null) {
      const expected = franked * FRANKING_GROSS_UP_RATIO;
      const diffRatio = Math.abs(credits - expected) / expected;
      if (diffRatio > FRANKING_TOLERANCE_RATIO) {
        issues.push({
          code: "franking-credit-implausible",
          severity: "warning",
          message:
            `Franking credits of $${credits.toFixed(2)} look implausible for a franked dividend ` +
            `of $${franked.toFixed(2)} — expected about $${expected.toFixed(2)} at the 30% ` +
            "company tax rate gross-up.",
          path: `income.dividends[${i}].frankingCredits`,
        });
      }
    }
  });

  const totalSalary = round2(
    model.income.salaryWages.reduce((sum, e) => sum + (e.grossSalaryWages.value ?? 0), 0),
  );
  const totalPaygWithheld = round2(
    model.income.salaryWages.reduce((sum, e) => sum + (e.paygWithheld.value ?? 0), 0),
  );
  if (totalSalary > 0) {
    const ratio = totalPaygWithheld / totalSalary;
    if (ratio < PAYG_MIN_RATIO || ratio > PAYG_MAX_RATIO) {
      issues.push({
        code: "payg-withheld-implausible",
        severity: "warning",
        message:
          `PAYG tax withheld of $${totalPaygWithheld.toFixed(2)} looks implausible against gross ` +
          `salary and wages of $${totalSalary.toFixed(2)} (${(ratio * 100).toFixed(1)}% withheld).`,
        path: "income.salaryWages",
      });
    }
  }

  if (model.rental.present) {
    const constructionCost = readConstructionCost(model);
    const capitalWorks = model.rental.expenses.capitalWorks.amount.value;
    if (constructionCost !== null && constructionCost > 0 && capitalWorks !== null) {
      const maxExpected = round2(constructionCost * CAPITAL_WORKS_MAX_RATIO);
      if (capitalWorks > maxExpected) {
        issues.push({
          code: "capital-works-implausible",
          severity: "warning",
          message:
            `Capital works of $${capitalWorks.toFixed(2)} exceeds 2.5% of the stated construction ` +
            `cost of $${constructionCost.toFixed(2)} (about $${maxExpected.toFixed(2)} per year).`,
          path: "rental.expenses.capitalWorks.amount",
        });
      }
    }

    const interest = model.rental.expenses.interestOnLoans.amount.value;
    const grossRent = model.rental.grossRent.value;
    if (interest !== null && grossRent !== null && interest > grossRent * LOAN_INTEREST_MAX_MULTIPLE_OF_RENT) {
      issues.push({
        code: "loan-interest-implausible",
        severity: "warning",
        message:
          `Loan interest of $${interest.toFixed(2)} is more than ` +
          `${LOAN_INTEREST_MAX_MULTIPLE_OF_RENT}× the gross rent of $${grossRent.toFixed(2)} — check this figure.`,
        path: "rental.expenses.interestOnLoans.amount",
      });
    }
  }

  // --- No unverified figures left (PRD FR-3, FR-13) ---------------------------
  walkProvenancedFields(model, "", (path, field) => {
    if (
      field.status !== "not-applicable" &&
      field.origin !== null &&
      field.origin.kind === "document" &&
      field.origin.confidence === "unverified"
    ) {
      issues.push({
        code: "unverified-figure",
        severity: "error",
        message: `The figure at "${path}" is unverified — its source could not be located and must be confirmed against the document before it can be relied on.`,
        path,
      });
    }
  });

  // --- No unconfirmed fields (PRD FR-7, FR-13) --------------------------------
  for (const { path, field } of collectInScopeFields(model)) {
    if (field.status === "unset" || field.status === "proposed") {
      issues.push({
        code: "unconfirmed-field",
        severity: "error",
        message: `The field at "${path}" has not been confirmed (or marked nil / not applicable).`,
        path,
      });
    }
  }

  // --- Rental repairs over threshold must be confirmed (PRD Q25, FR-13, FR-24) -
  if (model.rental.present && needsRepairsConfirmation(model.rental)) {
    issues.push({
      code: "rental-repairs-unconfirmed",
      severity: "error",
      message:
        "The rental repairs and maintenance line is over the confirmation threshold and has not " +
        "been confirmed as a genuine repair rather than a capital improvement.",
      path: "rental.expenses.repairsAndMaintenance",
    });
  }

  return issues;
}

/** `true` when `issues` contains at least one `error` — an export-blocking condition (PRD FR-13). */
export function isExportBlocked(issues: readonly ValidationIssue[]): boolean {
  return issues.some((issue) => issue.severity === "error");
}
