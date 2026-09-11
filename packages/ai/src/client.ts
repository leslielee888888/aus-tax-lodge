/**
 * T16 — the Claude transport for the whole app, now built on the Claude Agent
 * SDK (`@anthropic-ai/claude-agent-sdk`) instead of raw `@anthropic-ai/sdk`
 * HTTP calls.
 *
 * Why: Leslie's Claude subscription authenticates fine, but a raw
 * `messages.create` call — or raw HTTP with the same OAuth bearer token —
 * gets rejected with a `429 rate_limit_error`. A live `rate_limit_event` from
 * the Agent SDK confirmed the cause: `overageDisabledReason:
 * "org_level_disabled"`, with 5-hour/7-day utilization at 3%/0% — not a usage
 * cap. Raw API-style access outside the actual Claude Code product is not
 * enabled for this account at the org level; waiting does not fix it. The
 * Agent SDK spawns the real Claude Code CLI as a subprocess and authenticates
 * the exact same token successfully — proven live with a plain-text call and
 * a real-PDF vision classification call.
 *
 * The public contract below (`ClaudeClient`, `AskOptions`, `VisionPart`,
 * `CLAUDE_MODEL`) is unchanged — every consumer (`classify.ts`,
 * `@aus-tax-lodge/extraction`, the interview turn handlers) needs zero
 * changes. Only what is inside `createClaudeClient` changed.
 *
 * Credentials: the Agent SDK's subprocess authenticates via environment
 * variables it inherits (`CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`) —
 * `query()` has no field for passing a token through its options. This
 * module still takes a resolved `ClaudeCredentials` object (so
 * `apps/web/lib/ai/client.ts` needs no change beyond the T16 cleanup), but
 * only uses it to fail fast if the environment doesn't actually carry the
 * credential `@aus-tax-lodge/config` resolved — `@aus-tax-lodge/config`
 * already validates that exactly one of the two env vars is set and strips a
 * blank one, so this module does not duplicate that check.
 *
 * `query` itself is loaded with a dynamic `await import(...)` inside
 * {@link runTurn}, not a static top-level import (matching the wiring pattern
 * in the sibling `pr-review-dashboard` project's `packages/core/src/review/sdk.ts`).
 * This is load-bearing, not stylistic: this task's Docker/standalone-build
 * verification found that a static import lets webpack inline the whole SDK
 * into the compiled Next.js server chunk, which bakes the *build machine's*
 * absolute filesystem path into the bundle (the SDK resolves its own on-disk
 * location via `createRequire(import.meta.url)`, which webpack evaluates
 * statically at bundle time) — the app then fails wherever that path doesn't
 * exist, in every deployment. `serverExternalPackages` in `next.config.ts`
 * alone did not stop this once the import happens inside a `transpilePackages`
 * entry (`@aus-tax-lodge/ai` ships raw TypeScript and must be transpiled). A
 * dynamic import keeps the SDK a genuine runtime `require`, resolved by Node
 * from `node_modules` — see the comments in the repo-root `Dockerfile` (the
 * `build` and `runner` stages) for the rest of the fix this required.
 */
import type {
  Options,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";

/**
 * The Claude model the assistant uses for every call (PRD §8 / Q2). Multimodal,
 * cost-effective for document work.
 */
export const CLAUDE_MODEL = "claude-sonnet-5";

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
  /**
   * Response token ceiling. Default 1024.
   *
   * NOTE (T16): the Agent SDK's `query()` has no per-call response-length
   * option — `Options` (see `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`)
   * carries nothing equivalent to the raw Messages API's `max_tokens`. This
   * field is kept on the public type (callers must not need to change) but is
   * no longer wired through anywhere. Every caller today uses it as a
   * cost/length hint, not a hard contract the response must respect, so
   * dropping it changes no observed behaviour.
   */
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

/**
 * An error from a Claude Agent SDK turn. Carries `.status` so the existing
 * duck-typed classifier in `apps/web/lib/ai/failure.ts`
 * (`err?.status === 429`) still recognises a rate limit without any change to
 * that file — the thrown value is no longer an `Anthropic.RateLimitError`
 * instance, since there is no raw HTTP response to construct one from.
 *
 * The message is always a short, fixed description of *what happened* (a
 * subtype name, a fixed phrase) — never the raw prompt, a provider error
 * body, or anything else that could carry document contents or a secret.
 */
export class ClaudeAgentTurnError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ClaudeAgentTurnError";
    if (status !== undefined) this.status = status;
  }
}

