import type { ReactNode } from "react";

import type { ReturnModel } from "@aus-tax-lodge/model";

import { Badge } from "../../../../components/Badge";
import { Card } from "../../../../components/Card";
import { formatIncomeYear } from "../../../../lib/format";
import { describeInterestAccount } from "../../../../lib/questions/form";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 px-5 py-3.5">
      <span className="text-xs font-semibold">{label}</span>
      <span className="text-[13px] text-text">
        {children || <span className="text-muted">—</span>}
      </span>
    </div>
  );
}

function yesNo(value: boolean | null): string {
  if (value == null) return "";
  return value ? "Yes" : "No";
}

/**
 * Read-only rendering of the questionnaire for a return built against a
 * retired tax-parameter set (PRD FR-16) — values only, no inputs, no save
 * action. Reached the same way the editable form is; the page decides which
 * to render based on `loadReturnModel`'s `readOnly` flag.
 */
export function QuestionsReadOnly({
  model,
  targetYear,
}: {
  model: ReturnModel;
  targetYear: string;
}) {
  const q = model.questionnaire;
  const jointAccounts = model.income.interestAccounts.filter(
    (a) => a.ownershipSharePercent.value != null,
  );
  const gate = q.rentalScopeGate.value;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-4 py-3 text-xs text-muted">
        <Badge tone="muted">Lodged — {formatIncomeYear(targetYear)}, read-only</Badge>
        <span>This return was built against a retired tax year and can no longer be edited.</span>
      </div>

      <Card>
        <div className="flex flex-col divide-y divide-border">
          <Row label="Resident for tax purposes, whole year">
            {yesNo(q.residencyFullYear.value)}
          </Row>
          {jointAccounts.map((account) => (
            <Row key={account.id} label={`Your share of ${describeInterestAccount(account)}`}>
              {account.ownershipSharePercent.value != null
                ? `${account.ownershipSharePercent.value}%`
                : ""}
            </Row>
          ))}
          <Row label="Holds a HELP or study/training support loan">
            {yesNo(q.studyLoanHeld.value)}
          </Row>
          <Row label="Private hospital cover">
            {model.context.privateHospitalCoverDays.value != null
              ? `${model.context.privateHospitalCoverDays.value} days`
              : ""}
          </Row>
          <Row label="WFH hours also claimed as a separate expense">
            {q.wfhHoursNotDoubleClaimed.value != null
              ? yesNo(!q.wfhHoursNotDoubleClaimed.value)
              : ""}
          </Row>
          {model.rental.present ? (
            <>
              <Row label="Rental — sole ownership, let all year, no private use">
                {gate
                  ? yesNo(gate.solelyOwned && gate.rentedOrAvailableAllYear && gate.noPrivateUse)
                  : ""}
              </Row>
              <Row label="Rental — bought or sold during the year">
                {gate ? yesNo(!gate.notBoughtOrSoldThisYear) : ""}
              </Row>
            </>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
