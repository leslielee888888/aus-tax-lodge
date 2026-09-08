"use client";

import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";

import { sendMessage } from "../../app/returns/[returnId]/actions";
import type { ConversationState, ConversationTurn } from "../../lib/conversation";
import type { CardResult } from "./cards/types";
import { ChatComposer } from "./ChatComposer";
import { ChatTranscript } from "./ChatTranscript";

/**
 * The client chat surface (PRD FR-1, FR-12, §7). Given a serialisable snapshot
 * of the return's conversation, it renders the transcript + composer, runs the
 * send round-trip through the {@link sendMessage} server action, and keeps the
 * newest turn in view.
 *
 * The composer is replaced by a short note when the return is read-only (retired
 * params — FR-12) or the conversation has stopped (FR-9, hard stop card in T7).
 */
export interface ChatScreenProps {
  readonly returnId: string;
  readonly initialConversation: ConversationState;
  /** The `envelope.revision` the route loaded — carried forward for conflict detection. */
  readonly initialRevision: number;
  readonly readOnly: boolean;
}

const LOCKED_NOTE =
  "This return is locked — it was prepared under tax rules that have since been retired. You can read the conversation, but it can't be changed.";
const STOPPED_NOTE = "This conversation has stopped and can't continue here.";

export function ChatScreen({
  returnId,
  initialConversation,
  initialRevision,
  readOnly,
}: ChatScreenProps) {
  const [conversation, setConversation] = useState(initialConversation);
  const [revision, setRevision] = useState(initialRevision);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [optimisticConversation, addOptimisticMessage] = useOptimistic(
    conversation,
    (state, pendingText: string): ConversationState => {
      const pendingTurn: ConversationTurn = {
        id: `pending-${state.turns.length}`,
        at: new Date().toISOString(),
        role: "user",
        kind: "message",
        text: pendingText,
      };
      return { ...state, turns: [...state.turns, pendingTurn] };
    },
  );

  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [optimisticConversation.turns.length, isPending]);

  const composerHidden = readOnly || conversation.phase === "stopped";

  function handleCardResult(result: CardResult) {
    setError(null);
    setConflict(false);
    setConversation(result.conversation);
    setRevision(result.revision);
  }

  function handleSend(text: string) {
    setError(null);
    setConflict(false);
    startTransition(async () => {
      addOptimisticMessage(text);
      const result = await sendMessage(returnId, revision, text);
      setConversation(result.conversation);
      setRevision(result.revision);
      if (result.conflict) setConflict(true);
      else if (result.error) setError(result.error);
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 md:px-10">
      <ChatTranscript
        turns={optimisticConversation.turns}
        returnId={returnId}
        revision={revision}
        readOnly={readOnly}
        onCardResult={handleCardResult}
        typing={isPending}
      />
      <div ref={bottomRef} />

      {conflict ? (
        <p
          role="alert"
          className="mb-3 rounded-lg border border-warn bg-warn-soft px-3 py-2 text-xs text-warn"
        >
          This return changed in another tab.{" "}
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="font-semibold underline"
          >
            Reload
          </button>{" "}
          to see the latest version.
        </p>
      ) : null}

      {error && !conflict ? (
        <p
          role="alert"
          className="mb-3 rounded-lg border border-danger bg-danger-soft px-3 py-2 text-xs font-medium text-danger"
        >
          {error}
        </p>
      ) : null}

      {composerHidden ? (
        <p
          role="note"
          className="sticky bottom-0 border-t border-border bg-bg py-4 text-center text-xs text-muted"
        >
          {readOnly ? LOCKED_NOTE : STOPPED_NOTE}
          {!readOnly && conversation.stoppedReason ? ` (${conversation.stoppedReason})` : null}
        </p>
      ) : (
        <ChatComposer onSend={handleSend} pending={isPending} />
      )}
    </div>
  );
}
