/**
 * The shape of the `extractFigures` form state, plus its initial value.
 *
 * This lives outside `actions.ts` because that file is `"use server"` — and a
 * `"use server"` module may only export async functions (Next.js validates
 * this when the route's module graph loads, and a plain object export throws a
 * 500 on the documents step). Types are erased, so they would be fine there;
 * `INITIAL_EXTRACT_FIGURES_STATE` is a value and must not be.
 */

export interface FailedExtraction {
  readonly docId: string;
  readonly filename: string;
  readonly reason: string;
}

export interface ExtractFiguresState {
  readonly status: "idle" | "partial" | "error";
  /** Every document `extractFigures` could not read this run (PRD §7 step 4). */
  readonly failed?: readonly FailedExtraction[];
  /** `docId`s this run successfully extracted and applied — lets the client update optimistically without a reload. */
  readonly succeeded?: readonly { readonly docId: string; readonly figuresCount: number }[];
  readonly formError?: string;
  readonly conflict?: boolean;
}

export const INITIAL_EXTRACT_FIGURES_STATE: ExtractFiguresState = { status: "idle" };
