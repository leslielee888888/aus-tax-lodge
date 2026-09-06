import type { Metadata } from "next";
import Link from "next/link";

import { buttonClassName } from "../../components/Button";
import { Card, CardBody, CardHeader, CardTitle } from "../../components/Card";
import { TopBar } from "../../components/TopBar";
import { readInstanceSettings } from "../../lib/instance-settings";
import { PurgeSettingForm } from "./PurgeSettingForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Settings · Return Assistant" };

/**
 * Instance settings (PRD FR-18). One card for now: the optional "purge source
 * documents N days after export" toggle, off by default, warned and confirmed
 * before it turns on.
 */
export default async function SettingsPage() {
  const settings = await readInstanceSettings();

  return (
    <>
      <TopBar>
        <Link href="/" className={buttonClassName({ variant: "ghost", size: "sm" })}>
          Back to returns
        </Link>
      </TopBar>

      <main className="mx-auto max-w-2xl px-6 py-8 md:px-10">
        <h1 className="text-pretty font-serif text-2xl">Settings</h1>
        <p className="mt-1 text-xs text-muted">
          Instance-wide options for this device. They apply to every return here.
        </p>

        <div className="mt-5">
          <Card>
            <CardHeader>
              <CardTitle>Document retention</CardTitle>
            </CardHeader>
            <CardBody className="pt-3">
              <p className="text-xs text-muted">
                By default this app never deletes anything on its own. Deleting a return removes
                every document and figure under it, and the encrypted records archive you download
                at export time is your copy for the ATO&rsquo;s five-year record-keeping rule.
              </p>
              <p className="mt-2 text-xs text-muted">
                You can optionally have the app clear the <em>original uploaded documents</em> from
                returns you have already exported, a set number of days after their export date. The
                return, its figures, and the export package are all kept.
              </p>

              <div className="mt-4">
                <PurgeSettingForm initial={settings.purgeSourceDocuments} />
              </div>
            </CardBody>
          </Card>
        </div>
      </main>
    </>
  );
}
