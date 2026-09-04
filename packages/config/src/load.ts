import { config as loadDotenv } from "dotenv";

import { ConfigError } from "./errors";
import type { AppConfig, ClaudeCredentialKind } from "./types";

export interface LoadConfigOptions {
  /**
   * Environment record to read from. Default `process.env`. Mutated in place: a
   * blank `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN` is deleted so it cannot
   * shadow the other credential downstream (the Claude CLI prefers
   * `ANTHROPIC_API_KEY` whenever it is present, even empty).
   */
  env?: NodeJS.ProcessEnv;
  /** Load a local `.env` file into `process.env` first. Default `true`. */
  loadDotenvFile?: boolean;
}

const AES_256_KEY_BYTES = 32;

function trimmedOrUndefined(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Decodes and validates the AES-256 key. Accepts hex (64 chars) or base64 (44 chars). */
function decodeEncryptionKey(raw: string): Buffer {
  if (/^[0-9a-fA-F]+$/.test(raw)) {
    if (raw.length === AES_256_KEY_BYTES * 2) return Buffer.from(raw, "hex");
    throw new ConfigError(
      `RETURN_ENCRYPTION_KEY looks hex-encoded but is ${raw.length} characters — ` +
        "a 32-byte AES-256 key is 64 hex characters (try `openssl rand -hex 32`)",
    );
  }

  const decoded = Buffer.from(raw, "base64");
  const roundTrips = decoded.toString("base64").replace(/=+$/, "") === raw.replace(/=+$/, "");
  if (decoded.length === AES_256_KEY_BYTES && roundTrips) return decoded;

  throw new ConfigError(
    "RETURN_ENCRYPTION_KEY must be a 32-byte AES-256 key, hex-encoded (64 characters) " +
      "or base64-encoded (44 characters) — generate one with `openssl rand -hex 32`",
  );
}

/**
 * Reads and validates the runtime configuration from the environment:
 *
 *  - `RETURN_ENCRYPTION_KEY` — the AES-256 key for at-rest encryption (PRD FR-17).
 *  - exactly one Claude credential — `CLAUDE_CODE_OAUTH_TOKEN` **or**
 *    `ANTHROPIC_API_KEY` (PRD §8). Both set is an error; a blank
 *    `ANTHROPIC_API_KEY` is cleared so it cannot shadow the OAuth token.
 *
 * Invalid or missing config throws a {@link ConfigError} whose message names
 * exactly what is wrong and is safe to print (no secret values, no stack trace).
 */
export function loadConfig(options: LoadConfigOptions = {}): AppConfig {
  const { env = process.env, loadDotenvFile = true } = options;

  if (loadDotenvFile) loadDotenv();

  // A blank credential var must behave exactly like an unset one. Delete it from
  // the environment so a child process (the Claude CLI) never sees it either.
  for (const name of ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"] as const) {
    const value = env[name];
    if (value !== undefined && value.trim() === "") delete env[name];
  }

  const rawKey = trimmedOrUndefined(env.RETURN_ENCRYPTION_KEY);
  if (rawKey === undefined) {
    throw new ConfigError(
      "RETURN_ENCRYPTION_KEY is not set — it is the AES-256 key that encrypts " +
        "return.json and uploaded documents at rest (FR-17)",
    );
  }
  const encryptionKey = decodeEncryptionKey(rawKey);

  const apiKey = trimmedOrUndefined(env.ANTHROPIC_API_KEY);
  const oauthToken = trimmedOrUndefined(env.CLAUDE_CODE_OAUTH_TOKEN);

  if (apiKey !== undefined && oauthToken !== undefined) {
    throw new ConfigError(
      "ANTHROPIC_API_KEY and CLAUDE_CODE_OAUTH_TOKEN are both set — set exactly one " +
        "(the Claude CLI prefers the API key, which defeats a subscription OAuth token)",
    );
  }
  if (apiKey === undefined && oauthToken === undefined) {
    throw new ConfigError(
      "no Claude credential set — set CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`, " +
        "a Claude subscription) or ANTHROPIC_API_KEY (pay-as-you-go)",
    );
  }

  const claudeCredential: ClaudeCredentialKind =
    oauthToken !== undefined ? "CLAUDE_CODE_OAUTH_TOKEN" : "ANTHROPIC_API_KEY";

  return {
    encryptionKey,
    claudeCredential,
    secrets: {
      returnEncryptionKey: rawKey,
      ...(apiKey !== undefined ? { anthropicApiKey: apiKey } : {}),
      ...(oauthToken !== undefined ? { claudeCodeOauthToken: oauthToken } : {}),
    },
  };
}
