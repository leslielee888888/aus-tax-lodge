import { Card } from "../components/Card";
import { TopBar } from "../components/TopBar";

/** Route-level loading state for the returns list. */
export default function Loading() {
  return (
    <>
      <TopBar>
        <span className="rounded-full border border-border px-2.5 py-0.5 text-[11px] text-muted">
          Unlocked
        </span>
      </TopBar>
      <main className="mx-auto max-w-3xl px-6 py-8 md:px-10" aria-busy="true">
        <div className="h-7 w-40 rounded bg-surface-2" />
        <p className="mt-3 text-xs text-muted">Loading your returns…</p>
        <Card className="mt-5 divide-y divide-border">
          {[0, 1].map((i) => (
            <div key={i} className="flex items-center justify-between gap-4 px-5 py-4">
              <div className="flex-1 space-y-2">
                <div className="h-4 w-1/3 rounded bg-surface-2" />
                <div className="h-3 w-1/4 rounded bg-surface-2" />
              </div>
              <div className="h-7 w-20 rounded bg-surface-2" />
            </div>
          ))}
        </Card>
      </main>
    </>
  );
}
