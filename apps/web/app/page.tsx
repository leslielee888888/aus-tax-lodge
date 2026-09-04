import { PARAMS_VERSION, TARGET_YEAR } from "@aus-tax-lodge/params";
import type { ReturnSummary } from "@aus-tax-lodge/store";

import { Card } from "../components/Card";
import { LockIcon } from "../components/icons";
import { NewReturnButton } from "../components/NewReturnButton";
import { ReturnsList } from "../components/ReturnsList";
import { TopBar } from "../components/TopBar";
import { formatIncomeYear } from "../lib/format";
import { getReturnRepository } from "../lib/returns";

// Read fresh on every request — a return the user just created must show up.
export const dynamic = "force-dynamic";

export default async function ReturnsPage() {
  let returns: ReturnSummary[] | null = null;
  try {
    returns = await getReturnRepository().listReturns();
  } catch (error) {
    console.error("failed to list returns", error);
  }

  return (
    <>
      <TopBar>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-[11px] text-muted">
          <LockIcon className="size-3" aria-hidden="true" />
          Unlocked
        </span>
      </TopBar>

      <main className="mx-auto max-w-3xl px-6 py-8 md:px-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-pretty font-serif text-2xl">Your returns</h1>
            <p className="mt-1 text-xs text-muted">
              Prepare a return for the {formatIncomeYear(TARGET_YEAR)} income year — for you, or
              for a household member in the same place.
            </p>
          </div>
          <NewReturnButton />
        </div>

        {returns === null ? (
          <Card className="mt-5 border-danger bg-danger-soft px-5 py-4">
            <h2 className="font-serif text-base font-medium text-danger">
              Couldn&rsquo;t load your returns
            </h2>
            <p className="mt-1 text-xs text-danger">
              The encrypted data directory could not be read. Check the app has access to its
              volume, then reload the page.
            </p>
          </Card>
        ) : (
          <ReturnsList returns={returns} />
        )}

        <p className="mt-4 text-[11px] leading-relaxed text-muted">
          Returns and documents are stored encrypted on this device. Deleting a return removes
          every document and figure under it. Past-year returns open read-only once the tax
          rules roll forward. Parameter set {PARAMS_VERSION}.
        </p>
      </main>
    </>
  );
}