const RATE_LIMIT_PATTERN = /rate.?limit/i;

function mentionsRateLimit(text: string | undefined): boolean {
  return typeof text === "string" && RATE_LIMIT_PATTERN.test(text);
}

/**
 * Verifies the environment variable the Agent SDK subprocess will actually
 * read is present and consistent with what `@aus-tax-lodge/config` resolved.
 * `@aus-tax-lodge/config` already validates that exactly one of
 * `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN` is set (and strips a blank
 * one) before this ever runs — this is a fail-fast check, not a re-validation
 * of that logic.
 */
function assertEnvCredential(credentials: ClaudeCredentials): void {
  const envVarName =
    credentials.claudeCredential === "CLAUDE_CODE_OAUTH_TOKEN"
      ? "CLAUDE_CODE_OAUTH_TOKEN"
      : "ANTHROPIC_API_KEY";
  const envValue = process.env[envVarName];

  if (envValue === undefined || envValue.trim() === "") {
    throw new Error(
      `createClaudeClient: process.env.${envVarName} is not set. The Claude Agent SDK ` +
        "authenticates its spawned CLI subprocess by inheriting environment variables — " +
        "it has no field on query()'s options for passing a credential directly — so " +
        `${envVarName} must be set in the environment before createClaudeClient() runs.`,
    );
  }

  const passedValue =
    credentials.claudeCredential === "CLAUDE_CODE_OAUTH_TOKEN"
      ? credentials.claudeCodeOauthToken
      : credentials.anthropicApiKey;
  if (passedValue !== undefined && passedValue !== envValue) {
    throw new Error(
      `createClaudeClient: the resolved ${credentials.claudeCredential} credential does not match ` +
        `process.env.${envVarName}. The Agent SDK subprocess authenticates from the environment ` +
        "value, not the one passed to this function, so a mismatch here would silently run the " +
        "wrong credential.",
    );
  }
}

/** The `Options` shared by every `ask`/`askVision` turn. */
function turnOptions(options: AskOptions): Options {
  return {
    // Isolation: don't load ~/.claude, project settings, or CLAUDE.md — this
    // is a one-shot API-style call, not an interactive coding session.
    settingSources: [],
    ...(options.system !== undefined ? { systemPrompt: options.system } : {}),
    model: options.model ?? CLAUDE_MODEL,
    maxTurns: 1,
    tools: [],
    allowedTools: [],
    permissionMode: "dontAsk",
    persistSession: false,
    includePartialMessages: false,
  };
}

/**
 * Turns a finished `SDKResultMessage` into the model's text reply, or throws a
 * {@link ClaudeAgentTurnError}. A rate limit is recognised three ways (per the
 * live-tested `rate_limit_event` shape): a `rate_limit_event` with
 * `status: "rejected"` seen earlier in the stream, `api_error_status === 429`
 * on the result, or the result/errors text mentioning a rate limit.
 */
