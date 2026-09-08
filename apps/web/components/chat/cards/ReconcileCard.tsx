"use client";

import { useId, useMemo, useState } from "react";

import type { PendingReconciliation } from "@aus-tax-lodge/extraction";

import { resolveReconcile } from "../../../app/returns/[returnId]/actions";
import { CheckIcon } from "../../icons";
import type { CardProps } from "./types";

/**
 * The `reconcile` card (PRD FR-7) — two sources give different values for the
 * same figure, and only the user decides which is right. Names **both** values
 * and where each came from, and asks for an explicit pick — no value is
 * pre-selected and none is shown as "recommended". Until it is resolved the
 * figure blocks progress, exactly like a pending confirmation (the interview's
 * deterministic short-circuit re-raises this card every turn).
 *
 * On a pick, {@link resolveReconcile} runs `resolveReconciliation` server-side:
 * the chosen candidate's value is `propose()`d against its own document origin
 * (still confirmed later like any figure) and the entry leaves the scratch.
 */
interface Payload {
  readonly lead?: string;
  readonly reconciliation: PendingReconciliation | null;
}

type Phase = "idle" | "submitting" | "done" | "error";

function readPayload(raw: unknown): Payload {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const r = record.reconciliation;
  const reconciliation =
    r &&
    typeof r === "object" &&
    typeof (r as PendingReconciliation).modelPath === "string" &&
    Array.isArray((r as PendingReconciliation).candidates)
      ? (r as PendingReconciliation)
      : null;
  return { lead: typeof record.lead === "string" ? record.lead : undefined, reconciliation };
}

function sourceLabel(documentType: string, page: number): string {
  if (documentType === "ato-prefill-report") return "Your pre-fill report";
  const name = documentType.replace(/-/g, " ");
  return page > 0 ? `The ${name} you added (p.${page})` : `The ${name} you added`;
}

function formatValue(value: number | string): string {
  return typeof value === "number"
    ? value.toLocaleString("en-AU", {
        style: "currency",
        currency: "AUD",
        maximumFractionDigits: 2,
      })
    : value;
}

export function ReconcileCard({ returnId, revision, turn, readOnly, onResult }: CardProps) {
  const { lead, reconciliation } = useMemo(
    () => readPayload(turn.card.payload),
    [turn.card.payload],
  );
  const groupName = useId();

  const [phase, setPhase] = useState<Phase>("idle");
  const [choice, setChoice] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const busy = phase === "submitting";
  const disabled = readOnly || busy || phase === "done";

  async function submit() {
    if (reconciliation == null || choice == null) {
      setMessage("Pick which value is right to continue.");
      setPhase("error");
      return;
    }
    setMessage(null);
    setPhase("submitting");
    try {
      const result = await resolveReconcile(
        returnId,
        revision,
        turn.id,
        reconciliation.modelPath,
        choice,
      );
      onResult({ conversation: result.conversation, revision: result.revision });
      if (result.error) {
        setPhase("error");
        setMessage(result.error);
        return;
      }
      setPhase("done");
    } catch {
      setPhase("error");
      setMessage("Something went wrong saving that — try again.");
    }
  }

  return (
    <div
      data-card-type="reconcile"
      className="w-full max-w-[600px] overflow-hidden rounded-xl border border-border bg-surface shadow-card"
    >
      <h3 className="border-b border-border px-4 py-3 font-serif text-[15px]">
        Two sources disagree — which is right?
      </h3>

      <div className="px-4 py-4">
        {lead ? <p className="mb-3 text-[13px]">{lead}</p> : null}

        {!reconciliation || reconciliation.candidates.length === 0 ? (
          <p className="text-[13px] text-muted">
            There&apos;s nothing left to reconcile here — carry on in the chat.
          </p>
        ) : (
          <>
            <fieldset className="flex flex-col gap-2" disabled={disabled}>
              <legend className="mb-1 text-[12.5px] text-muted">
                Choose the value to use. Nothing is pre-selected.
              </legend>
              {reconciliation.candidates.map((candidate, index) => (
                <label
                  key={`${candidate.docId}-${index}`}
                  className="flex items-start gap-2 rounded-lg border border-border px-3 py-2 text-[13px]"
                >
                  <input
                    type="radio"
                    name={groupName}
                    value={index}
                    checked={choice === index}
                    onChange={() => setChoice(index)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium tabular-nums">{formatValue(candidate.value)}</span>{" "}
                    — {sourceLabel(candidate.documentType, candidate.page)}
                    {candidate.snippet ? (
                      <span className="mt-0.5 block text-[12px] text-muted">
                        “{candidate.snippet}”
                      </span>
                    ) : null}
                  </span>
                </label>
              ))}
            </fieldset>

            {message ? (
              <p role="alert" className="mt-3 text-[12.5px] font-medium text-danger">
                {message}
              </p>
            ) : null}

            {phase === "done" ? (
              <p className="mt-3 inline-flex items-center gap-2 text-[12.5px] font-medium text-ok">
                <span
                  aria-hidden="true"
                  className="flex size-4 items-center justify-center rounded-full bg-ok text-white"
                >
                  <CheckIcon className="size-2.5" />
                </span>
                Recorded.
              </p>
            ) : (
              <div className="mt-4">
                <button
                  type="button"
                  disabled={disabled || choice == null}
                  onClick={() => void submit()}
                  className="rounded-lg bg-accent px-3 py-2 text-[13px] font-medium text-accent-ink disabled:opacity-60"
                >
                  {busy ? "Saving…" : "Use this value"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
