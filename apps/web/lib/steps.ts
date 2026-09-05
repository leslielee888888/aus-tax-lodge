/**
 * The six wizard steps and their route segments (PRD §7). Shared by the
 * returns list (badge text) and the per-step {@link WizardSteps} nav so the
 * order and labels stay in exactly one place as T16–T20 land.
 */
export interface WizardStep {
  readonly id: string;
  readonly label: string;
}

export const WIZARD_STEPS: readonly WizardStep[] = [
  { id: "details", label: "Details" },
  { id: "documents", label: "Documents" },
  { id: "review", label: "Review" },
  { id: "questions", label: "Questions" },
  { id: "estimate", label: "Estimate" },
  { id: "export", label: "Export" },
];

const STEP_LABELS: Record<string, string> = {
  details: "Your details",
  documents: "Documents",
  review: "Review figures",
  questions: "Questions",
  estimate: "Estimate",
  export: "Export",
};

/** The returns-list phrasing for a step id (e.g. `"Review figures"`), falling back to the id itself. */
export function stepLabel(step: string): string {
  return STEP_LABELS[step] ?? step;
}
