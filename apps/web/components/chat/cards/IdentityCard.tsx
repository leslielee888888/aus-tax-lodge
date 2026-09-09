"use client";

import { useId, useState, type ChangeEvent } from "react";

import { provideIdentity } from "../../../app/returns/[returnId]/actions";
import {
  normalizeBsb,
  validateAccountName,
  validateAccountNumber,
  validateBsb,
  validateTfn,
  type IdentityFieldErrors,
  type IdentityValues,
} from "../../../lib/interview/identity";
import { CheckIcon } from "../../icons";
import type { CardProps } from "./types";

/**
 * The secure `identity` card (PRD FR-1, FR-17, #88 / T15) — the tax file
 * number and refund bank account, collected here and ONLY here, never as a
 * typed chat reply. A TFN typed into the composer would land in a
 * `ConversationTurn.text` and be replayed into every later prompt via
 * `renderTranscript` (PRD FR-17, "TFN never in a prompt") — this card exists
 * so that can never happen: on submit, {@link provideIdentity} writes the
 * values straight onto the model and records only `{ provided: true }` on the
 * conversation turn, never the values themselves.
 *
 * Raised deterministically by `nextTurn` (`identityCardOutstanding`), never by
 * Claude, once the plain identity questions (name / DOB / address) are settled.
 */
function readLead(payload: unknown): string | null {
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  return typeof record.lead === "string" && record.lead.trim() !== "" ? record.lead : null;
}

type Phase = "idle" | "submitting" | "done" | "error";

const EMPTY_VALUES: IdentityValues = { tfn: "", bsb: "", accountNumber: "", accountName: "" };

export function IdentityCard({ returnId, revision, turn, readOnly, onResult }: CardProps) {
  const lead = readLead(turn.card.payload);
  const tfnId = useId();
  const bsbId = useId();
  const accountNumberId = useId();
  const accountNameId = useId();
  const tfnHintId = useId();
  const bsbHintId = useId();

  const [values, setValues] = useState<IdentityValues>(EMPTY_VALUES);
  const [errors, setErrors] = useState<IdentityFieldErrors>({});
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const busy = phase === "submitting";
  const disabled = readOnly || busy || phase === "done";

  function field<K extends keyof IdentityValues>(key: K) {
    return {
      value: values[key],
      onChange: (event: ChangeEvent<HTMLInputElement>) => {
        setValues((prev) => ({ ...prev, [key]: event.target.value }));
        setErrors((prev) => ({ ...prev, [key]: undefined }));
      },
    };
  }

  async function submit() {
    const fieldErrors: IdentityFieldErrors = {
      tfn: validateTfn(values.tfn) ?? undefined,
      bsb: validateBsb(values.bsb) ?? undefined,
      accountNumber: validateAccountNumber(values.accountNumber) ?? undefined,
      accountName: validateAccountName(values.accountName) ?? undefined,
    };
    const hasErrors = Object.values(fieldErrors).some((e) => e !== undefined);
    setErrors(fieldErrors);
    if (hasErrors) {
      setMessage("Check the highlighted fields before continuing.");
      return;
    }

    setMessage(null);
    setPhase("submitting");
    try {
      const result = await provideIdentity(returnId, revision, turn.id, values);
      onResult({ conversation: result.conversation, revision: result.revision });
      if (result.error) {
        setPhase("error");
        setMessage(result.error);
        return;
      }
      setValues(EMPTY_VALUES);
      setPhase("done");
    } catch {
      setPhase("error");
      setMessage("Something went wrong saving that — try again.");
    }
  }

  return (
    <div
      data-card-type="identity"
      className="w-full max-w-[600px] overflow-hidden rounded-xl border border-border bg-surface shadow-card"
    >
      <h3 className="border-b border-border px-4 py-3 font-serif text-[15px]">
        Your tax file number and refund account
      </h3>

      <div className="px-4 py-4">
        {lead ? (
          <p className="mb-3 text-[13px]">{lead}</p>
        ) : (
          <p className="mb-3 text-[13px] text-muted">
            This is sent securely and stored encrypted — it&apos;s never shown back in the chat.
          </p>
        )}

        {phase === "done" ? (
          <p className="inline-flex items-center gap-2 text-[12.5px] font-medium text-ok">
            <span
              aria-hidden="true"
              className="flex size-4 items-center justify-center rounded-full bg-ok text-white"
            >
              <CheckIcon className="size-2.5" />
            </span>
            Details provided.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <div>
              <label htmlFor={tfnId} className="mb-1 block text-[12.5px] font-medium">
                Tax file number
              </label>
              <input
                id={tfnId}
                type="password"
                autoComplete="off"
                inputMode="numeric"
                disabled={disabled}
                aria-describedby={tfnHintId}
                aria-invalid={errors.tfn ? true : undefined}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-[13px]"
                {...field("tfn")}
              />
              <p id={tfnHintId} className="mt-1 text-[11.5px] text-muted">
                8 or 9 digits — stored encrypted, never shown back here.
              </p>
              {errors.tfn ? (
                <p role="alert" className="mt-1 text-[12px] font-medium text-danger">
                  {errors.tfn}
                </p>
              ) : null}
            </div>

            <div>
              <label htmlFor={bsbId} className="mb-1 block text-[12.5px] font-medium">
                BSB
              </label>
              <input
                id={bsbId}
                type="text"
                inputMode="numeric"
                placeholder="NNN-NNN"
                disabled={disabled}
                aria-describedby={bsbHintId}
                aria-invalid={errors.bsb ? true : undefined}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-[13px]"
                {...field("bsb")}
                onBlur={(event) =>
                  setValues((prev) => ({ ...prev, bsb: normalizeBsb(event.target.value) }))
                }
              />
              <p id={bsbHintId} className="mt-1 text-[11.5px] text-muted">
                6 digits, as NNN-NNN.
              </p>
              {errors.bsb ? (
                <p role="alert" className="mt-1 text-[12px] font-medium text-danger">
                  {errors.bsb}
                </p>
              ) : null}
            </div>

            <div>
              <label htmlFor={accountNumberId} className="mb-1 block text-[12.5px] font-medium">
                Account number
              </label>
              <input
                id={accountNumberId}
                type="text"
                inputMode="numeric"
                disabled={disabled}
                aria-invalid={errors.accountNumber ? true : undefined}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-[13px]"
                {...field("accountNumber")}
              />
              {errors.accountNumber ? (
                <p role="alert" className="mt-1 text-[12px] font-medium text-danger">
                  {errors.accountNumber}
                </p>
              ) : null}
            </div>

            <div>
              <label htmlFor={accountNameId} className="mb-1 block text-[12.5px] font-medium">
                Account name
              </label>
              <input
                id={accountNameId}
                type="text"
                disabled={disabled}
                aria-invalid={errors.accountName ? true : undefined}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-[13px]"
                {...field("accountName")}
              />
              {errors.accountName ? (
                <p role="alert" className="mt-1 text-[12px] font-medium text-danger">
                  {errors.accountName}
                </p>
              ) : null}
            </div>

            {message ? (
              <p role="alert" className="text-[12.5px] font-medium text-danger">
                {message}
              </p>
            ) : null}

            <div>
              <button
                type="button"
                disabled={disabled}
                onClick={() => void submit()}
                className="rounded-lg bg-accent px-3 py-2 text-[13px] font-medium text-accent-ink disabled:opacity-60"
              >
                {busy ? "Saving…" : "Save details"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
