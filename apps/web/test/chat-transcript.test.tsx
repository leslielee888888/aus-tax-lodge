// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ChatTranscript } from "../components/chat/ChatTranscript";
import type { ConversationTurn } from "../lib/conversation";

afterEach(cleanup);

function turn(partial: ConversationTurn): ConversationTurn {
  return partial;
}

function renderTranscript(
  props: Partial<Parameters<typeof ChatTranscript>[0]> & {
    turns: readonly ConversationTurn[];
  },
) {
  return render(
    <ChatTranscript
      returnId="ret1"
      revision={1}
      readOnly={false}
      onCardResult={() => {}}
      {...props}
    />,
  );
}

describe("ChatTranscript (PRD FR-1, FR-12)", () => {
  it("renders assistant / user / file-chip / card-placeholder turns in order", () => {
    const turns: ConversationTurn[] = [
      turn({
        id: "1",
        at: "t",
        role: "assistant",
        kind: "message",
        text: "Hello from the assistant",
      }),
      turn({ id: "2", at: "t", role: "user", kind: "message", text: "Hi back" }),
      turn({
        id: "3",
        at: "t",
        role: "user",
        kind: "file",
        filename: "prefill-2025-26.pdf",
        docId: "d1",
      }),
      turn({
        id: "4",
        at: "t",
        role: "assistant",
        kind: "card",
        // A card type no task has built a body for yet — still the placeholder shell.
        card: { type: "reconcile" },
      }),
    ];

    const { container } = renderTranscript({ turns });
    const text = container.textContent ?? "";

    expect(text.indexOf("Hello from the assistant")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("Hello from the assistant")).toBeLessThan(text.indexOf("Hi back"));
    expect(text.indexOf("Hi back")).toBeLessThan(text.indexOf("prefill-2025-26.pdf"));
    expect(text.indexOf("prefill-2025-26.pdf")).toBeLessThan(
      text.indexOf("Two sources disagree — which is right?"),
    );

    const card = container.querySelector('[data-card-type="reconcile"]');
    expect(card).not.toBeNull();
    expect(card?.textContent).toMatch(/handled later in the interview/i);
  });

  it("labels each turn by role and exposes a live log region", () => {
    renderTranscript({
      turns: [
        turn({ id: "1", at: "t", role: "assistant", kind: "message", text: "A" }),
        turn({ id: "2", at: "t", role: "user", kind: "message", text: "B" }),
      ],
    });

    expect(screen.getByRole("log")).toBeTruthy();
    expect(screen.getByRole("article", { name: "Assistant" })).toBeTruthy();
    expect(screen.getByRole("article", { name: "You" })).toBeTruthy();
  });

  it("renders a card-response turn as a user bubble", () => {
    renderTranscript({
      turns: [
        turn({
          id: "1",
          at: "t",
          role: "user",
          kind: "card-response",
          cardId: "c1",
          response: {},
        }),
      ],
    });
    expect(screen.getByText(/response recorded/i)).toBeTruthy();
  });

  it("renders the registered drop-zone body for an upload-prefill card, not the placeholder", () => {
    const { container } = renderTranscript({
      turns: [
        turn({
          id: "1",
          at: "t",
          role: "assistant",
          kind: "card",
          card: { type: "upload-prefill", payload: {} },
        }),
      ],
    });

    const card = container.querySelector('[data-card-type="upload-prefill"]');
    expect(card).not.toBeNull();
    expect(card?.textContent).toMatch(/drag your pre-fill report here/i);
    expect(card?.textContent).not.toMatch(/handled later in the interview/i);
  });

  it("shows the thinking affordance only while typing", () => {
    const base: ConversationTurn[] = [
      turn({ id: "1", at: "t", role: "user", kind: "message", text: "hello" }),
    ];

    const { rerender } = renderTranscript({ turns: base });
    expect(screen.queryByText(/the assistant is thinking/i)).toBeNull();

    rerender(
      <ChatTranscript
        turns={base}
        returnId="ret1"
        revision={1}
        readOnly={false}
        onCardResult={() => {}}
        typing
      />,
    );
    expect(screen.getByText(/the assistant is thinking/i)).toBeTruthy();
  });
});
