import Link from "next/link";

import { buttonClassName } from "../../../../components/Button";
import { TopBar } from "../../../../components/TopBar";

/**
 * Placeholder for step 1 of the wizard (PRD §7 step 3 / FR-1). T15 replaces
 * this with the real details form. It exists now so "New return" has somewhere
 * to land after creating the return.
 */
export default async function DetailsPage({
  params,
}: {
  params: Promise<{ returnId: string }>;
}) {
  await params;

  return (
    <>
      <TopBar context="New return · 2025–26">
        <Link href="/" className={buttonClassName({ variant: "ghost", size: "sm" })}>
          Save &amp; exit
        </Link>
      </TopBar>

      <main className="mx-auto max-w-3xl px-6 py-10 md:px-10">
        <h1 className="text-pretty font-serif text-2xl">Your details</h1>
        <p className="mt-2 text-sm text-muted">
          Identity, TFN, bank account, residency, spouse and study-loan details — coming in T15.
        </p>
      </main>
    </>
  );
}
