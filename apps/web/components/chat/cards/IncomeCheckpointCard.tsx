"use client";

import { useId, useMemo, useState } from "react";

import { confirmIncome, correctIncome } from "../../../app/returns/[returnId]/actions";
import { CheckIcon } from "../../icons";
import type { IncomeLine } from "../../../lib/income-summary";
import type { CardProps } from "./types";

/**
 * The income-checkpoint card (PRD FR-5, Q2 = B) — the interview's first turn.
 * Renders every income figure the pre-fill report seeded (from
 * `turn.card.payload.lines`, built server-side by `incomeCheckpointLines`) and
 * asks for one confirmation:
 *
 * - **Looks right** → {@link confirmIncome} bulk-confirms every proposed income
 *   figure and the interview carries on.
 * - **Something's off** → expands to a value per line; changed lines are
 *   `edit()`ed (original kept visible) via {@link correctIncome} and land
 *   `user-corrected` in `pendingConfirmations` for the final review.
 */
interface Payload {
  readonly lead?: string;
  readonly lines: readonly IncomeLine[];
}

type Phase = "idle" | "editing" | "submitting" | "done" | "error";

function readPayload(raw: unknown): Payload {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const lines = Array.isArray(record.lines)
    ? (record.lines as unknown[]).filter(
        (l): l is IncomeLine =>
          !!l &&
          typeof l === "object" &&
          typeof (l as IncomeLine).modelPath === "string" &&
          typeof (l as IncomeLine).label === "string" &&
          typeof (l as IncomeLine).value === "number",
      )
    : [];
  return { lead: typeof record.lead === "string" ? record.lead : undefined, lines };
}

function formatMoney(value: number): string {
  return value.toLocaleString("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 2,
  });
}

export function IncomeCheckpointCard({ returnId, revision, turn, readOnly, onResult }: CardProps) {
  const { lead, lines } = useMemo(() => readPayload(turn.card.payload), [turn.card.payload]);
  const fieldId = useId();

  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const busy = phase === "submitting";
  const disabled = readOnly || busy || phase === "done";

  function handleResult(result: Awaited<ReturnType<typeof confirmIncome>>) {
    onResult({ conversation: result.conversation, revision: result.revision });
    if (result.error) {
      setPhase("error");
      setMessage(result.error);
      return;
    }
    setPhase("done");
  }

  async function onLooksRight() {
    setMessage(null);
    setPhase("submitting");
    try {
      handleResult(await confirmIncome(returnId, revision, turn.id));
    } catch {
      setPhase("error");
      setMessage("Something went wrong saving that — try again.");
    }
  }

  async function onSubmitCorrections() {
    const corrections = lines
      .map((line) => {
        const draft = drafts[line.modelPath];
        if (draft === undefined) return null;
        const value = Number(draft.replace(/[$,\s]/g, ""));
        if (!Number.isFinite(value) || value === line.value) return null;
        return { modelPath: line.modelPath, value };
      })
      .filter((c): c is { modelPath: string; value: number } => c !== null);

    setMessage(null);
    setPhase("submitting");
    try {
      handleResult(await correctIncome(returnId, revision, turn.id, corrections));
    } catch {
      setPhase("error");
      setMessage("Something went wrong saving that — try again.");
    }
  }

  return (
    <div
      data-card-type="income-checkpoint"
      className="w-full max-w-[600px] overflow-hidden rounded-xl border border-border bg-surface shadow-card"
    >
      <h3 className="border-b border-border px-4 py-3 font-serif text-[15px]">
        Does your income look right?
      </h3>

      <div className="px-4 py-4">
        {lead ? <p className="mb-3 text-[13px] text-muted">{lead}</p> : null}

        {lines.length === 0 ? (
          <p className="text-[13px] text-muted">
            I couldn&apos;t pull any income figures from your pre-fill report — we&apos;ll go
            through your income in the chat instead.
          </p>
        ) : phase === "editing" && !readOnly ? (
          <fieldset className="flex flex-col gap-3" disabled={busy}>
            <legend className="mb-1 text-[12.5px] text-muted">
              Change any line that&apos;s wrong, then send it back.
            </legend>
            {lines.map((line, i) => (
              <label key={line.modelPath} className="flex flex-col gap-1 text-[13px]">
                <span className="font-medium">
                  {line.label}
                  {line.sublabel ? <span className="text-muted"> — {line.sublabel}</span> : null}
                </span>
                <input
                  id={`${fieldId}-${i}`}
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  defaultValue={line.value}
                  onChange={(event) =>
                    setDrafts((prev) => ({ ...prev, [line.modelPath]: event.target.value }))
                  }
                  className="w-40 rounded-md border border-border bg-bg px-2 py-1.5 text-sm"
                />
              </label>
            ))}
          </fieldset>
        ) : (
          <ul className="flex flex-col gap-2">
            {lines.map((line) => (
              <li
                key={line.modelPath}
                className="flex items-baseline justify-between gap-4 text-[13px]"
              >
                <span>
                  {line.label}
                  {line.sublabel ? <span className="text-muted"> — {line.sublabel}</span> : null}
                </span>
                <span className="shrink-0 font-medium tabular-nums">{formatMoney(line.value)}</span>
              </li>
            ))}
          </ul>
        )}

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
            Income confirmed.
          </p>
        ) : lines.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {phase === "editing" && !readOnly ? (
              <>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={onSubmitCorrections}
                  className="rounded-lg bg-accent px-3 py-2 text-[13px] font-medium text-accent-ink disabled:opacity-60"
                >
                  {busy ? "Saving…" : "Send corrections"}
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    setPhase("idle");
                    setDrafts({});
                  }}
                  className="rounded-lg border border-border px-3 py-2 text-[13px] font-medium disabled:opacity-60"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={onLooksRight}
                  className="rounded-lg bg-accent px-3 py-2 text-[13px] font-medium text-accent-ink disabled:opacity-60"
                >
                  {busy ? "Saving…" : "Looks right"}
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => setPhase("editing")}
                  className="rounded-lg border border-border px-3 py-2 text-[13px] font-medium disabled:opacity-60"
                >
                  Something&apos;s off
                </button>
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
