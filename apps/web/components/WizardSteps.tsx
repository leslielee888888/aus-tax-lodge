import { WIZARD_STEPS } from "../lib/steps";
import { CheckIcon } from "./icons";

export interface WizardStepsProps {
  /** Route segment of the step currently showing (e.g. `"details"`). */
  current: string;
}

/**
 * The six-step progress bar from the design canvas (`Details.dc.html` `.step`).
 * Steps before `current` show a filled done-mark; `current` is bold with an
 * accent outline; later steps are plain. Purely presentational — none of the
 * steps are yet links, since only `details` exists (T16–T20 land the rest).
 */
export function WizardSteps({ current }: WizardStepsProps) {
  const currentIndex = WIZARD_STEPS.findIndex((step) => step.id === current);

  return (
    <nav
      aria-label="Return progress"
      className="flex flex-wrap items-center gap-4 border-b border-border bg-surface px-4 py-3 text-xs text-muted md:px-10"
    >
      <ol className="flex flex-wrap items-center gap-4">
        {WIZARD_STEPS.map((step, index) => {
          const done = currentIndex >= 0 && index < currentIndex;
          const active = step.id === current;
          return (
            <li
              key={step.id}
              aria-current={active ? "step" : undefined}
              className={`flex items-center gap-1.5 ${active ? "font-semibold text-text" : ""}`}
            >
              <span
                className={[
                  "flex size-[19px] shrink-0 items-center justify-center rounded-full border text-[10px]",
                  done
                    ? "border-accent bg-accent text-accent-ink"
                    : active
                      ? "border-accent text-accent"
                      : "border-border",
                ].join(" ")}
                aria-hidden="true"
              >
                {done ? <CheckIcon className="size-2.5" /> : index + 1}
              </span>
              {step.label}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
