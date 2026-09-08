"use client";

import { useId, useRef, useState, type SyntheticEvent } from "react";

import { Button } from "../Button";
import { SendIcon } from "../icons";

/**
 * The always-reachable text input at the bottom of the chat (PRD FR-1, §7).
 * Sticky, keyboard-first: Enter sends, Shift+Enter inserts a newline. On submit
 * it hands the trimmed text to {@link ChatComposerProps.onSend} — the seam T4
 * wires to the real interview loop — then clears and re-focuses the field.
 *
 * {@link ChatScreen} hides this entirely (rendering a note in its place) when
 * the return is read-only or the conversation has stopped.
 */
export interface ChatComposerProps {
  readonly onSend: (text: string) => void;
  /** A send is in flight — the input stays usable but submit is blocked. */
  readonly pending: boolean;
}

export function ChatComposer({ onSend, pending }: ChatComposerProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState("");

  const trimmed = value.trim();
  const canSend = trimmed.length > 0 && !pending;

  function submit(event: SyntheticEvent) {
    event.preventDefault();
    if (!canSend) return;
    onSend(trimmed);
    setValue("");
    inputRef.current?.focus();
  }

  return (
    <form
      onSubmit={submit}
      className="sticky bottom-0 flex items-end gap-2.5 border-t border-border bg-bg pb-4 pt-3.5"
    >
      <label htmlFor={inputId} className="sr-only">
        Type your answer to the assistant
      </label>
      <textarea
        id={inputId}
        ref={inputRef}
        name="message"
        rows={1}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) submit(event);
        }}
        placeholder="Type your answer…"
        className="max-h-40 min-h-[44px] flex-1 resize-none rounded-[11px] border border-border bg-surface px-3.5 py-3 text-[13.5px] text-text placeholder:text-muted focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      />
      <Button
        type="submit"
        variant="primary"
        aria-label="Send message"
        disabled={!canSend}
        className="size-11 shrink-0"
      >
        <SendIcon className="size-[18px]" />
      </Button>
    </form>
  );
}
