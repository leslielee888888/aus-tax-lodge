import { ENGINE_VERSION } from "@aus-tax-lodge/engine";

// Server Component (no "use client"): a placeholder landing page. The real
// screens — unlock gate, returns list, the six-step flow — land in T14+.
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">
        Australian Individual Tax Return Assistant
      </h1>
      <p className="text-base text-neutral-600 dark:text-neutral-400">Development in progress.</p>
      <p className="text-xs text-neutral-400">engine v{ENGINE_VERSION}</p>
    </main>
  );
}
