import type { ReactNode } from "react";

import { CheckIcon, MarkIcon, UserIcon } from "../icons";
import type { AssistantCard, AssistantCardTurn, ConversationTurn } from "../../lib/conversation";
import { cardComponentFor } from "./cards/registry";
import type { CardResult } from "./cards/types";

/**
 * The rendering of the conversation (PRD FR-1, FR-12, §7). Mostly presentational
 * — {@link ChatScreen} owns the state, the send round-trip and auto-scroll — but
 * a `kind:"card"` turn renders its **registered** interactive body when one
 * exists (see {@link import("./cards/registry")}), falling back to the
 * {@link CardPlaceholder} shell for a card type no task has built yet.
 */
export interface ChatTranscriptProps {
  readonly turns: readonly ConversationTurn[];
  /** The return whose cards may write back. */
  readonly returnId: string;
  /** The revision a card should send with its next write. */
  readonly revision: number;
  /** No card may write on a locked (retired-params) return. */
  readonly readOnly: boolean;
  /** A card produced a server result — hand it to {@link ChatScreen}. */
  readonly onCardResult: (result: CardResult) => void;
  /** Show the assistant "thinking" affordance while a send is in flight. */
  readonly typing?: boolean;
}

/** Human labels for the placeholder card shell — the real bodies land in T4–T8. */
const CARD_LABELS: Record<AssistantCard["type"], string> = {
  "upload-prefill": "Upload your ATO pre-fill report",
  "income-checkpoint": "Review the income from your pre-fill report",
  "confirm-figure": "Confirm a figure",
  "upload-or-tell": "Add a document, or tell me the figures",
  reconcile: "Two sources disagree — which is right?",
  "review-summary": "Review your whole return",
  "out-of-scope": "This return can't continue here",
  identity: "Your tax file number and refund account",
};

function Avatar({ who }: { who: "assistant" | "user" }) {
  return (
    <span
      aria-hidden="true"
      className={[
        "flex size-7 shrink-0 items-center justify-center rounded-lg",
        who === "assistant" ? "bg-accent text-accent-ink" : "bg-surface-2 text-muted",
      ].join(" ")}
    >
      {who === "assistant" ? <MarkIcon className="size-4" /> : <UserIcon className="size-4" />}
    </span>
  );
}

function AssistantRow({ children }: { children: ReactNode }) {
  return (
    <article aria-label="Assistant" className="flex gap-3">
      <Avatar who="assistant" />
      {children}
    </article>
  );
}

function AssistantBubble({ text }: { text: string }) {
  return (
    <AssistantRow>
      <div className="max-w-[600px] whitespace-pre-wrap text-pretty rounded-xl border border-border bg-surface px-[15px] py-3 text-sm">
        {text}
      </div>
    </AssistantRow>
  );
}

function UserRow({ children }: { children: ReactNode }) {
  return (
    <article aria-label="You" className="flex flex-row-reverse gap-3">
      <Avatar who="user" />
      {children}
    </article>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <UserRow>
      <div className="max-w-[600px] whitespace-pre-wrap text-pretty rounded-xl border border-border bg-accent-soft px-[15px] py-3 text-sm">
        {text}
      </div>
    </UserRow>
  );
}

function FileChip({ filename }: { filename: string }) {
  return (
    <UserRow>
      <span className="inline-flex items-center gap-2 rounded-[9px] border border-border bg-surface px-3 py-2 text-[12.5px]">
        <span
          aria-hidden="true"
          className="flex size-4 shrink-0 items-center justify-center rounded-full bg-ok text-white"
        >
          <CheckIcon className="size-2.5" />
        </span>
        {filename}
      </span>
    </UserRow>
  );
}

/**
 * The consistent bordered shell every real card (T4–T8) will fill in. Renders
 * the card type as a heading, an optional lead string from `payload.lead`, and a
 * short "handled later" note so the transcript reads sensibly before those
 * tasks land.
 */
