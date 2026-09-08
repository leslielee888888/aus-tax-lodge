// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UploadPrefillCard } from "../components/chat/cards/UploadPrefillCard";
import type { AssistantCardTurn } from "../lib/conversation";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const TURN: AssistantCardTurn = {
  id: "c1",
  at: "t",
  role: "assistant",
  kind: "card",
  card: { type: "upload-prefill", payload: {} },
};

function renderCard(props: Partial<Parameters<typeof UploadPrefillCard>[0]> = {}) {
  const onResult = vi.fn();
  render(
    <UploadPrefillCard
      returnId="ret1"
      revision={4}
      turn={TURN}
      readOnly={false}
      onResult={onResult}
      {...props}
    />,
  );
  return { onResult };
}

function pdf(): File {
  return new File(["%PDF-1.4"], "prefill.pdf", { type: "application/pdf" });
}

describe("UploadPrefillCard (PRD FR-1)", () => {
  it("renders the drop zone, the browse control and the help lines", () => {
    renderCard();

    expect(screen.getByText(/drag your pre-fill report here/i)).toBeTruthy();
    expect(screen.getByText(/browse for it/i)).toBeTruthy();
    expect(screen.getByText(/myGov → ATO → Tax → Lodgments/i)).toBeTruthy();
    expect(screen.getByText(/late July or August/i)).toBeTruthy();

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.accept).toBe(".pdf,application/pdf");
  });

  it("shows an uploading/reading state while the POST is in flight, then hands the result up", async () => {
    let resolve!: (value: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise<Response>((r) => (resolve = r)),
    );

    const { onResult } = renderCard();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, { target: { files: [pdf()] } });

    expect(await screen.findByText(/uploading…/i)).toBeTruthy();

    resolve(
      new Response(JSON.stringify({ ok: true, conversation: { turns: [] }, revision: 5 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await waitFor(() =>
      expect(onResult).toHaveBeenCalledWith({ conversation: { turns: [] }, revision: 5 }),
    );
    expect(await screen.findByText(/reading it now/i)).toBeTruthy();
  });

  it("surfaces a wrong-type response and keeps the zone usable", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          reason: "wrong-type",
          conversation: { turns: [] },
          revision: 5,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const { onResult } = renderCard();
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [pdf()] },
    });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/pre-fill report/i);
    expect(onResult).toHaveBeenCalled();
    expect(screen.getByText(/drag your pre-fill report here/i)).toBeTruthy();
  });

  it("disables the input when read-only", () => {
    renderCard({ readOnly: true });
    expect((document.querySelector('input[type="file"]') as HTMLInputElement).disabled).toBe(true);
  });

  it("shows a calm role=status pause note (not a hard failure) on a rate-limited upload (FR-14)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          reason: "unreadable",
          rateLimited: true,
          conversation: { turns: [] },
          revision: 5,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    renderCard();
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [pdf()] },
    });

    const status = await screen.findByRole("status");
    expect(status.textContent).toMatch(/paused/i);
    expect(screen.queryByRole("alert")).toBeNull();
    // The drop zone stays usable.
    expect((document.querySelector('input[type="file"]') as HTMLInputElement).disabled).toBe(false);
    expect(screen.getByText(/drag your pre-fill report here/i)).toBeTruthy();
  });
});
