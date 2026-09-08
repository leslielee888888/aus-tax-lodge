"use server";

import { redirect } from "next/navigation";

import { readAcknowledgement } from "./acknowledgement";
import { resolveNewReturn } from "./new-return";
import { getReturnRepository } from "./returns";

/**
 * "New return" from the returns list. Routes to the first-run acknowledgement
 * (PRD FR-19) when it has not been recorded, otherwise creates the return and
 * redirects straight into its chat (PRD FR-1, FR-13). Used as a `<form action>`.
 */
export async function newReturnAction(): Promise<void> {
  const outcome = await resolveNewReturn({
    readAcknowledgement,
    createReturn: (input) => getReturnRepository().createReturn(input),
  });
  redirect(outcome.kind === "acknowledge" ? "/returns/new" : outcome.href);
}
