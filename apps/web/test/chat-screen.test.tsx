// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ChatScreen } from "../components/chat/ChatScreen";
import { emptyConversation, type ConversationState } from "../lib/conversation";

vi.mock("../app/returns/[returnId]/actions", () => ({ sendMessage: vi.fn() }));

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

function conversation(overrides: Partial<ConversationState> = {}): ConversationState {
  return { ...emptyConversation(), ...overrides };
}

function renderScreen(props: Partial<Parameters<typeof ChatScreen>[0]> = {}) {
  return render(
    <ChatScreen
      returnId="ret1"
      initialConversation={conversation({ phase: "interview" })}
      initialRevision={1}
      readOnly={false}
      {...props}
    />,
  );
}

describe("ChatScreen composer visibility (PRD FR-9, FR-12)", () => {
  it("shows the composer for an editable, in-progress return", () => {
    renderScreen();
    expect(screen.getByLabelText(/type your answer/i)).toBeTruthy();
  });

  it("hides the composer and shows a locked note when the return is read-only", () => {
    renderScreen({ readOnly: true });
    expect(screen.queryByLabelText(/type your answer/i)).toBeNull();
    expect(screen.getByText(/this return is locked/i)).toBeTruthy();
  });

  it("hides the composer and shows a stopped note when the conversation has stopped", () => {
    renderScreen({
      initialConversation: conversation({ phase: "stopped", stoppedReason: "capital gains event" }),
    });
    expect(screen.queryByLabelText(/type your answer/i)).toBeNull();
    expect(screen.getByText(/this conversation has stopped/i)).toBeTruthy();
    expect(screen.getByText(/capital gains event/i)).toBeTruthy();
  });

  it("renders the transcript for a read-only return", () => {
    renderScreen({
      readOnly: true,
      initialConversation: conversation({
        phase: "exported",
        turns: [
          { id: "1", at: "t", role: "assistant", kind: "message", text: "Your package is ready" },
        ],
      }),
    });
    expect(screen.getByText("Your package is ready")).toBeTruthy();
  });
});
