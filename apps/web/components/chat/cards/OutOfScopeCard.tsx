"use client";

import { useState } from "react";

import type { OutOfScopeFinding } from "@aus-tax-lodge/scope";

import { deleteReturn } from "../../../app/returns/[returnId]/actions";
import { buttonClassName } from "../../Button";
import { AlertTriangleIcon } from "../../icons";
import type { CardProps } from "./types";

/**
 * The `out-of-scope` card body (PRD FR-9, FR-20, Q12) — the interview's hard
 * stop. Rendered when scope detection (`detectOutOfScope`, run deterministically
 * from a typed answer in `apply-user-turn` or from a document in `scope-check`)
 * returns any finding; the conversation is already `phase:"stopped"` and the
 * composer is gone (`ChatScreen`), so there is nothing to continue.
 *
 * It reuses the visual language of v1's `review/OutOfScopeReviewStop` — danger
 * accent bar, alert icon, serif heading — and offers exactly two things: a
 * pointer to ATO myTax / a registered tax agent, and a "Delete this return"
 * button. There is deliberately **no** override / continue affordance.
 *
 * Defensive: a missing or empty `{ findings }` payload still renders a generic
 * stop message rather than throwing.
 */
const CONFIRM_TEXT =
  "Delete this return? This removes every document and figure under it — it can't be undone.";

function readFindings(raw: unknown): OutOfScopeFinding[] {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const list = Array.isArray(record.findings) ? record.findings : [];
  return list.filter(
    (f): f is OutOfScopeFinding =>
      !!f &&
      typeof f === "object" &&
      typeof (f as { item?: unknown }).item === "string" &&
      typeof (f as { detail?: unknown }).detail === "string",
  );
}

export function OutOfScopeCard({ returnId, turn, readOnly }: CardProps) {
  const findings = readFindings(turn.card.payload);
  const [pending, setPending] = useState(false);

  async function handleDelete() {
    if (!window.confirm(CONFIRM_TEXT)) return;
    setPending(true);
    try {
      await deleteReturn(returnId);
      // `deleteReturn` redirects home on success — the component unmounts.
    } catch {
      setPending(false);
    }
  }

  return (
    <div
      data-card-type="out-of-scope"
      role="alert"
      className="w-full max-w-[600px] overflow-hidden rounded-xl border border-danger bg-surface shadow-card"
    >
      <div className="h-1 bg-danger" aria-hidden="true" />

      <div className="flex items-center gap-3 border-b border-border px-4 py-3 text-danger">
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-danger-soft"
        >
          <AlertTriangleIcon className="size-[18px]" />
        </span>
        <h3 className="text-pretty font-serif text-[15px]">
          I can&rsquo;t take this return further
        </h3>
      </div>

      <div className="px-4 py-4 text-[13px] leading-relaxed">
        {findings.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {findings.map((finding, i) => (
              <li key={`${finding.code}-${i}`}>
                <p className="font-semibold">{finding.item}</p>
                <p className="mt-0.5 text-muted">{finding.detail}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">
            Something in this return is outside what this assistant can prepare, so I have to stop
            here.
          </p>
        )}

        <p className="mb-1.5 mt-4 text-[12.5px] font-semibold">What you can do</p>
        <ul className="list-disc pl-[18px] text-[12.5px] leading-relaxed text-muted">
          <li>Lodge this return yourself in ATO myTax.</li>
          <li>
            Or take it to a registered tax agent — find one at{" "}
            <a href="https://www.tpb.gov.au" target="_blank" rel="noopener noreferrer">
              tpb.gov.au
            </a>
            .
          </li>
        </ul>
        <p className="mt-3 text-[12.5px] text-muted">
          Nothing you&rsquo;ve entered has been sent anywhere.
        </p>
      </div>

      <div className="border-t border-border bg-surface-2 px-4 py-3">
        <button
          type="button"
          onClick={() => void handleDelete()}
          disabled={readOnly || pending}
          className={buttonClassName({ variant: "danger", size: "sm" })}
        >
          {pending ? "Deleting…" : "Delete this return"}
        </button>
      </div>
    </div>
  );
}
