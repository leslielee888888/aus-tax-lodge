"use server";

import { redirect } from "next/navigation";

import { recordAcknowledgement } from "../../../lib/acknowledgement";
import { FIRST_STEP } from "../../../lib/new-return";
import { getReturnRepository } from "../../../lib/returns";

export interface StartReturnState {
  error?: string;
}

/**
 * First-run acknowledgement (PRD FR-19): record the "not tax advice / I'm
 * responsible" acceptance with a timestamp, create the first return, and go to
 * its first step. The checkbox must be ticked.
 */
export async function startFirstReturn(
  _previous: StartReturnState,
  formData: FormData,
): Promise<StartReturnState> {
  if (formData.get("accept") !== "on") {
    return { error: "Tick the box to confirm you understand, then start your return." };
  }

  await recordAcknowledgement();
  const envelope = await getReturnRepository().createReturn({ currentStep: FIRST_STEP });
  redirect(`/returns/${envelope.returnId}/${FIRST_STEP}`);
}
