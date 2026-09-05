import type { ReactNode } from "react";

import type { ReturnModel } from "@aus-tax-lodge/model";

import { Badge } from "../../../../components/Badge";
import { Card, CardBody, CardHeader, CardTitle } from "../../../../components/Card";
import { formatIncomeYear } from "../../../../lib/format";

function Value({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold">{label}</span>
      <span className="text-[13px] text-text">{children || <span className="text-muted">—</span>}</span>
    </div>
  );
}

function maskTfnForDisplay(tfn: string | null): string {
  if (!tfn) return "";
  const last3 = tfn.slice(-3);
  return `••• ••• ${last3}`;
}

/**
 * Read-only rendering of the details step for a return built against a
 * retired tax-parameter set (PRD FR-16) — values only, no inputs, no save
 * action. Reached the same way the editable form is; the page decides which
 * to render based on `loadReturnModel`'s `readOnly` flag.
 */
export function DetailsReadOnly({ model, targetYear }: { model: ReturnModel; targetYear: string }) {
  const t = model.taxpayer;
  const c = model.context;
  const address = t.postalAddress.value;
  const account = t.refundAccount.value;
  const hasSpouse = c.spouse.status.value === "had-spouse";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-4 py-3 text-xs text-muted">
        <Badge tone="muted">Lodged — {formatIncomeYear(targetYear)}, read-only</Badge>
        <span>This return was built against a retired tax year and can no longer be edited.</span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Identity &amp; refund</CardTitle>
        </CardHeader>
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Value label="Full name">{t.fullName.value}</Value>
          <Value label="Date of birth">{t.dateOfBirth.value}</Value>
          <Value label="Postal address">
            {address
              ? [address.line1, address.line2, address.suburb, address.state, address.postcode]
                  .filter(Boolean)
                  .join(", ")
              : ""}
          </Value>
          <Value label="Tax file number">{maskTfnForDisplay(t.taxFileNumber.value)}</Value>
          <Value label="Residency for tax purposes">
            {c.residency.value === "resident-full-year"
              ? "Resident for the full year"
              : "Not a resident / part-year"}
          </Value>
          <Value label="Refund account">
            {account ? `${account.bsb} · ${account.accountNumber} · ${account.accountName}` : ""}
          </Value>
          <Value label="Study or training support loan">
            {c.holdsStudyLoan.value ? "Yes" : "No"}
          </Value>
          <Value label="Days held private hospital cover">
            {c.privateHospitalCoverDays.value != null ? String(c.privateHospitalCoverDays.value) : ""}
          </Value>
          <Value label="Dependent children">
            {c.dependentChildren.value != null ? String(c.dependentChildren.value) : ""}
          </Value>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Spouse</CardTitle>
        </CardHeader>
        <CardBody className="grid gap-4 sm:grid-cols-2">
          {hasSpouse ? (
            <>
              <Value label="Spouse name">{c.spouse.name.value}</Value>
              <Value label="Spouse date of birth">{c.spouse.dateOfBirth.value}</Value>
              <Value label="Spouse taxable income (estimated)">
                {c.spouse.estimatedTaxableIncome.value != null
                  ? `$${c.spouse.estimatedTaxableIncome.value.toLocaleString("en-AU")}`
                  : ""}
              </Value>
              <Value label="Days spouse held private hospital cover">
                {c.spouse.privateHospitalCoverDays.value != null
                  ? String(c.spouse.privateHospitalCoverDays.value)
                  : ""}
              </Value>
            </>
          ) : (
            <p className="text-xs text-muted sm:col-span-2">No spouse for this return.</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
