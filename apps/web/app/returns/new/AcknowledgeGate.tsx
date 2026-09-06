"use client";

import { ACKNOWLEDGEMENT_STATEMENT } from "@aus-tax-lodge/export/disclaimer";
import Link from "next/link";
import { useActionState, useId } from "react";

import { buttonClassName, Button } from "../../../components/Button";
import { startFirstReturn, type StartReturnState } from "./actions";

const INITIAL: StartReturnState = {};

export function AcknowledgeGate() {
  const [state, formAction, pending] = useActionState(startFirstReturn, INITIAL);
  const checkboxId = useId();
  const errorId = useId();

  return (
    <form action={formAction}>
      <div className="rounded-lg border border-border bg-surface-2 p-3">
        <label htmlFor={checkboxId} className="flex items-start gap-2.5 text-xs font-medium">
          <input
            id={checkboxId}
            type="checkbox"
            name="accept"
            required
            aria-describedby={state.error ? errorId : undefined}
            className="mt-0.5 size-[18px] shrink-0 accent-accent"
          />
          <span>{ACKNOWLEDGEMENT_STATEMENT}</span>
        </label>
      </div>

      {state.error ? (
        <p id={errorId} role="alert" className="mt-2 text-[11px] font-medium text-danger">
          {state.error}
        </p>
      ) : null}

      <div className="mt-4 flex justify-end gap-2.5">
        <Link href="/" className={buttonClassName({ variant: "ghost" })}>
          Not now
        </Link>
        <Button type="submit" variant="primary" aria-busy={pending}>
          {pending ? "Starting…" : "Start my return"}
        </Button>
      </div>

      <p className="mt-3 text-[11px] text-muted">
        Recorded once, with the date. You won&rsquo;t be asked again — the reminder stays in the
        banner above.
      </p>
    </form>
  );
}
