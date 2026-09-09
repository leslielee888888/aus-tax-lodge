/**
 * Plain-English renderings for the interview prompts (PRD FR-3).
 *
 * {@link renderModelForPrompt} turns a {@link ReturnModel} into the short
 * "here is what the return already holds" block Claude is given each turn. It is
 * a pure function with no secrets: the TFN and the refund bank account are
 * **never** rendered (PRD FR-17, "TFN masked / never in a prompt") —
 * `taxpayer.taxFileNumber` and `taxpayer.refundAccount` are simply omitted
 * (only whether they are settled is mentioned, never their value). T8's final
 * review summary reuses this same function.
 *
 * {@link renderTranscript} renders the last N conversation turns for context.
 */
import {
  apportionedInterest,
  isSettled,
  type Provenanced,
  type ReturnModel,
} from "@aus-tax-lodge/model";

import type { ConversationState, ConversationTurn } from "../conversation";
import { formatIncomeYear } from "../format";

function money(n: number): string {
  return `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** How a single figure reads in the block — value + review state, or "not yet answered". */
function fig(field: Provenanced<number>, opts: { money?: boolean } = {}): string {
  if (field.value == null) {
    return field.status === "not-applicable" ? "nil" : "not yet answered";
  }
  const shown = opts.money ? money(field.value) : String(field.value);
  const settled = isSettled(field) ? "" : " (proposed, unconfirmed)";
  return `${shown}${settled}`;
}

function yesNo(field: Provenanced<boolean>): string {
  if (field.value == null) return "not yet answered";
  return field.value ? "yes" : "no";
}

/** The plain-English "what the return already holds" block (PRD FR-3). Pure; no TFN. */
export function renderModelForPrompt(model: ReturnModel): string {
  const lines: string[] = [];
  lines.push(`Return for the ${formatIncomeYear(model.targetYear)} income year.`);

  // --- Taxpayer identity (PRD FR-1, FR-17) --------------------------------
  // Deliberately omits `taxFileNumber` and `refundAccount` — those never
  // appear in a prompt (PRD FR-17); the secure `identity` card handles them.
  const t = model.taxpayer;
  lines.push("", "TAXPAYER");
  lines.push(`- Full name: ${t.fullName.value ?? "not yet answered"}`);
  lines.push(`- Date of birth: ${t.dateOfBirth.value ?? "not yet answered"}`);
  lines.push(
    `- Postal address: ${t.postalAddress.value ? "on file" : "not yet answered"}` +
      `; TFN + refund account: ${
        isSettled(t.taxFileNumber) && isSettled(t.refundAccount)
          ? "on file (secure card)"
          : "not yet provided (raised via a secure card, never in chat)"
      }`,
  );

  // --- Income ------------------------------------------------------------
  lines.push("", "INCOME");
  if (model.income.salaryWages.length === 0) {
    lines.push("- Salary/wages: none on file yet");
  } else {
    for (const e of model.income.salaryWages) {
      lines.push(
        `- Salary from ${e.payerName.value ?? "an employer"}: ${fig(e.grossSalaryWages, {
          money: true,
        })} gross, ${fig(e.paygWithheld, { money: true })} PAYG withheld`,
      );
    }
  }
  for (const a of model.income.interestAccounts) {
    lines.push(
      `- Interest — ${a.institution.value ?? "account"} ${a.id}: ${fig(a.grossInterest, {
        money: true,
      })} gross, ownership share ${fig(a.ownershipSharePercent)}%` +
        (a.grossInterest.value != null && a.ownershipSharePercent.value != null
          ? ` (your share ${money(apportionedInterest(a))})`
          : ""),
    );
  }
  for (const d of model.income.dividends) {
    lines.push(
      `- Dividends — ${d.company.value ?? "holding"} ${d.id}: unfranked ${fig(d.unfranked, {
        money: true,
      })}, franked ${fig(d.franked, { money: true })}, franking credits ${fig(d.frankingCredits, {
        money: true,
      })}`,
    );
  }
  lines.push(
    `- Taxable government allowances: ${fig(model.income.governmentAllowances, { money: true })}`,
  );
  lines.push(
    `- Reportable fringe benefits: ${fig(model.income.reportableFringeBenefits, { money: true })}`,
  );
  lines.push(
    `- Reportable employer super: ${fig(model.income.reportableEmployerSuper, { money: true })}`,
  );

  // --- Deductions ------------------------------------------------------
  lines.push("", "DEDUCTIONS");
  const d = model.deductions;
  lines.push(`- Work-related car (cents/km): ${fig(d.workRelatedCar.amount, { money: true })}`);
  lines.push(`- Work-related travel: ${fig(d.workRelatedTravel.amount, { money: true })}`);
  lines.push(`- Clothing / laundry: ${fig(d.workRelatedClothing.amount, { money: true })}`);
  lines.push(`- Self-education: ${fig(d.selfEducation.amount, { money: true })}`);
  lines.push(`- Other work-related: ${fig(d.otherWorkRelated.amount, { money: true })}`);
  lines.push(
    `- Working from home (fixed rate): ${fig(d.workFromHome.amount, { money: true })}` +
      (d.workFromHome.hours.value != null ? `, ${d.workFromHome.hours.value} hours recorded` : ""),
  );
  lines.push(`- Gifts / donations to DGRs: ${fig(d.giftsAndDonations.amount, { money: true })}`);
  lines.push(
    `- Cost of managing tax affairs: ${fig(d.costOfManagingTaxAffairs.amount, { money: true })}`,
  );

  // --- The FR-6 facts -------------------------------------------------
  lines.push("", "FACTS");
  lines.push(
    `- Australian resident for the full year: ${yesNo(model.questionnaire.residencyFullYear)}`,
  );
  lines.push(
    `- Holds a study/training support (HELP) loan: ${yesNo(model.context.holdsStudyLoan)}`,
  );
  lines.push(`- Days of private hospital cover: ${fig(model.context.privateHospitalCoverDays)}`);
  lines.push(`- Dependent children: ${fig(model.context.dependentChildren)}`);
  lines.push(
    `- WFH hours not also claimed as a separate expense: ${yesNo(
      model.questionnaire.wfhHoursNotDoubleClaimed,
    )}`,
  );
  lines.push(
    `- Ownership share supplied for every joint account: ${yesNo(
      model.questionnaire.jointAccountSharesProvided,
    )}`,
  );
  const spouse = model.context.spouse;
  if (spouse.status.value === "had-spouse") {
    lines.push(
      `- Spouse: ${spouse.name.value ?? "name not given"}, DOB ${spouse.dateOfBirth.value ?? "?"}, ` +
        `estimated taxable income ${fig(spouse.estimatedTaxableIncome, { money: true })} (estimated), ` +
        `${fig(spouse.privateHospitalCoverDays)} days private cover`,
    );
  } else {
    lines.push(`- Spouse: ${spouse.status.value === "none" ? "none" : "not yet answered"}`);
  }
  const phi = model.privateHealth;
  lines.push(`- Private health cover held: ${yesNo(phi.held)}`);
  if (phi.held.value === true) {
    lines.push(
      `  premiums eligible for rebate ${fig(phi.premiumsEligibleForRebate, { money: true })}, ` +
        `rebate received ${fig(phi.rebateReceived, { money: true })}, ` +
        `oldest covered person age ${fig(phi.oldestCoveredPersonAge)}, ${fig(phi.coverDays)} days`,
    );
  }

  // --- Rental --------------------------------------------------------
  if (model.rental.present) {
    const p = model.rental.property;
    lines.push("", "RENTAL (present)");
    lines.push(
      `- Property address: ${p.addressLine1.value ?? "not yet answered"}` +
        (p.suburb.value || p.state.value || p.postcode.value
          ? ` ${[p.suburb.value, p.state.value, p.postcode.value].filter(Boolean).join(" ")}`
          : ""),
    );
    lines.push(
      `- Date the property first earned rental income: ${p.firstEarnedIncomeOn.value ?? "not yet answered"}`,
    );
    lines.push(`- Gross rent: ${fig(model.rental.grossRent, { money: true })}`);
    lines.push("- Expense line items are gathered separately (see the rental topic).");
  } else {
    lines.push("", "RENTAL: none declared yet");
  }

  return lines.join("\n");
}

const TURN_LIMIT = 15;

/** The last {@link TURN_LIMIT} turns rendered as `ROLE: text`, oldest first. */
export function renderTranscript(conversation: ConversationState): string {
  const recent = conversation.turns.slice(-TURN_LIMIT);
  if (recent.length === 0) return "(no messages yet)";
  return recent.map(renderTurn).join("\n");
}

function renderTurn(turn: ConversationTurn): string {
  switch (turn.kind) {
    case "message":
      return `${turn.role.toUpperCase()}: ${turn.text}`;
    case "card":
      return `ASSISTANT [card: ${turn.card.type}]`;
    case "file":
      return `USER [uploaded: ${turn.filename}]`;
    case "card-response":
      return `USER [responded to card ${turn.cardId}]`;
  }
}
