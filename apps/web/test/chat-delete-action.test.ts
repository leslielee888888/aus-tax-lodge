import { beforeEach, describe, expect, it, vi } from "vitest";

const { repoDeleteReturn, redirect } = vi.hoisted(() => ({
  repoDeleteReturn: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("../lib/returns", () => ({
  getReturnRepository: () => ({ deleteReturn: repoDeleteReturn }),
  loadConversation: vi.fn(),
  saveConversation: vi.fn(),
  ConversationReadOnlyError: class ConversationReadOnlyError extends Error {},
}));
vi.mock("../lib/ai/client", () => ({ getClaudeClient: () => ({ ask: vi.fn() }) }));
vi.mock("../lib/interview", () => ({ applyUserTurn: vi.fn(), nextTurn: vi.fn() }));

import { deleteReturn } from "../app/returns/[returnId]/actions";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("deleteReturn (PRD FR-9, FR-20 — the chat's only way out of a hard stop)", () => {
  it("recursively deletes the return then redirects home", async () => {
    repoDeleteReturn.mockResolvedValue(undefined);

    await deleteReturn("ret1");

    expect(repoDeleteReturn).toHaveBeenCalledWith("ret1");
    expect(redirect).toHaveBeenCalledWith("/");
  });

  it("does not redirect if the delete fails", async () => {
    repoDeleteReturn.mockRejectedValue(new Error("store gone"));

    await expect(deleteReturn("ret1")).rejects.toThrow("store gone");
    expect(redirect).not.toHaveBeenCalled();
  });
});
