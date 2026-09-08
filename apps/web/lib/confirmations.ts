/**
 * The deterministic "which figures are doubtful?" rule (PRD FR-5, Q2 = option B).
 *
 * Between the two confirmation checkpoints the assistant is silent on a
 * `high`-confidence pre-fill figure but checks — with a `confirm-figure` card —
 * any figure that is:
 *
 * - proposed from a document at `medium` / `low` / `unverified` confidence
 *   (v1 FR-3), or
 * - named by a `validateReturn` warning or error (a real plausibility /
 *   correctness problem — the "you haven't confirmed this yet" bookkeeping
 *   errors are excluded), or
 * - one the user typed or corrected in the chat (the `Provenanced` field has an
 *   edit trail).
 *
 * {@link collectPendingConfirmations} is pure and takes the `validateReturn`
 * result explicitly so it is trivially unit-testable;
 * {@link recomputePendingConfirmations} is the convenience the interview loop
 * calls after every model change, merging the previous list so a confirmation
 * the user already resolved stays resolved.
 *
 * The field vocabulary is `@aus-tax-lodge/validation`'s
 * {@link collectInScopeFields} — the same in-scope enumeration the export gate
 * uses — never a hand walk of the model.
 */
import { confirm, edit, type Provenanced, type ReturnModel } from "@aus-tax-lodge/model";
import {
  collectInScopeFields,
  validateReturn,
  type ValidationIssue,
} from "@aus-tax-lodge/validation";

import type { ConfirmationReason, PendingConfirmation } from "./conversation";

/**
 * `validateReturn` codes that only mean "not confirmed / not supplied yet" —
 * every in-scope field carries one mid-interview, so they must NOT drive a
 * `confirm-figure` card (that would flag every figure and defeat proportionate
 * confirmation, PRD FR-5). A genuine plausibility / correctness issue
 * (`franking-credit-implausible`, `payg-withheld-implausible`, `negative-amount`,
 * `tfn-invalid`, …) still counts.
 */
const BOOKKEEPING_CODES = new Set(["unconfirmed-field", "mandatory-label-missing"]);

/** Document-origin confidence levels that are not trusted silently (v1 FR-3). */
const DOUBTFUL_CONFIDENCE = new Set(["medium", "low", "unverified"]);

/**
 * The flag reason for one in-scope field, or `null` when it is trusted silently.
 * `namedPaths` is every `validateReturn` issue path that is not bookkeeping.
 */
function reasonForField(
  field: Provenanced<unknown>,
  path: string,
  namedPaths: readonly string[],
): ConfirmationReason | null {
  if (field.edits.length > 0) return "user-corrected";

  const origin = field.origin;
  if (origin && origin.kind === "document" && DOUBTFUL_CONFIDENCE.has(origin.confidence)) {
    return "low-confidence";
  }

  const named = namedPaths.some(
    (p) => p === path || path.startsWith(`${p}.`) || path.startsWith(`${p}[`),
  );
  return named ? "plausibility" : null;
}

/**
 * The doubtful figures on `model`, given a `validateReturn` result. Pure — the
 * `resolved` flag is always `false` here; {@link mergePendingConfirmations}
 * carries a prior resolution forward.
 *
 * Only figures with a numeric value are returned (a `PendingConfirmation.value`
 * is `number | null`); a doubtful non-numeric field — e.g. a low-confidence
 * payer name — is left to T8's final review.
 */
export function collectPendingConfirmations(
  model: ReturnModel,
  validation: readonly ValidationIssue[],
): PendingConfirmation[] {
  const namedPaths = validation
    .filter(
      (issue): issue is ValidationIssue & { path: string } =>
        typeof issue.path === "string" && !BOOKKEEPING_CODES.has(issue.code),
    )
    .map((issue) => issue.path);

  const out: PendingConfirmation[] = [];
  for (const { path, field } of collectInScopeFields(model)) {
    if (typeof field.value !== "number") continue;
    const reason = reasonForField(field, path, namedPaths);
    if (!reason) continue;
    out.push({
      id: `pc:${path}`,
      modelPath: path,
      label: labelForPath(model, path),
      value: field.value,
      source: sourceForField(field),
      reason,
      resolved: false,
    });
  }
  return out;
}

