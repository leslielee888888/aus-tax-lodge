// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { sendMessage } from "../app/returns/[returnId]/actions";
import { ChatScreen } from "../components/chat/ChatScreen";
import { appendTurn, emptyConversation, type ConversationState } from "../lib/conversation";

vi.mock("../app/returns/[returnId]/actions", () => ({ sendMessage: vi.fn() }));

const sendMessageMock = vi.mocked(sendMessage);

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  sendMessageMock.mockReset();
});

async function send(text: string) {
  const input = screen.getByLabelText(/type your answer/i);
  fireEvent.change(input, { target: { value: text } });
  fireEvent.submit(input.closest("form")!);
}

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

describe("ChatScreen — a resumable pause vs a hard error (FR-14)", () => {
  function resultWith(overrides: Record<string, unknown>) {
    return {
      conversation: appendTurn(conversation({ phase: "interview" }), {
        role: "assistant",
        kind: "message",
        text: "…",
      }),
      revision: 2,
      ...overrides,
    };
  }

  it("shows a calm role=status 'paused' note (not the red alert) on a rate limit", async () => {
    sendMessageMock.mockResolvedValue(
      resultWith({ rateLimited: true, error: "Paused — resend shortly." }),
    );
    renderScreen();
    await send("here is my answer");

    const paused = await screen.findByRole("status");
    expect(paused.textContent).toMatch(/paused/i);
    expect(paused.textContent).toMatch(/progress is saved/i);
    expect(screen.queryByRole("alert")).toBeNull();
    // The composer stays live so the user can resend.
    expect(screen.getByLabelText(/type your answer/i)).toBeTruthy();
  });

  it("shows the red role=alert error (not the pause note) on a generic failure", async () => {
    sendMessageMock.mockResolvedValue(resultWith({ error: "Something went wrong on that step." }));
    renderScreen();
    await send("here is my answer");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/something went wrong/i);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("clears the pause note on the next successful send", async () => {
    sendMessageMock.mockResolvedValueOnce(resultWith({ rateLimited: true, error: "Paused." }));
    renderScreen();
    await send("first try");
    await screen.findByRole("status");

    sendMessageMock.mockResolvedValueOnce(resultWith({}));
    await send("second try");
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });
});
