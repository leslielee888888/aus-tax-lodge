/**
 * T10 — `lib/ai/failure.ts` classifies a caught failure during the conversation
 * into a typed, user-facing outcome (FR-14).
 */
import { RateLimitError } from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import { classifyConversationFailure } from "../lib/ai/failure";

const SECRET = "sk-ant-verysecrettoken";

describe("classifyConversationFailure — rate limit (FR-14, the common case)", () => {
  it("detects a real Anthropic RateLimitError instance", () => {
    const err = new RateLimitError(429, { error: {} }, "429 Too Many Requests", new Headers());
    const failure = classifyConversationFailure(err, { step: "answer" });

    expect(failure.kind).toBe("rate-limit");
    expect(failure.resumablePause).toBe(true);
    expect(failure.retryHint).toBe("resend-message");
    expect(failure.assistantMessage).toMatch(/usage limit/i);
    expect(failure.assistantMessage).toMatch(/saved/i);
    expect(failure.assistantMessage).toMatch(/send your last message again/i);
  });

  it("detects a duck-typed status:429 on a wrapped/plain error", () => {
    const failure = classifyConversationFailure(Object.assign(new Error("boom"), { status: 429 }), {
      step: "answer",
    });
    expect(failure.kind).toBe("rate-limit");
    expect(failure.resumablePause).toBe(true);
  });

  it("detects a 429 nested under `cause`", () => {
    const failure = classifyConversationFailure(
      { message: "wrapped", cause: { status: 429 } },
      { step: "card" },
    );
    expect(failure.kind).toBe("rate-limit");
    expect(failure.resumablePause).toBe(true);
  });

  it("tells a document step to upload again, not resend a message", () => {
    const failure = classifyConversationFailure({ status: 429 }, { step: "extraction" });
    expect(failure.kind).toBe("rate-limit");
    expect(failure.retryHint).toBe("reupload-document");
    expect(failure.assistantMessage).toMatch(/upload it again/i);
  });
});

describe("classifyConversationFailure — non-rate-limit failures (FR-14)", () => {
  it("maps a generic Claude/network error to claude-error, not a pause", () => {
    const failure = classifyConversationFailure(new Error("socket hang up"), { step: "answer" });
    expect(failure.kind).toBe("claude-error");
    expect(failure.resumablePause).toBe(false);
    expect(failure.assistantMessage).toMatch(/progress is saved/i);
    expect(failure.assistantMessage).toMatch(/try/i);
  });

  it("maps an extraction step to extraction-failed with a 'tell me the figures' out", () => {
    const failure = classifyConversationFailure(new Error("vision failed"), { step: "extraction" });
    expect(failure.kind).toBe("extraction-failed");
    expect(failure.resumablePause).toBe(false);
    expect(failure.retryHint).toBe("reupload-document");
    expect(failure.assistantMessage).toMatch(/couldn't read that file/i);
    expect(failure.assistantMessage).toMatch(/tell me the figures/i);
  });

  it("maps a scope-check step to scope-check-incomplete and does not assume in-scope", () => {
    const failure = classifyConversationFailure(new Error("scope timeout"), {
      step: "scope-check",
    });
    expect(failure.kind).toBe("scope-check-incomplete");
    expect(failure.resumablePause).toBe(false);
    expect(failure.assistantMessage).toMatch(/couldn't finish checking/i);
    expect(failure.assistantMessage).toMatch(/not moved on|progress is saved/i);
  });

  it("a rate limit still wins over the step (extraction + 429 → rate-limit)", () => {
    const failure = classifyConversationFailure({ status: 429 }, { step: "scope-check" });
    expect(failure.kind).toBe("rate-limit");
  });

  it("classifies a nullish caught value as unknown without throwing", () => {
    expect(classifyConversationFailure(undefined, { step: "answer" }).kind).toBe("unknown");
    expect(classifyConversationFailure(null, { step: "card" }).kind).toBe("unknown");
  });
});

describe("classifyConversationFailure — never leaks raw error text (FR-14)", () => {
  it("keeps the provider message, stack and any secret out of the user-facing string", () => {
    const err = Object.assign(new Error(`auth failed for ${SECRET}`), {
      status: 401,
      stack: `Error: auth failed for ${SECRET}\n    at foo (bar.ts:1:1)`,
    });
    for (const step of ["answer", "document", "card", "scope-check", "extraction"] as const) {
      const { assistantMessage } = classifyConversationFailure(err, { step });
      expect(assistantMessage).not.toContain(SECRET);
      expect(assistantMessage).not.toMatch(/auth failed/i);
      expect(assistantMessage).not.toMatch(/\bat \w+ \(/);
    }
  });
});