/**
 * Carry a resolved confirmation forward across a recompute: a `fresh` entry
 * whose figure the user already confirmed / corrected (matched by `modelPath`)
 * stays `resolved`.
 */
export function mergePendingConfirmations(
  previous: readonly PendingConfirmation[],
  fresh: readonly PendingConfirmation[],
): PendingConfirmation[] {
  const resolvedPaths = new Set(previous.filter((c) => c.resolved).map((c) => c.modelPath));
  return fresh.map((c) => (resolvedPaths.has(c.modelPath) ? { ...c, resolved: true } : c));
}

/**
 * Recompute the pending confirmations for `model` and merge the prior list's
 * resolutions in. Called wherever the interview loop updates and saves the
 * model. Defensive: a model shape `validateReturn` chokes on yields the
 * previous list unchanged rather than throwing.
 */
export function recomputePendingConfirmations(
  model: ReturnModel,
  previous: readonly PendingConfirmation[],
): PendingConfirmation[] {
  try {
    return mergePendingConfirmations(
      previous,
      collectPendingConfirmations(model, validateReturn(model)),
    );
  } catch {
    return [...previous];
  }
}

/** The first still-unresolved confirmation, or `null`. */
export function firstUnresolvedConfirmation(
  confirmations: readonly PendingConfirmation[],
): PendingConfirmation | null {
  return confirmations.find((c) => !c.resolved) ?? null;
}

// ---------------------------------------------------------------------------
// Applying a resolution to the model
// ---------------------------------------------------------------------------

function isProvenanced(value: unknown): value is Provenanced<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "status" in value &&
    "origin" in value &&
    "proposedValue" in value &&
    Array.isArray((value as { edits?: unknown }).edits)
  );
}

function parsePath(path: string): (string | number)[] {
  const segments: (string | number)[] = [];
  for (const part of path.split(".")) {
    const match = /^([^[\]]+)((?:\[\d+\])*)$/.exec(part);
    if (!match) {
      segments.push(part);
      continue;
    }
    segments.push(match[1]!);
    for (const idx of match[2]!.matchAll(/\[(\d+)\]/g)) {
      segments.push(Number(idx[1]));
    }
  }
  return segments;
}

/**
 * Immutably replace the {@link Provenanced} field at a dot/bracket `path`
 * (`income.interestAccounts[0].grossInterest`) with `fn(field)`, returning a new
 * model. Throws when the path does not resolve to a `Provenanced` leaf — a
 * caller handing an off-list path is a bug, not user input.
 */
export function updateFieldAtPath(
  model: ReturnModel,
  path: string,
  fn: (field: Provenanced<unknown>) => Provenanced<unknown>,
): ReturnModel {
  const segments = parsePath(path);

  const recurse = (node: unknown, depth: number): unknown => {
    if (depth === segments.length) {
      if (!isProvenanced(node)) {
        throw new Error(`confirmations: "${path}" is not a Provenanced field`);
      }
      return fn(node);
    }
    const seg = segments[depth]!;
    if (Array.isArray(node)) {
      if (typeof seg !== "number" || node[seg] === undefined) {
        throw new Error(`confirmations: "${path}" — no array item at [${String(seg)}]`);
      }
      return node.map((item, i) => (i === seg ? recurse(item, depth + 1) : item));
    }
    if (typeof node !== "object" || node === null || !(seg in node)) {
      throw new Error(`confirmations: "${path}" — no "${String(seg)}" on the model`);
    }
    return {
      ...(node as Record<string, unknown>),
      [seg]: recurse((node as Record<string, unknown>)[seg as string], depth + 1),
    };
  };

  return recurse(model, 0) as ReturnModel;
}