function CardPlaceholder({ card }: { card: AssistantCard }) {
  const label = CARD_LABELS[card.type] ?? card.type;
  const payload = card.payload;
  const lead =
    payload &&
    typeof payload === "object" &&
    typeof (payload as { lead?: unknown }).lead === "string"
      ? (payload as { lead: string }).lead
      : null;

  return (
    <AssistantRow>
      <div
        data-card-type={card.type}
        className="w-full max-w-[600px] overflow-hidden rounded-xl border border-border bg-surface shadow-card"
      >
        <h3 className="border-b border-border px-4 py-3 font-serif text-[15px]">{label}</h3>
        {lead ? <p className="px-4 pt-3 text-[13px] text-muted">{lead}</p> : null}
        <p className="px-4 py-3 text-[11px] text-muted">
          This step is handled later in the interview.
        </p>
      </div>
    </AssistantRow>
  );
}

function TypingIndicator() {
  return (
    <AssistantRow>
      <div className="flex items-center gap-1 rounded-xl border border-border bg-surface px-4 py-4">
        <span className="sr-only">The assistant is thinking</span>
        {[0, 160, 320].map((delay) => (
          <span
            key={delay}
            aria-hidden="true"
            className="size-1.5 animate-pulse rounded-full bg-muted motion-reduce:animate-none"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </div>
    </AssistantRow>
  );
}

/** A card turn: its registered interactive body, or the placeholder shell. */
function CardTurnView({
  turn,
  returnId,
  revision,
  readOnly,
  onCardResult,
}: {
  turn: AssistantCardTurn;
  returnId: string;
  revision: number;
  readOnly: boolean;
  onCardResult: (result: CardResult) => void;
}) {
  const Card = cardComponentFor(turn.card.type);
  if (!Card) return <CardPlaceholder card={turn.card} />;
  return (
    <AssistantRow>
      <Card
        returnId={returnId}
        revision={revision}
        turn={turn}
        readOnly={readOnly}
        onResult={onCardResult}
      />
    </AssistantRow>
  );
}

/**
 * The neutral confirmation chip for a `card-response` turn (PRD FR-17, #88 /
 * T15). `cardType` (looked up from the assistant card the response answers)
 * picks the wording — `identity` gets its own "Details provided." rather than
 * the generic line, since that response's payload is `{ provided: true }` and
 * must never be paraphrased into anything that could look like it carries the
 * TFN / account details. Every other card type keeps the existing generic text.
 */
function CardResponseBubble({ cardType }: { cardType: AssistantCard["type"] | undefined }) {
  return <UserBubble text={cardType === "identity" ? "Details provided." : "Response recorded."} />;
}

function TurnView({
  turn,
  returnId,
  revision,
  readOnly,
  onCardResult,
  cardTypeById,
}: {
  turn: ConversationTurn;
  returnId: string;
  revision: number;
  readOnly: boolean;
  onCardResult: (result: CardResult) => void;
  cardTypeById: ReadonlyMap<string, AssistantCard["type"]>;
}) {
  if (turn.role === "assistant") {
    return turn.kind === "card" ? (
      <CardTurnView
        turn={turn}
        returnId={returnId}
        revision={revision}
        readOnly={readOnly}
        onCardResult={onCardResult}
      />
    ) : (
      <AssistantBubble text={turn.text} />
    );
  }
  if (turn.kind === "file") return <FileChip filename={turn.filename} />;
  if (turn.kind === "card-response") {
    return <CardResponseBubble cardType={cardTypeById.get(turn.cardId)} />;
  }
  return <UserBubble text={turn.text} />;
}

export function ChatTranscript({
  turns,
  returnId,
  revision,
  readOnly,
  onCardResult,
  typing = false,
}: ChatTranscriptProps) {
  const cardTypeById = new Map<string, AssistantCard["type"]>();
  for (const turn of turns) {
    if (turn.role === "assistant" && turn.kind === "card") {
      cardTypeById.set(turn.id, turn.card.type);
    }
  }

  return (
    <div
      role="log"
      aria-live="polite"
      aria-label="Conversation with the assistant"
      className="flex flex-1 flex-col gap-5 py-6"
    >
      {turns.map((turn) => (
        <TurnView
          key={turn.id}
          turn={turn}
          returnId={returnId}
          revision={revision}
          readOnly={readOnly}
          onCardResult={onCardResult}
          cardTypeById={cardTypeById}
        />
      ))}
      {typing ? <TypingIndicator /> : null}
    </div>
  );
}
