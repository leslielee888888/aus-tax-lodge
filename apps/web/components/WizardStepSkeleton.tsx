import { TopBar } from "./TopBar";
import { WizardSteps } from "./WizardSteps";

/**
 * Route-level loading skeleton for a wizard step (`loading.tsx`). Server
 * Component. Keeps the chrome (top bar + step nav) stable and shows a calm
 * placeholder for the step body so the layout doesn't jump when data arrives.
 */
export function WizardStepSkeleton({
  step,
  title,
  lines = 4,
}: {
  step: string;
  title: string;
  lines?: number;
}) {
  return (
    <>
      <TopBar>
        <span className="rounded-full border border-border px-2.5 py-0.5 text-[11px] text-muted">
          Loading…
        </span>
      </TopBar>
      <WizardSteps current={step} />
      <main className="mx-auto max-w-3xl px-6 py-8 md:px-10" aria-busy="true">
        <h1 className="text-pretty font-serif text-2xl">{title}</h1>
        <p className="mt-2 text-sm text-muted">Loading…</p>
        <div className="mt-6 space-y-3">
          {[...Array(lines).keys()].map((i) => (
            <div key={i} className="h-12 rounded-card border border-border bg-surface-2" />
          ))}
        </div>
      </main>
    </>
  );
}
