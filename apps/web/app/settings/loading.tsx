import { Card } from "../../components/Card";
import { TopBar } from "../../components/TopBar";

export default function Loading() {
  return (
    <>
      <TopBar>
        <span className="rounded-full border border-border px-2.5 py-0.5 text-[11px] text-muted">
          Loading…
        </span>
      </TopBar>
      <main className="mx-auto max-w-2xl px-6 py-8 md:px-10" aria-busy="true">
        <h1 className="text-pretty font-serif text-2xl">Settings</h1>
        <p className="mt-1 text-xs text-muted">Loading…</p>
        <Card className="mt-5 h-40 border-border bg-surface-2" />
      </main>
    </>
  );
}