function finishResult(
  message: SDKResultMessage,
  textParts: readonly string[],
  sawRejectedRateLimit: boolean,
): string {
  if (message.subtype === "success") {
    const apiErrorStatus = message.api_error_status ?? undefined;
    const rateLimited =
      sawRejectedRateLimit ||
      apiErrorStatus === 429 ||
      (message.is_error && mentionsRateLimit(message.result));
    if (rateLimited) {
      throw new ClaudeAgentTurnError("the Claude Agent SDK turn was rate-limited", 429);
    }
    if (message.is_error) {
      throw new ClaudeAgentTurnError(
        "the Claude Agent SDK turn ended on an API error",
        apiErrorStatus,
      );
    }

    const combined = textParts.join("").trim();
    // The stream normally carries the reply as assistant text blocks; fall
    // back to `result` (the SDK's own doc comment: subtype "success" carries
    // the final assistant text in `result`) if none arrived.
    return combined.length > 0 ? combined : message.result.trim();
  }

  // SDKResultError — the turn ended early (`error_during_execution`,
  // `error_max_turns`, ...) without a usable reply.
  const detail = message.errors.join("; ");
  const rateLimited = sawRejectedRateLimit || mentionsRateLimit(detail);
  if (rateLimited) {
    throw new ClaudeAgentTurnError(
      `the Claude Agent SDK turn ended with "${message.subtype}"`,
      429,
    );
  }
  throw new ClaudeAgentTurnError(`the Claude Agent SDK turn ended with "${message.subtype}"`);
}

/**
 * Runs one Agent SDK turn to completion and returns the model's text reply.
 * Shared by `ask` (a plain string prompt) and `askVision` (a streaming-input
 * async generator carrying document/image content blocks).
 */
async function runTurn(
  prompt: string | AsyncIterable<SDKUserMessage>,
  options: AskOptions,
): Promise<string> {
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  const stream = query({ prompt, options: turnOptions(options) });

  const textParts: string[] = [];
  let sawRejectedRateLimit = false;

  for await (const message of stream as AsyncIterable<SDKMessage>) {
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "text") textParts.push(block.text);
      }
      continue;
    }
    if (message.type === "rate_limit_event") {
      if (message.rate_limit_info.status === "rejected") sawRejectedRateLimit = true;
      continue;
    }
    if (message.type === "result") {
      return finishResult(message, textParts, sawRejectedRateLimit);
    }
  }

  throw new ClaudeAgentTurnError("the Claude Agent SDK stream ended without a result message");
}

type ImageMimeType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

/** One user-message content block for a vision (`askVision`) turn. */
type VisionContentBlock =
  | {
      readonly type: "document";
      readonly source: {
        readonly type: "base64";
        readonly media_type: "application/pdf";
        readonly data: string;
      };
    }
  | {
      readonly type: "image";
      readonly source: {
        readonly type: "base64";
        readonly media_type: ImageMimeType;
        readonly data: string;
      };
    }
  | { readonly type: "text"; readonly text: string };

/**
 * Builds the single streaming-input user message a vision turn sends. A plain
 * string `prompt` (the non-vision path `query()` also accepts) can't carry
 * document/image content blocks, so `askVision` uses the streaming-input form
 * instead — confirmed working live against a real PDF.
 */
async function* visionInput(
  parts: readonly VisionPart[],
  prompt: string,
): AsyncGenerator<SDKUserMessage> {
  const content: VisionContentBlock[] = [
    ...parts.map((part): VisionContentBlock =>
      part.kind === "pdf"
        ? {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: part.bytes.toString("base64"),
            },
          }
        : {
            type: "image",
            source: {
              type: "base64",
              media_type: part.mimeType as ImageMimeType,
              data: part.bytes.toString("base64"),
            },
          },
    ),
    { type: "text", text: prompt },
  ];

  yield {
    type: "user",
    message: { role: "user", content },
    parent_tool_use_id: null,
  };
}

/**
 * Constructs a {@link ClaudeClient} over the Claude Agent SDK using the
 * credential resolved in `@aus-tax-lodge/config`. The spawned CLI subprocess
 * authenticates from the environment it inherits (`CLAUDE_CODE_OAUTH_TOKEN`
 * for the subscription OAuth token, `ANTHROPIC_API_KEY` for a pay-as-you-go
 * key) — see the file header for why this replaced a raw `@anthropic-ai/sdk`
 * client (T16).
 */
export function createClaudeClient(credentials: ClaudeCredentials): ClaudeClient {
  assertEnvCredential(credentials);

  return {
    ask(prompt, options = {}) {
      return runTurn(prompt, options);
    },
    askVision(parts, prompt, options = {}) {
      return runTurn(visionInput(parts, prompt), options);
    },
  };
}
