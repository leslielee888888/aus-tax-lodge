// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ChatTranscript } from "../components/chat/ChatTranscript";
import type { ConversationTurn } from "../lib/conversation";

afterEach(cleanup);

function turn(partial: ConversationTurn): ConversationTurn {
  return partial;
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
        card: { type: "income-checkpoint" },
      }),
    ];

    const { container } = render(<ChatTranscript turns={turns} />);
    const text = container.textContent ?? "";

    expect(text.indexOf("Hello from the assistant")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("Hello from the assistant")).toBeLessThan(text.indexOf("Hi back"));
    expect(text.indexOf("Hi back")).toBeLessThan(text.indexOf("prefill-2025-26.pdf"));
    expect(text.indexOf("prefill-2025-26.pdf")).toBeLessThan(
      text.indexOf("Review the income from your pre-fill report"),
    );

    const card = container.querySelector('[data-card-type="income-checkpoint"]');
    expect(card).not.toBeNull();
    expect(card?.textContent).toMatch(/handled later in the interview/i);
  });

  it("labels each turn by role and exposes a live log region", () => {
    render(
      <ChatTranscript
        turns={[
          turn({ id: "1", at: "t", role: "assistant", kind: "message", text: "A" }),
          turn({ id: "2", at: "t", role: "user", kind: "message", text: "B" }),
        ]}
      />,
    );

    expect(screen.getByRole("log")).toBeTruthy();
    expect(screen.getByRole("article", { name: "Assistant" })).toBeTruthy();
    expect(screen.getByRole("article", { name: "You" })).toBeTruthy();
  });

  it("renders a card-response turn as a user bubble", () => {
    render(
      <ChatTranscript
        turns={[
          turn({
            id: "1",
            at: "t",
            role: "user",
            kind: "card-response",
            cardId: "c1",
            response: {},
          }),
        ]}
      />,
    );
    expect(screen.getByText(/response recorded/i)).toBeTruthy();
  });

  it("shows the first-load upload prompt when the conversation is empty", () => {
    const { container } = render(<ChatTranscript turns={[]} />);

    expect(
      screen.getByText(
        "Hi — I'll help you put together your 2025–26 return. To start, upload your ATO pre-fill report.",
      ),
    ).toBeTruthy();
    expect(container.querySelector('[data-card-type="upload-prefill"]')).not.toBeNull();
  });

  it("shows the thinking affordance only while typing", () => {
    const base: ConversationTurn[] = [
      turn({ id: "1", at: "t", role: "user", kind: "message", text: "hello" }),
    ];

    const { rerender } = render(<ChatTranscript turns={base} />);
    expect(screen.queryByText(/the assistant is thinking/i)).toBeNull();

    rerender(<ChatTranscript turns={base} typing />);
    expect(screen.getByText(/the assistant is thinking/i)).toBeTruthy();
  });
});
