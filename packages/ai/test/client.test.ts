import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  SDKAssistantMessage,
  SDKMessage,
  SDKRateLimitEvent,
  SDKResultMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";

/**
 * `@anthropic-ai/claude-agent-sdk`'s `query()` is mocked at the module
 * boundary — it's an async generator in real use, so every fixture here
 * builds one too. `vi.hoisted` so the mock factory below can close over it.
 */
const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: queryMock,
}));

// Imported after the mock so `createClaudeClient` picks up the mocked `query`.
const { createClaudeClient, ClaudeAgentTurnError } = await import("../src/client");

/** Builds the async generator `query()` returns, from a fixed message list. */
function fakeStream(messages: readonly SDKMessage[]): AsyncGenerator<SDKMessage, void> {
  async function* generate(): AsyncGenerator<SDKMessage, void> {
    for (const message of messages) yield message;
  }
  return generate();
}

/** A syntactically valid UUID — several SDK message types type `uuid` as a UUID template literal. */
const FAKE_UUID = "11111111-1111-1111-1111-111111111111";

function assistantText(text: string): SDKAssistantMessage {
  // `message` is typed as the full Anthropic `BetaMessage` shape; a fixture
  // only needs the `content` blocks this client reads, so cast through
  // `unknown` rather than filling in every unrelated required field.
  return {
    type: "assistant",
    message: { id: "msg_1", role: "assistant", content: [{ type: "text", text }] },
    parent_tool_use_id: null,
    uuid: FAKE_UUID,
    session_id: "session-1",
  } as unknown as SDKAssistantMessage;
}

function resultSuccess(overrides: Partial<SDKResultMessage> = {}): SDKResultMessage {
  return {
    type: "result",
    subtype: "success",
    duration_ms: 1,
    duration_api_ms: 1,
    is_error: false,
    api_error_status: null,
    num_turns: 1,
    result: "",
    stop_reason: null,
    total_cost_usd: 0,
    usage: {},
    modelUsage: {},
    permission_denials: [],
    errors: [],
    uuid: FAKE_UUID,
    session_id: "session-1",
    ...overrides,
  } as SDKResultMessage;
}

function resultError(overrides: Partial<SDKResultMessage> = {}): SDKResultMessage {
  return {
    type: "result",
    subtype: "error_during_execution",
    duration_ms: 1,
    duration_api_ms: 1,
    is_error: true,
    num_turns: 0,
    stop_reason: null,
    total_cost_usd: 0,
    usage: {},
    modelUsage: {},
    permission_denials: [],
    errors: [],
    uuid: FAKE_UUID,
    session_id: "session-1",
    ...overrides,
  } as SDKResultMessage;
}

function rateLimitEvent(status: "allowed" | "allowed_warning" | "rejected"): SDKRateLimitEvent {
  return {
    type: "rate_limit_event",
    rate_limit_info: { status },
    uuid: FAKE_UUID,
    session_id: "session-1",
  } as unknown as SDKRateLimitEvent;
}

