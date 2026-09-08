"use client";

import { useId, useMemo, useState } from "react";

import { resolveConfirmation } from "../../../app/returns/[returnId]/actions";
import { CheckIcon } from "../../icons";
import type { PendingConfirmation } from "../../../lib/conversation";
import type { CardProps } from "./types";

/**
 * The confirm-a-figure card (PRD FR-5, between the two checkpoints). Shows one
 * flagged figure — value + where it came from — and asks the user to accept it
 * or correct it:
 *
 * - **Yes** → {@link resolveConfirmation} `confirm()`s the figure.
 * - **Edit** → a number input; on submit the figure is `edit()`ed to the new
 *   value (original kept via `proposedValue`).
 *
 * Either way the matching `PendingConfirmation` is marked `resolved` and the
 * interview carries on.
 */
interface Payload {
  readonly lead?: string;
  readonly confirmation: PendingConfirmation | null;
}

type Phase = "idle" | "editing" | "submitting" | "done" | "error";

function readPayload(raw: unknown): Payload {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const c = record.confirmation;
  const confirmation =
    c && typeof c === "object" && typeof (c as PendingConfirmation).id === "string"
      ? (c as PendingConfirmation)
      : null;
  return { lead: typeof record.lead === "string" ? record.lead : undefined, confirmation };
}

function formatValue(value: number | null): string {
  if (value == null) return "—";
  return value.toLocaleString("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 2,
  });
}

export function ConfirmFigureCard({ returnId, revision, turn, readOnly, onResult }: CardProps) {
  const { lead, confirmation } = useMemo(() => readPayload(turn.card.payload), [turn.card.payload]);
  const inputId = useId();

  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState<string>(
    confirmation?.value != null ? String(confirmation.value) : "",
  );

  const busy = phase === "submitting";
  const disabled = readOnly || busy || phase === "done";

  function handleResult(result: Awaited<ReturnType<typeof resolveConfirmation>>) {
    onResult({ conversation: result.conversation, revision: result.revision });
    if (result.error) {
      setPhase("error");
      setMessage(result.error);
      return;
    }
    setPhase("done");
  }

  async function submit(accept: boolean) {
    if (!confirmation) return;
    if (!accept) {
      const value = Number(draft.replace(/[$,\s]/g, ""));
      if (!Number.isFinite(value)) {
        setPhase("error");
        setMessage("Enter a number to correct that figure.");
        return;
      }
      setMessage(null);
      setPhase("submitting");
      try {
        handleResult(
          await resolveConfirmation(returnId, revision, turn.id, confirmation.id, {
            accept: false,
            value,
          }),
        );
      } catch {
        setPhase("error");
        setMessage("Something went wrong saving that — try again.");
      }
      return;
    }

    setMessage(null);
    setPhase("submitting");
    try {
      handleResult(
        await resolveConfirmation(returnId, revision, turn.id, confirmation.id, { accept: true }),
      );
    } catch {
      setPhase("error");
      setMessage("Something went wrong saving that — try again.");
    }
  }

  return (
    <div
      data-card-type="confirm-figure"
      className="w-full max-w-[600px] overflow-hidden rounded-xl border border-border bg-surface shadow-card"
    >
      <h3 className="border-b border-border px-4 py-3 font-serif text-[15px]">
        Quick check on one figure
      </h3>

      <div className="px-4 py-4">
        {lead ? <p className="mb-3 text-[13px] text-muted">{lead}</p> : null}

        {!confirmation ? (
          <p className="text-[13px] text-muted">
            There&apos;s nothing to check here right now — carry on in the chat.
          </p>
        ) : (
          <>
            <p className="text-[13px]">
              I&apos;ve got{" "}
              <strong>
                {confirmation.label}: {formatValue(confirmation.value)}
              </strong>{" "}
              from {confirmation.source} — is that right?
            </p>

            {phase === "editing" && !readOnly ? (
              <div className="mt-3 flex flex-col gap-1">
                <label htmlFor={inputId} className="text-[12.5px] font-medium">
                  Corrected amount
                </label>
                <input
                  id={inputId}
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  value={draft}
                  disabled={busy}
                  onChange={(event) => setDraft(event.target.value)}
                  className="w-40 rounded-md border border-border bg-bg px-2 py-1.5 text-sm"
                />
              </div>
            ) : null}

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
              <div className="mt-4 flex flex-wrap gap-2">
                {phase === "editing" && !readOnly ? (
                  <>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => void submit(false)}
                      className="rounded-lg bg-accent px-3 py-2 text-[13px] font-medium text-accent-ink disabled:opacity-60"
                    >
                      {busy ? "Saving…" : "Save correction"}
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => setPhase("idle")}
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
                      onClick={() => void submit(true)}
                      className="rounded-lg bg-accent px-3 py-2 text-[13px] font-medium text-accent-ink disabled:opacity-60"
                    >
                      {busy ? "Saving…" : "Yes, that's right"}
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => setPhase("editing")}
                      className="rounded-lg border border-border px-3 py-2 text-[13px] font-medium disabled:opacity-60"
                    >
                      Edit
                    </button>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
