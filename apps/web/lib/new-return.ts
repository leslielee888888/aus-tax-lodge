import type { Acknowledgement } from "./acknowledgement";

/**
 * Decides what "New return" does: show the first-run acknowledgement, or create
 * the return and go to its first step. Pure and dependency-injected so the flow
 * — including "acknowledged once, second time skips it" — is testable without
 * Next, the filesystem or the repository.
 */
export interface NewReturnDeps {
  readAcknowledgement: () => Promise<Acknowledgement | null>;
  createReturn: (input: { currentStep: string }) => Promise<{ returnId: string }>;
}

export type NewReturnOutcome =
  | { readonly kind: "acknowledge" }
  | { readonly kind: "redirect"; readonly href: string };

/** First step every new return resumes at (T15 builds the screen). */
export const FIRST_STEP = "details";

export async function resolveNewReturn(deps: NewReturnDeps): Promise<NewReturnOutcome> {
  const acknowledgement = await deps.readAcknowledgement();
  if (!acknowledgement) return { kind: "acknowledge" };

  const created = await deps.createReturn({ currentStep: FIRST_STEP });
  return { kind: "redirect", href: `/returns/${created.returnId}/${FIRST_STEP}` };
}
