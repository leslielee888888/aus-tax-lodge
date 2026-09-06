import { ASSISTANT_DOES, ASSISTANT_DOES_NOT } from "@aus-tax-lodge/export/disclaimer";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Card } from "../../../components/Card";
import { CheckIcon, XIcon } from "../../../components/icons";
import { TopBar } from "../../../components/TopBar";
import { readAcknowledgement } from "../../../lib/acknowledgement";
import { AcknowledgeGate } from "./AcknowledgeGate";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Before your first return · Return Assistant" };

/**
 * First-run acknowledgement screen (PRD FR-19). Reached only from "New return"
 * when the acknowledgement has not been recorded; once it has, "New return"
 * creates the return directly, so a direct visit here just returns to the list.
 */
export default async function NewReturnPage() {
  if (await readAcknowledgement()) redirect("/");

  return (
    <>
      <TopBar>
        <span className="rounded-full border border-border px-2.5 py-0.5 text-[11px] text-muted">
          Unlocked
        </span>
      </TopBar>

      <main className="mx-auto max-w-xl px-6 py-16 md:px-10">
        <Card className="p-7">
          <h1 className="text-pretty font-serif text-xl font-medium">Before your first return</h1>
          <p className="mt-2.5 text-xs text-muted">
            This tool helps you prepare a simple individual return from your own documents. It is{" "}
            <strong className="font-semibold text-text">not</strong> tax advice and does not lodge
            anything for you.
          </p>
          <p className="mb-4 mt-2 text-xs text-muted">
            The figures and the refund it shows are an{" "}
            <strong className="font-semibold text-text">estimate</strong>. The ATO&rsquo;s
            assessment, once you lodge in myTax, is the final word — and the lodged return is your
            responsibility.
          </p>

          <div className="mb-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border bg-surface-2 p-3">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
                What this assistant does
              </h2>
              <ul className="mt-2 flex flex-col gap-1.5">
                {ASSISTANT_DOES.map((item) => (
                  <li key={item} className="flex items-start gap-1.5 text-[11.5px] text-text">
                    <CheckIcon className="mt-0.5 size-3 shrink-0 text-ok" aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg border border-border bg-surface-2 p-3">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
                What it does not do
              </h2>
              <ul className="mt-2 flex flex-col gap-1.5">
                {ASSISTANT_DOES_NOT.map((item) => (
                  <li key={item} className="flex items-start gap-1.5 text-[11.5px] text-text">
                    <XIcon className="mt-0.5 size-3 shrink-0 text-danger" aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <AcknowledgeGate />
        </Card>
      </main>
    </>
  );
}
