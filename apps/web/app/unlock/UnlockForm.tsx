"use client";

import { useActionState } from "react";

import { Button } from "../../components/Button";
import { Field } from "../../components/Field";
import { Input } from "../../components/Input";
import { unlock, type UnlockState } from "./actions";

const INITIAL: UnlockState = {};

export function UnlockForm() {
  const [state, formAction, pending] = useActionState(unlock, INITIAL);

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-4">
      <Field
        label="Passphrase"
        htmlFor="passphrase"
        error={state.error}
        hint="The shared phrase for this device. It only gates access — it does not decrypt anything."
      >
        <Input
          id="passphrase"
          name="passphrase"
          type="password"
          required
          autoFocus
          autoComplete="current-password"
          spellCheck={false}
          placeholder="e.g. correct-horse-battery-staple"
          aria-invalid={Boolean(state.error)}
          aria-describedby={state.error ? "passphrase-error" : "passphrase-hint"}
        />
      </Field>

      <Button type="submit" variant="primary" className="w-full" aria-busy={pending}>
        {pending ? "Unlocking…" : "Unlock"}
      </Button>
    </form>
  );
}
