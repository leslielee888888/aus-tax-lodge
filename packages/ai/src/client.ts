import Anthropic from "@anthropic-ai/sdk";

/**
 * The Claude model the assistant uses for every call (PRD §8 / Q2). Multimodal,
 * cost-effective for document work.
 */
export const CLAUDE_MODEL = "claude-sonnet-5";

/** Beta header the Claude subscription OAuth token requires (`claude setup-token`). */
const OAUTH_BETA_HEADER = "oauth-2025-04-20";

/**
 * The resolved Claude credential from `@aus-tax-lodge/config`. Exactly one of
 * the two token fields is set, matching `claudeCredential`.
 */
export interface ClaudeCredentials {
  readonly claudeCredential: "ANTHROPIC_API_KEY" | "CLAUDE_CODE_OAUTH_TOKEN";
  readonly anthropicApiKey?: string;
  readonly claudeCodeOauthToken?: string;
}

export interface AskOptions {
  /** System prompt. */
  readonly system?: string;
  /** Response token ceiling. Default 1024. */
  readonly maxTokens?: number;
  /** Override the model. Default {@link CLAUDE_MODEL}. */
  readonly model?: string;
}

/** A document part for a multimodal call — an image or a PDF. */
export interface VisionPart {
  readonly kind: "image" | "pdf";
  /** `image/png`, `image/jpeg`, or `application/pdf`. */
  readonly mimeType: string;
  readonly bytes: Buffer;
}

/**
 * The narrow surface the rest of the app builds on. Figure extraction (T11)
 * consumes this same interface — keep it general.
 */
export interface ClaudeClient {
  /** A plain text prompt in, the model's text response out. */
  ask(prompt: string, options?: AskOptions): Promise<string>;
  /** One or more document parts plus a prompt, the model's text response out. */
  askVision(parts: readonly VisionPart[], prompt: string, options?: AskOptions): Promise<string>;
}

type MessageContent = Anthropic.MessageParam["content"];

/** Builds the user-message content array for a multimodal request. */
export function buildVisionContent(parts: readonly VisionPart[], prompt: string): MessageContent {
  const blocks = parts.map((part) => {
    const data = part.bytes.toString("base64");
    if (part.kind === "pdf") {
      return {
        type: "document" as const,
        source: {
          type: "base64" as const,
          media_type: "application/pdf" as const,
          data,
        },
      };
    }
    return {
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: part.mimeType as "image/png" | "image/jpeg",
        data,
      },
    };
  });
  return [...blocks, { type: "text" as const, text: prompt }];
}

function firstText(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

/**
 * Constructs a {@link ClaudeClient} over the Anthropic SDK using the credential
 * resolved in `@aus-tax-lodge/config`. The subscription OAuth token is sent as a
 * bearer auth token with the `anthropic-beta: oauth-2025-04-20` header; a
 * pay-as-you-go API key uses the standard `x-api-key` path.
 */
export function createClaudeClient(credentials: ClaudeCredentials): ClaudeClient {
  const sdk =
    credentials.claudeCredential === "CLAUDE_CODE_OAUTH_TOKEN"
      ? new Anthropic({
          authToken: credentials.claudeCodeOauthToken,
          defaultHeaders: { "anthropic-beta": OAUTH_BETA_HEADER },
        })
      : new Anthropic({ apiKey: credentials.anthropicApiKey });

  async function send(content: MessageContent, options: AskOptions): Promise<string> {
    const message = await sdk.messages.create({
      model: options.model ?? CLAUDE_MODEL,
      max_tokens: options.maxTokens ?? 1024,
      ...(options.system ? { system: options.system } : {}),
      messages: [{ role: "user", content }],
    });
    return firstText(message);
  }

  return {
    ask(prompt, options = {}) {
      return send(prompt, options);
    },
    askVision(parts, prompt, options = {}) {
      return send(buildVisionContent(parts, prompt), options);
    },
  };
}
