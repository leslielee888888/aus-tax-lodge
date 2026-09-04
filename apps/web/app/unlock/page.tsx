import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { Card } from "../../components/Card";
import { InfoIcon, LockIcon, MarkIcon } from "../../components/icons";
import { configuredPassphrase, SESSION_COOKIE, verifySession } from "../../lib/auth";
import { UnlockForm } from "./UnlockForm";

export const metadata: Metadata = { title: "Unlock · Return Assistant" };

export default async function UnlockPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (await verifySession(token, configuredPassphrase())) redirect("/");

  return (
    <main className="flex flex-col items-center px-6 py-24">
      <div className="mb-6 flex items-center gap-2.5">
        <span
          className="flex size-[26px] items-center justify-center rounded-[7px] bg-accent text-accent-ink"
          aria-hidden="true"
        >
          <MarkIcon className="size-4" />
        </span>
        <span className="font-serif text-[15px] font-semibold" translate="no">
          Return Assistant
        </span>
      </div>

      <Card className="w-full max-w-[420px] p-6">
        <div className="flex items-center gap-2.5">
          <LockIcon className="size-4 shrink-0 text-muted" aria-hidden="true" />
          <h1 className="font-serif text-xl font-medium">Unlock your returns</h1>
        </div>
        <p className="mt-1.5 text-xs text-muted">
          This device holds your tax returns and documents, encrypted. Enter the shared
          passphrase to continue.
        </p>

        <UnlockForm />

        <p className="mt-3.5 flex items-start gap-1.5 text-[11px] text-muted">
          <InfoIcon className="mt-px size-3 shrink-0" aria-hidden="true" />
          Forgot it? Change <code className="font-mono" translate="no">APP_PASSPHRASE</code> in the
          app config on the NAS and restart — the passphrase only gates access, so your encrypted
          data stays intact.
        </p>
      </Card>

      <p className="mt-6 text-[11px] text-muted">
        LAN&#8209;only · no accounts · nothing is exposed to the internet
      </p>
    </main>
  );
}
