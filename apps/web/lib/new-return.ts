import type { Acknowledgement } from "./acknowledgement";

/**
 * Decides what "New return" does: show the first-run acknowledgement (PRD
 * FR-19 / FR-8), or create the return and drop the user straight into the chat
 * (PRD FR-1, FR-13 — v2 has no wizard first step). Pure and dependency-injected
 * so the flow — including "acknowledged once, second time skips it" — is
 * testable without Next, the filesystem or the repository.
 */
export interface NewReturnDeps {
  readAcknowledgement: () => Promise<Acknowledgement | null>;
  createReturn: (input: { currentStep: string }) => Promise<{ returnId: string }>;
}

export type NewReturnOutcome =
  { readonly kind: "acknowledge" } | { readonly kind: "redirect"; readonly href: string };

/**
 * `currentStep` marker stamped on a v2 return. The six-step wizard is gone —
 * every return opens in the chat (`/returns/<id>`) and its real place lives in
 * the conversation state (PRD FR-12) — but `@aus-tax-lodge/store` still carries
 * the field, so give it an honest value.
 */
export const NEW_RETURN_STEP = "chat";

export async function resolveNewReturn(deps: NewReturnDeps): Promise<NewReturnOutcome> {
  const acknowledgement = await deps.readAcknowledgement();
  if (!acknowledgement) return { kind: "acknowledge" };

  const created = await deps.createReturn({ currentStep: NEW_RETURN_STEP });
  return { kind: "redirect", href: `/returns/${created.returnId}` };
}
