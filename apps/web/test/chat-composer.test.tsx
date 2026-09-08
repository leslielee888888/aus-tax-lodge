// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatComposer } from "../components/chat/ChatComposer";

afterEach(cleanup);

function getInput() {
  return screen.getByLabelText(/type your answer/i) as HTMLTextAreaElement;
}
function getSendButton() {
  return screen.getByRole("button", { name: /send message/i }) as HTMLButtonElement;
}

describe("ChatComposer (PRD FR-1)", () => {
  it("submitting calls onSend with the trimmed typed text and clears the field", () => {
    const onSend = vi.fn();
    render(<ChatComposer onSend={onSend} pending={false} />);

    const input = getInput();
    fireEvent.change(input, { target: { value: "  worked from home 3 days a week  " } });
    fireEvent.submit(input.closest("form")!);

    expect(onSend).toHaveBeenCalledExactlyOnceWith("worked from home 3 days a week");
    expect(input.value).toBe("");
  });

  it("sends on Enter but not on Shift+Enter", () => {
    const onSend = vi.fn();
    render(<ChatComposer onSend={onSend} pending={false} />);

    const input = getInput();
    fireEvent.change(input, { target: { value: "yes" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("yes");
  });

  it("disables send with an empty / whitespace-only field", () => {
    render(<ChatComposer onSend={vi.fn()} pending={false} />);
    expect(getSendButton().disabled).toBe(true);

    fireEvent.change(getInput(), { target: { value: "   " } });
    expect(getSendButton().disabled).toBe(true);

    fireEvent.change(getInput(), { target: { value: "hello" } });
    expect(getSendButton().disabled).toBe(false);
  });

  it("does not send while a previous send is pending", () => {
    const onSend = vi.fn();
    render(<ChatComposer onSend={onSend} pending />);

    const input = getInput();
    fireEvent.change(input, { target: { value: "hello" } });
    expect(getSendButton().disabled).toBe(true);

    fireEvent.submit(input.closest("form")!);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });
});
