import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { buttonClassName } from "../../../components/Button";
import { ChatScreen } from "../../../components/chat/ChatScreen";
import { TopBar } from "../../../components/TopBar";
import { formatIncomeYear } from "../../../lib/format";
import { loadConversationForChat } from "../../../lib/returns";

export const metadata: Metadata = { title: "Your return · Return Assistant" };

// The conversation changes on every turn, and may be edited from another tab — always read fresh.
export const dynamic = "force-dynamic";

/**
 * The one screen of v2 (PRD §1, §7, FR-1, FR-12): the chat. A Server Component
 * loads the return's {@link loadConversation} state and the client
 * {@link ChatScreen} renders the transcript + composer. A retired-params return
 * (read-only) shows the transcript with a "locked" note instead of a composer.
 *
 * A fresh return is seeded with the opening upload prompt + inline drop zone by
 * {@link loadConversationForChat} (T4); T5–T8 fill in the remaining card shells.
 */
export default async function ReturnChatPage({
  params,
}: {
  params: Promise<{ returnId: string }>;
}) {
  const { returnId } = await params;

  let loaded: Awaited<ReturnType<typeof loadConversationForChat>>;
  try {
    loaded = await loadConversationForChat(returnId);
  } catch {
    notFound();
  }
  const { envelope, model, conversation, readOnly } = loaded;

  const context = `${model.taxpayer.fullName.value ?? "New return"} · ${formatIncomeYear(envelope.targetYear)}`;

  return (
    <>
      <TopBar context={context}>
        <Link href="/" className={buttonClassName({ variant: "ghost", size: "sm" })}>
          Save &amp; exit
        </Link>
      </TopBar>

      <div className="flex min-h-[70vh] flex-col">
        <ChatScreen
          returnId={returnId}
          initialConversation={conversation}
          initialRevision={envelope.revision}
          readOnly={readOnly}
        />
      </div>
    </>
  );
}
