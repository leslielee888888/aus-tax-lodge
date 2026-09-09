// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { provideIdentity } = vi.hoisted(() => ({ provideIdentity: vi.fn() }));
vi.mock("../app/returns/[returnId]/actions", () => ({ provideIdentity }));

import { IdentityCard } from "../components/chat/cards/IdentityCard";
import type { AssistantCardTurn } from "../lib/conversation";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function turn(payload: unknown = {}): AssistantCardTurn {
  return {
    id: "card1",
    at: "t",
    role: "assistant",
    kind: "card",
    card: { type: "identity", payload },
  };
}

function renderCard(props: Record<string, unknown> = {}) {
  const onResult = vi.fn();
  render(
    <IdentityCard
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

function fillValidForm() {
  fireEvent.change(screen.getByLabelText(/tax file number/i), { target: { value: "123456782" } });
  fireEvent.change(screen.getByLabelText(/^bsb$/i), { target: { value: "062-000" } });
  fireEvent.change(screen.getByLabelText(/account number/i), { target: { value: "87654321" } });
  fireEvent.change(screen.getByLabelText(/account name/i), { target: { value: "Priya Example" } });
}

describe("IdentityCard (PRD FR-1, FR-17, #88 / T15)", () => {
  it("masks the TFN input (type=password) so it is never shown in plain text", () => {
    renderCard();
    const tfnInput = screen.getByLabelText(/tax file number/i) as HTMLInputElement;
    expect(tfnInput.type).toBe("password");
    expect(tfnInput.getAttribute("inputmode")).toBe("numeric");
  });

  it("labels every field and gives the TFN an aria-describedby hint", () => {
    renderCard();
    const tfnInput = screen.getByLabelText(/tax file number/i);
    expect(tfnInput.getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.getByLabelText(/^bsb$/i)).toBeTruthy();
    expect(screen.getByLabelText(/account number/i)).toBeTruthy();
    expect(screen.getByLabelText(/account name/i)).toBeTruthy();
  });

  it("blocks submit and shows role=alert errors on invalid input, without calling the server", () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /save details/i }));
    const alerts = screen.getAllByRole("alert");
    expect(alerts.length).toBeGreaterThan(0);
    expect(provideIdentity).not.toHaveBeenCalled();
  });

  it("rejects a TFN that fails the ATO checksum", () => {
    renderCard();
    fireEvent.change(screen.getByLabelText(/tax file number/i), { target: { value: "999999999" } });
    fireEvent.change(screen.getByLabelText(/^bsb$/i), { target: { value: "062-000" } });
    fireEvent.change(screen.getByLabelText(/account number/i), { target: { value: "87654321" } });
    fireEvent.change(screen.getByLabelText(/account name/i), {
      target: { value: "Priya Example" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save details/i }));
    expect(screen.getByText(/doesn.t check out/i)).toBeTruthy();
    expect(provideIdentity).not.toHaveBeenCalled();
  });

  it("normalises the BSB on blur", () => {
    renderCard();
    const bsbInput = screen.getByLabelText(/^bsb$/i) as HTMLInputElement;
    fireEvent.change(bsbInput, { target: { value: "062000" } });
    fireEvent.blur(bsbInput);
    expect(bsbInput.value).toBe("062-000");
  });

  it("submits valid values and shows a neutral 'Details provided' confirmation, never echoing them", async () => {
    provideIdentity.mockResolvedValue({ conversation: { turns: [] }, revision: 5 });
    const { onResult } = renderCard();

    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: /save details/i }));

    await waitFor(() =>
      expect(provideIdentity).toHaveBeenCalledWith("ret1", 4, "card1", {
        tfn: "123456782",
        bsb: "062-000",
        accountNumber: "87654321",
        accountName: "Priya Example",
      }),
    );
    await waitFor(() =>
      expect(onResult).toHaveBeenCalledWith({ conversation: { turns: [] }, revision: 5 }),
    );
    expect(await screen.findByText(/details provided/i)).toBeTruthy();
    expect(screen.queryByText("123456782")).toBeNull();
    expect(screen.queryByText("87654321")).toBeNull();
  });

  it("surfaces a server-side error inline without crashing", async () => {
    provideIdentity.mockResolvedValue({
      conversation: { turns: [] },
      revision: 4,
      error: "Check the tax file number and bank account details and try again.",
    });
    renderCard();
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: /save details/i }));
    expect(await screen.findByText(/check the tax file number/i)).toBeTruthy();
  });

  it("disables every input and the submit button when readOnly", () => {
    renderCard({ readOnly: true });
    expect((screen.getByLabelText(/tax file number/i) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText(/^bsb$/i) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText(/account number/i) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText(/account name/i) as HTMLInputElement).disabled).toBe(true);
    expect(
      (screen.getByRole("button", { name: /save details/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("renders the lead text from the payload when present", () => {
    renderCard({ turn: turn({ lead: "Last thing — your details for the refund." }) });
    expect(screen.getByText(/last thing/i)).toBeTruthy();
  });
});
