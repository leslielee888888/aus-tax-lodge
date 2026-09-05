"use client";

import { useState } from "react";

import { buttonClassName } from "../../../../components/Button";
import { deleteReturnAction } from "./actions";

/** Confirms, then permanently deletes the return (PRD FR-20 — the hard-stop screen's only ways out). */
export function DeleteReturnButton({ returnId }: { returnId: string }) {
  const [pending, setPending] = useState(false);

  async function handleClick() {
    if (!window.confirm("Delete this return? This removes every document and figure under it — it can't be undone.")) {
      return;
    }
    setPending(true);
    await deleteReturnAction(returnId);
  }

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={pending}
      className={buttonClassName({ variant: "danger" })}
    >
      {pending ? "Deleting…" : "Delete this return"}
    </button>
  );
}
