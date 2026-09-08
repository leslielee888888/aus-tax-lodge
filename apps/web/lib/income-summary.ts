import { confirm, isSettled, type Provenanced, type ReturnModel } from "@aus-tax-lodge/model";

/**
 * A plain-English recap of the income the ATO pre-fill report seeded into the
 * return (PRD FR-2, FR-5). Built **only from the model** — never from Claude —
 * so the assistant's first message after the upload never states a figure the
 * model doesn't already hold (PRD FR-3, "LLM boundary").
 *
 * Covers what a pre-fill report carries: salary and PAYG withheld per payer,
 * taxable government payments, gross bank interest, dividends (with franking
 * credits), the private-health statement, and the HELP-loan indicator. T5's
 * income-checkpoint card confirms these line by line; this is just the lead-in.
 */
export function summariseIncomeFound(model: ReturnModel): string {
  const lines: string[] = [];

  for (const employer of model.income.salaryWages) {
    const gross = employer.grossSalaryWages.value;
    if (gross == null) continue;
    const payer = employer.payerName.value?.trim() || "an employer";
    const payg = employer.paygWithheld.value;
    lines.push(
      payg != null
        ? `${money(gross)} salary from ${payer} (${money(payg)} tax withheld)`
        : `${money(gross)} salary from ${payer}`,
    );
  }

  const govPayments = model.income.governmentAllowances.value;
  if (govPayments != null && govPayments > 0) {
    lines.push(`${money(govPayments)} in taxable government payments`);
  }

  const interest = sumFigures(model.income.interestAccounts.map((a) => a.grossInterest.value));
  if (interest > 0) {
    lines.push(`${money(interest)} in gross bank interest`);
  }

  const dividends = sumFigures(
    model.income.dividends.flatMap((d) => [d.unfranked.value, d.franked.value]),
  );
  const frankingCredits = sumFigures(model.income.dividends.map((d) => d.frankingCredits.value));
  if (dividends > 0) {
    lines.push(
      frankingCredits > 0
        ? `${money(dividends)} in dividends, with ${money(frankingCredits)} of franking credits`
        : `${money(dividends)} in dividends`,
    );
  }

  if (model.privateHealth.held.value === true) {
    lines.push("your private health insurance statement");
  }

  if (model.context.holdsStudyLoan.value === true) {
    lines.push("a HELP / study loan balance");
  }

  if (lines.length === 0) {
    return (
      "I've read your pre-fill report, but I couldn't pull any income figures from it — " +
      "it may be an early copy that isn't populated yet. We can go through your income together instead."
    );
  }

  return (
    "Here's what I read from your pre-fill report:\n" +
    lines.map((line) => `• ${line}`).join("\n") +
    "\n\nLet's check that's right and then fill in the rest."
  );
}

function money(value: number): string {
  return `$${value.toLocaleString("en-AU", { maximumFractionDigits: 2 })}`;
}

// ---------------------------------------------------------------------------
// The income-checkpoint card (PRD FR-5, Q2 = B)
// ---------------------------------------------------------------------------

/**
 * One row of the income-checkpoint card. `modelPath` is the dot/bracket path of
 * the underlying figure (matching `@aus-tax-lodge/validation`'s
 * `collectInScopeFields`), so a "Something's off" correction can be applied to
 * exactly the right field.
 */
export interface IncomeLine {
  readonly modelPath: string;
  readonly label: string;
  readonly value: number;
  readonly sublabel?: string;
}

/**
 * Every income figure the pre-fill report seeded, as card rows (PRD FR-5): a
 * salary + PAYG line per payer, taxable government payments, gross interest per
 * account, and dividends + franking credits per holding. Built **only from the
 * model** — the same LLM boundary {@link summariseIncomeFound} keeps.
 */
export function incomeCheckpointLines(model: ReturnModel): IncomeLine[] {
  const lines: IncomeLine[] = [];
  const push = (
    modelPath: string,
    label: string,
    value: number | null,
    sublabel?: string,
  ): void => {
    if (value == null) return;
    lines.push(sublabel ? { modelPath, label, value, sublabel } : { modelPath, label, value });
  };

  model.income.salaryWages.forEach((employer, i) => {
    const payer = employer.payerName.value?.trim() || `Employer ${i + 1}`;
    push(
      `income.salaryWages[${i}].grossSalaryWages`,
      "Salary & wages",
      employer.grossSalaryWages.value,
      payer,
    );
    push(
      `income.salaryWages[${i}].paygWithheld`,
      "PAYG tax withheld",
      employer.paygWithheld.value,
      payer,
    );
  });

  push(
    "income.governmentAllowances",
    "Taxable government payments",
    model.income.governmentAllowances.value,
  );

  model.income.interestAccounts.forEach((account, i) => {
    const institution = account.institution.value?.trim() || `Account ${i + 1}`;
    push(
      `income.interestAccounts[${i}].grossInterest`,
      "Gross interest",
      account.grossInterest.value,
      institution,
    );
  });

  model.income.dividends.forEach((holding, i) => {
    const company = holding.company.value?.trim() || `Holding ${i + 1}`;
    const unfranked = holding.unfranked.value;
    const franked = holding.franked.value;
    if (unfranked != null || franked != null) {
      push(
        `income.dividends[${i}].franked`,
        "Dividends",
        (unfranked ?? 0) + (franked ?? 0),
        company,
      );
    }
    if ((holding.frankingCredits.value ?? 0) > 0) {
      push(
        `income.dividends[${i}].frankingCredits`,
        "Franking credits",
        holding.frankingCredits.value,
        company,
      );
    }
  });

  return lines;
}

/** `confirm()` every still-`proposed` {@link Provenanced} figure inside `model.income` (PRD FR-5 "Looks right"). */
export function confirmProposedIncome(model: ReturnModel): ReturnModel {
  return { ...model, income: confirmProposedDeep(model.income) };
}

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

function confirmProposedDeep<T>(node: T): T {
  if (node === null || typeof node !== "object") return node;
  if (isProvenanced(node)) {
    return (node.status === "proposed" && !isSettled(node) ? confirm(node) : node) as T;
  }
  if (Array.isArray(node)) return node.map((item) => confirmProposedDeep(item)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    out[key] = confirmProposedDeep(value);
  }
  return out as T;
}

function sumFigures(values: readonly (number | null | undefined)[]): number {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}
