import { Badge } from "../../../../components/Badge";
import { Card, CardBody, CardHeader, CardTitle } from "../../../../components/Card";
import type { ReviewData, ReviewRow } from "../../../../lib/review/build-sections";

function statusBadge(status: "unset" | "proposed" | "confirmed" | "not-applicable") {
  if (status === "confirmed") return <Badge tone="ok">Confirmed</Badge>;
  if (status === "not-applicable") return <Badge tone="muted">Not applicable</Badge>;
  if (status === "proposed") return <Badge tone="warn">Proposed, not confirmed</Badge>;
  return <Badge tone="muted">Not entered</Badge>;
}

function readOnlyRow(row: ReviewRow, key: string) {
  switch (row.kind) {
    case "field":
      return (
        <div key={key} className="flex flex-col gap-2 px-5 py-3.5 sm:flex-row sm:items-center sm:gap-4">
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{row.label}</div>
            {row.sublabel ? <div className="mt-0.5 text-[11px] text-muted">{row.sublabel}</div> : null}
          </div>
          <div className="text-left font-mono text-[13px] font-semibold tabular-nums sm:w-28 sm:text-right">
            {row.displayValue}
          </div>
          <div className="sm:w-40">{statusBadge(row.status)}</div>
        </div>
      );
    case "interest-account":
      return (
        <div key={key} className="flex flex-col gap-2 px-5 py-3.5 sm:flex-row sm:items-center sm:gap-4">
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{row.label}</div>
            <div className="mt-0.5 text-[11px] text-muted">{row.sublabel}</div>
          </div>
          <div className="text-left font-mono text-[13px] font-semibold tabular-nums sm:w-28 sm:text-right">
            {row.displayValue}
          </div>
          <div className="sm:w-40">{statusBadge(row.status)}</div>
        </div>
      );
    case "phi-held":
      return (
        <div key={key} className="flex items-center gap-4 px-5 py-3.5">
          <div className="min-w-0 flex-1 font-medium">Held private health cover?</div>
          <div>{statusBadge(row.status)}</div>
        </div>
      );
    case "repairs-gate":
      return (
        <div key={key} className="flex flex-col gap-2 bg-warn-soft px-5 py-3.5 sm:flex-row sm:items-center sm:gap-4">
          <div className="min-w-0 flex-1 font-medium">Repairs and maintenance</div>
          <div className="font-mono text-[13px] font-semibold sm:w-28 sm:text-right">{row.displayValue}</div>
          <Badge tone="warn">Unresolved</Badge>
        </div>
      );
    case "mismatch":
      return (
        <div key={key} className="flex items-center gap-4 bg-danger-soft px-5 py-3.5">
          <div className="min-w-0 flex-1 font-medium">{row.label}</div>
          <Badge tone="danger">Sources disagreed</Badge>
        </div>
      );
    case "computed":
      return (
        <div key={key} className="flex items-center gap-4 border-t-2 border-border px-5 py-3.5">
          <div className="min-w-0 flex-1 font-bold">{row.label}</div>
          <div className="font-mono text-[14px] font-bold tabular-nums text-accent">{row.displayValue}</div>
        </div>
      );
  }
}

/** Values-only rendering of the review step for a return that's read-only under FR-16 — no confirm/edit/mismatch controls. */
export function ReviewReadOnly({ data }: { data: ReviewData }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-4 py-3 text-xs text-muted">
        <Badge tone="muted">Read-only</Badge>
        <span>This return was built against a retired tax year and can no longer be edited.</span>
      </div>
      {data.sections.map((section) => (
        <Card key={section.id}>
          <CardHeader className="justify-between">
            <CardTitle>{section.title}</CardTitle>
          </CardHeader>
          <CardBody className="divide-y divide-border p-0">
            {section.rows.map((row, index) => readOnlyRow(row, `${section.id}-${index}`))}
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
