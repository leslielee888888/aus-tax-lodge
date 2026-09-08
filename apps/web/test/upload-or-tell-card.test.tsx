// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { tellFigureInstead } = vi.hoisted(() => ({ tellFigureInstead: vi.fn() }));
vi.mock("../app/returns/[returnId]/actions", () => ({ tellFigureInstead }));

import { UploadOrTellCard } from "../components/chat/cards/UploadOrTellCard";
import type { AssistantCardTurn } from "../lib/conversation";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function turn(
  payload: unknown = { lead: "How much did you spend on union fees?" },
): AssistantCardTurn {
  return {
    id: "card1",
    at: "t",
    role: "assistant",
    kind: "card",
    card: { type: "upload-or-tell", payload },
  };
}

function renderCard(props: Record<string, unknown> = {}) {
  const onResult = vi.fn();
  render(
    <UploadOrTellCard
      returnId="ret1"
      revision={4}
      turn={turn()}
      readOnly={false}
      onResult={onResult}
      {...props}
    />,
  );
  return { onResult };
}

describe("UploadOrTellCard (PRD FR-6)", () => {
  it("shows the lead, a drop zone and an 'I'll just tell you' affordance — no checklist", () => {
    renderCard();
    expect(screen.getByText(/union fees/i)).toBeTruthy();
    expect(screen.getByText(/drop one document here/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /tell you/i })).toBeTruthy();
    expect(screen.queryByText(/documents you should provide/i)).toBeNull();
  });

  it("'I'll just tell you' records the choice and nudges the composer", async () => {
    tellFigureInstead.mockResolvedValue({ conversation: { turns: [] }, revision: 5 });
    const { onResult } = renderCard();

    fireEvent.click(screen.getByRole("button", { name: /tell you/i }));

    await waitFor(() => expect(tellFigureInstead).toHaveBeenCalledWith("ret1", 4, "card1"));
    await waitFor(() =>
      expect(onResult).toHaveBeenCalledWith({ conversation: { turns: [] }, revision: 5 }),
    );
    expect(await screen.findByText(/type the figure in the message box/i)).toBeTruthy();
  });

  it("uploads a dropped file to the mid-conversation document route and hands the result up", async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve({
        json: async () => ({ ok: true, conversation: { turns: [] }, revision: 6 }),
      } as Response),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { onResult } = renderCard();

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["%PDF"], "agent-statement.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/returns/ret1/interview-document");
    await waitFor(() =>
      expect(onResult).toHaveBeenCalledWith({ conversation: { turns: [] }, revision: 6 }),
    );
    expect(await screen.findByText(/reading that now/i)).toBeTruthy();
  });

  it("locks after an out-of-scope response", async () => {
    const fetchMock = vi.fn(async () => ({
      json: async () => ({
        ok: false,
        reason: "out-of-scope",
        conversation: { turns: [] },
        revision: 7,
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    renderCard();

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(["x"], "trust.pdf", { type: "application/pdf" })] },
    });

    expect(await screen.findByText(/can't continue/i)).toBeTruthy();
  });

  it("disables both paths when read-only", () => {
    renderCard({ readOnly: true });
    expect((screen.getByRole("button", { name: /tell you/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((document.querySelector('input[type="file"]') as HTMLInputElement).disabled).toBe(true);
  });
});