/** `confirm()` the figure at `path` (PRD FR-5 "Yes"). */
export function confirmFieldAtPath(model: ReturnModel, path: string): ReturnModel {
  return updateFieldAtPath(model, path, (field) => confirm(field));
}

/**
 * `edit()` the figure at `path` to `value` (PRD FR-5 "Edit"): user provenance,
 * the original kept as `proposedValue`, the change recorded in `edits`.
 */
export function editFieldAtPath(model: ReturnModel, path: string, value: number): ReturnModel {
  return updateFieldAtPath(model, path, (field) => edit(field as Provenanced<number>, value));
}

// ---------------------------------------------------------------------------
// Labels + sources
// ---------------------------------------------------------------------------

const FIXED_LABELS: Readonly<Record<string, string>> = {
  "income.governmentAllowances": "Taxable government payments",
  "income.reportableFringeBenefits": "Reportable fringe benefits",
  "income.reportableEmployerSuper": "Reportable employer super",
  "context.privateHospitalCoverDays": "Days of private hospital cover",
  "context.dependentChildren": "Dependent children",
  "context.spouse.estimatedTaxableIncome": "Spouse's estimated taxable income",
  "privateHealth.premiumsEligibleForRebate": "Private health premiums eligible for rebate",
  "privateHealth.rebateReceived": "Private health rebate received",
  "privateHealth.coverDays": "Days of private health cover",
};

function prettify(text: string): string {
  const spaced = text.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[._]/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** A plain-English name for a flagged figure, e.g. `"Gross interest — Southbank Mutual"`. */
export function labelForPath(model: ReturnModel, path: string): string {
  let match = /^income\.salaryWages\[(\d+)\]\.(grossSalaryWages|paygWithheld)$/.exec(path);
  if (match) {
    const payer =
      model.income.salaryWages[Number(match[1])]?.payerName.value?.trim() ||
      `employer ${Number(match[1]) + 1}`;
    return `${match[2] === "grossSalaryWages" ? "Salary" : "PAYG withheld"} — ${payer}`;
  }

  match =
    /^income\.interestAccounts\[(\d+)\]\.(grossInterest|tfnAmountsWithheld|ownershipSharePercent)$/.exec(
      path,
    );
  if (match) {
    const institution =
      model.income.interestAccounts[Number(match[1])]?.institution.value?.trim() ||
      `account ${Number(match[1]) + 1}`;
    const which = {
      grossInterest: "Gross interest",
      tfnAmountsWithheld: "TFN amounts withheld from interest",
      ownershipSharePercent: "Account ownership share",
    }[match[2]!]!;
    return `${which} — ${institution}`;
  }

  match =
    /^income\.dividends\[(\d+)\]\.(unfranked|franked|frankingCredits|tfnAmountsWithheld)$/.exec(
      path,
    );
  if (match) {
    const company =
      model.income.dividends[Number(match[1])]?.company.value?.trim() ||
      `holding ${Number(match[1]) + 1}`;
    const which = {
      unfranked: "Unfranked dividends",
      franked: "Franked dividends",
      frankingCredits: "Franking credits",
      tfnAmountsWithheld: "TFN amounts withheld from dividends",
    }[match[2]!]!;
    return `${which} — ${company}`;
  }

  if (FIXED_LABELS[path]) return FIXED_LABELS[path]!;

  match = /^deductions\.([a-zA-Z]+)\.amount$/.exec(path);
  if (match) return `${prettify(match[1]!)} deduction`;

  return prettify(path);
}

/** Where a flagged figure came from, in plain English (PRD FR-5). */
function sourceForField(field: Provenanced<unknown>): string {
  if (field.edits.length > 0) return "the correction you made";
  const origin = field.origin;
  if (!origin) return "the return so far";
  if (origin.kind === "user-answer") return "what you told me";
  if (origin.kind === "computed") return "a figure worked out from your other answers";
  // T6 adds mid-conversation documents; until then the only document is the
  // pre-fill report, so this is accurate for v2's first build.
  return "your pre-fill report";
}