describe("createClaudeClient", () => {
  beforeEach(() => {
    queryMock.mockReset();
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    delete process.env.ANTHROPIC_API_KEY;
  });

  describe("credential fail-fast", () => {
    it("throws if CLAUDE_CODE_OAUTH_TOKEN is not set in process.env", () => {
      expect(() =>
        createClaudeClient({
          claudeCredential: "CLAUDE_CODE_OAUTH_TOKEN",
          claudeCodeOauthToken: "sk-ant-oat01-x",
        }),
      ).toThrow(/CLAUDE_CODE_OAUTH_TOKEN/);
    });

    it("throws if ANTHROPIC_API_KEY is not set in process.env", () => {
      expect(() =>
        createClaudeClient({ claudeCredential: "ANTHROPIC_API_KEY", anthropicApiKey: "sk-ant-x" }),
      ).toThrow(/ANTHROPIC_API_KEY/);
    });

    it("throws if the passed credential does not match the environment value", () => {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = "sk-ant-oat01-env-value";
      expect(() =>
        createClaudeClient({
          claudeCredential: "CLAUDE_CODE_OAUTH_TOKEN",
          claudeCodeOauthToken: "sk-ant-oat01-different",
        }),
      ).toThrow(/does not match/);
    });

    it("succeeds when the environment carries the matching credential", () => {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = "sk-ant-oat01-x";
      const client = createClaudeClient({
        claudeCredential: "CLAUDE_CODE_OAUTH_TOKEN",
        claudeCodeOauthToken: "sk-ant-oat01-x",
      });
      expect(typeof client.ask).toBe("function");
      expect(typeof client.askVision).toBe("function");
    });
  });

  describe("ask", () => {
    beforeEach(() => {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = "sk-ant-oat01-x";
    });

    it("accumulates assistant text blocks and returns them on a successful turn", async () => {
      queryMock.mockReturnValue(
        fakeStream([assistantText("hello "), assistantText("world"), resultSuccess()]),
      );

      const client = createClaudeClient({
        claudeCredential: "CLAUDE_CODE_OAUTH_TOKEN",
        claudeCodeOauthToken: "sk-ant-oat01-x",
      });
      const reply = await client.ask("hi", { system: "be terse" });

      expect(reply).toBe("hello world");
      expect(queryMock).toHaveBeenCalledTimes(1);
      const call = queryMock.mock.calls[0]?.[0] as {
        prompt: unknown;
        options: Record<string, unknown>;
      };
      expect(call.prompt).toBe("hi");
      expect(call.options).toMatchObject({
        systemPrompt: "be terse",
        model: "claude-sonnet-5",
        maxTurns: 1,
        tools: [],
        allowedTools: [],
        permissionMode: "dontAsk",
        persistSession: false,
        settingSources: [],
      });
    });

    it("falls back to the result's `result` text when no assistant text block arrived", async () => {
      queryMock.mockReturnValue(fakeStream([resultSuccess({ result: "fallback text" })]));
      const client = createClaudeClient({
        claudeCredential: "CLAUDE_CODE_OAUTH_TOKEN",
        claudeCodeOauthToken: "sk-ant-oat01-x",
      });

      await expect(client.ask("hi")).resolves.toBe("fallback text");
    });

    it("throws a ClaudeAgentTurnError when the result subtype is not success", async () => {
      queryMock.mockReturnValue(
        fakeStream([resultError({ subtype: "error_max_turns", errors: ["too many turns"] })]),
      );
      const client = createClaudeClient({
        claudeCredential: "CLAUDE_CODE_OAUTH_TOKEN",
        claudeCodeOauthToken: "sk-ant-oat01-x",
      });

      await expect(client.ask("hi")).rejects.toBeInstanceOf(ClaudeAgentTurnError);
    });

    it("leaves .status unset for a non-rate-limit error result", async () => {
      queryMock.mockReturnValue(
        fakeStream([resultError({ subtype: "error_max_turns", errors: ["too many turns"] })]),
      );
      const client = createClaudeClient({
        claudeCredential: "CLAUDE_CODE_OAUTH_TOKEN",
        claudeCodeOauthToken: "sk-ant-oat01-x",
      });

      const err = await client.ask("hi").catch((caught: unknown) => caught);
      expect(err).toBeInstanceOf(ClaudeAgentTurnError);
      expect((err as InstanceType<typeof ClaudeAgentTurnError>).status).toBeUndefined();
    });

    it("throws with status 429 when a rate_limit_event reports 'rejected'", async () => {
      queryMock.mockReturnValue(fakeStream([rateLimitEvent("rejected"), resultSuccess()]));
      const client = createClaudeClient({
        claudeCredential: "CLAUDE_CODE_OAUTH_TOKEN",
        claudeCodeOauthToken: "sk-ant-oat01-x",
      });

      const err = await client.ask("hi").catch((caught: unknown) => caught);
      expect(err).toBeInstanceOf(ClaudeAgentTurnError);
      expect((err as InstanceType<typeof ClaudeAgentTurnError>).status).toBe(429);
    });

    it("ignores an 'allowed' rate_limit_event", async () => {
      queryMock.mockReturnValue(
        fakeStream([rateLimitEvent("allowed"), assistantText("fine"), resultSuccess()]),
      );
      const client = createClaudeClient({
        claudeCredential: "CLAUDE_CODE_OAUTH_TOKEN",
        claudeCodeOauthToken: "sk-ant-oat01-x",
      });

      await expect(client.ask("hi")).resolves.toBe("fine");
    });

    it("maps api_error_status 429 on a success-shaped is_error result to a 429", async () => {
      queryMock.mockReturnValue(
        fakeStream([
          resultSuccess({ is_error: true, api_error_status: 429, result: "rate limited" }),
        ]),
      );
      const client = createClaudeClient({
        claudeCredential: "CLAUDE_CODE_OAUTH_TOKEN",
        claudeCodeOauthToken: "sk-ant-oat01-x",
      });

      const err = await client.ask("hi").catch((caught: unknown) => caught);
      expect((err as InstanceType<typeof ClaudeAgentTurnError>).status).toBe(429);
    });

    it("carries a non-429 api_error_status through on a success-shaped is_error result", async () => {
      queryMock.mockReturnValue(
        fakeStream([
          resultSuccess({ is_error: true, api_error_status: 500, result: "server error" }),
        ]),
      );
      const client = createClaudeClient({
        claudeCredential: "CLAUDE_CODE_OAUTH_TOKEN",
        claudeCodeOauthToken: "sk-ant-oat01-x",
      });

      const err = await client.ask("hi").catch((caught: unknown) => caught);
      expect((err as InstanceType<typeof ClaudeAgentTurnError>).status).toBe(500);
    });
  });

  describe("askVision", () => {
    beforeEach(() => {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = "sk-ant-oat01-x";
    });

    it("sends a streaming-input user message with a document block plus the prompt text", async () => {
      queryMock.mockReturnValue(fakeStream([assistantText("ato-prefill-report"), resultSuccess()]));
      const client = createClaudeClient({
        claudeCredential: "CLAUDE_CODE_OAUTH_TOKEN",
        claudeCodeOauthToken: "sk-ant-oat01-x",
      });

      const reply = await client.askVision(
        [{ kind: "pdf", mimeType: "application/pdf", bytes: Buffer.from("%PDF-1.7 fixture") }],
        "classify this",
        { system: "you are a classifier" },
      );

      expect(reply).toBe("ato-prefill-report");
      const call = queryMock.mock.calls[0]?.[0] as { prompt: AsyncIterable<SDKUserMessage> };
      const received: SDKUserMessage[] = [];
      for await (const message of call.prompt) received.push(message);

      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
        type: "user",
        parent_tool_use_id: null,
        message: {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: Buffer.from("%PDF-1.7 fixture").toString("base64"),
              },
            },
            { type: "text", text: "classify this" },
          ],
        },
      });
    });

    it("sends an image block for a non-PDF part", async () => {
      queryMock.mockReturnValue(fakeStream([assistantText("income-statement"), resultSuccess()]));
      const client = createClaudeClient({
        claudeCredential: "CLAUDE_CODE_OAUTH_TOKEN",
        claudeCodeOauthToken: "sk-ant-oat01-x",
      });

      await client.askVision(
        [{ kind: "image", mimeType: "image/jpeg", bytes: Buffer.from("jpg") }],
        "classify",
      );

      const call = queryMock.mock.calls[0]?.[0] as { prompt: AsyncIterable<SDKUserMessage> };
      const received: SDKUserMessage[] = [];
      for await (const message of call.prompt) received.push(message);
      const content = received[0]?.message.content;
      expect(content).toMatchObject([
        { type: "image", source: { type: "base64", media_type: "image/jpeg" } },
        { type: "text", text: "classify" },
      ]);
    });
  });
});
