import { describe, expect, it } from "vitest";

import { buildVisionContent, createClaudeClient } from "../src/client";

describe("buildVisionContent", () => {
  it("emits a document block for a PDF and a trailing text block", () => {
    const content = buildVisionContent(
      [{ kind: "pdf", mimeType: "application/pdf", bytes: Buffer.from("pdf") }],
      "classify this",
    ) as unknown as Array<Record<string, unknown>>;

    expect(content).toHaveLength(2);
    expect(content[0]).toMatchObject({
      type: "document",
      source: { type: "base64", media_type: "application/pdf" },
    });
    expect(content[1]).toEqual({ type: "text", text: "classify this" });
  });

  it("emits an image block for a PNG/JPEG with the right media_type", () => {
    const content = buildVisionContent(
      [{ kind: "image", mimeType: "image/jpeg", bytes: Buffer.from("jpg") }],
      "x",
    ) as unknown as Array<Record<string, unknown>>;
    expect(content[0]).toMatchObject({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg" },
    });
  });
});

describe("createClaudeClient", () => {
  it("builds a client for the OAuth-token credential", () => {
    const client = createClaudeClient({
      claudeCredential: "CLAUDE_CODE_OAUTH_TOKEN",
      claudeCodeOauthToken: "sk-ant-oat01-fake",
    });
    expect(typeof client.ask).toBe("function");
    expect(typeof client.askVision).toBe("function");
  });

  it("builds a client for the API-key credential", () => {
    const client = createClaudeClient({
      claudeCredential: "ANTHROPIC_API_KEY",
      anthropicApiKey: "sk-ant-fake",
    });
    expect(typeof client.askVision).toBe("function");
  });
});
