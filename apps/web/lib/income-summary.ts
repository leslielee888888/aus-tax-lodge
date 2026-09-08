import type { ReturnModel } from "@aus-tax-lodge/model";

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

function sumFigures(values: readonly (number | null | undefined)[]): number {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}
