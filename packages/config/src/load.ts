import { resolve } from "node:path";

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

const HEX_ONLY = /^[0-9a-fA-F]+$/;
const BASE64_ANY = /^[A-Za-z0-9+/\-_]+={0,2}$/;

/**
 * Decodes and validates the AES-256 key. Accepts a 64-character hex string, or a
 * base64 / base64url string, whichever decodes to exactly 32 bytes. The encoding
 * is classified by the decoded byte length, not by which alphabet the string
 * happens to fit — a 44-character hex-only string is a truncated key, not proof
 * of base64.
 */
function decodeEncryptionKey(raw: string): Buffer {
  const attempts: string[] = [];

  if (HEX_ONLY.test(raw) && raw.length % 2 === 0) {
    const hex = Buffer.from(raw, "hex");
    if (hex.length === AES_256_KEY_BYTES) return hex;
    attempts.push(`${hex.length} bytes as hex`);
  }

  if (BASE64_ANY.test(raw)) {
    // Normalise base64url (`-` `_`) to the standard alphabet before decoding.
    const base64 = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    if (base64.length === AES_256_KEY_BYTES) return base64;
    attempts.push(`${base64.length} bytes as base64`);
  }

  const detail = attempts.length > 0 ? ` (got ${attempts.join(", ")})` : "";
  throw new ConfigError(
    "RETURN_ENCRYPTION_KEY must be a 32-byte AES-256 key, hex-encoded (64 characters) " +
      `or base64-encoded (44 characters)${detail} — generate one with \`openssl rand -hex 32\``,
  );
}

/**
 * Reads and validates the runtime configuration from the environment:
 *
 *  - `RETURN_ENCRYPTION_KEY` — the AES-256 key for at-rest encryption (PRD FR-17).
 *  - `APP_PASSPHRASE` — the shared passphrase that gates access to the app (PRD
 *    FR-17). Required; an access gate only, independent of the encryption key.
 *  - `DATA_DIR` — where the encrypted per-return data lives on the volume (PRD
 *    FR-16 / §8). Optional; resolved to an absolute path, default `./data`.
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

  const appPassphrase = trimmedOrUndefined(env.APP_PASSPHRASE);
  if (appPassphrase === undefined) {
    throw new ConfigError(
      "APP_PASSPHRASE is not set — it is the shared passphrase that gates access " +
        "to the app (FR-17). It only controls access and is independent of " +
        "RETURN_ENCRYPTION_KEY, so it can be changed on the NAS with the data intact",
    );
  }

  const dataDir = resolve(trimmedOrUndefined(env.DATA_DIR) ?? "data");

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
    dataDir,
    claudeCredential,
    secrets: {
      returnEncryptionKey: rawKey,
      appPassphrase,
      ...(apiKey !== undefined ? { anthropicApiKey: apiKey } : {}),
      ...(oauthToken !== undefined ? { claudeCodeOauthToken: oauthToken } : {}),
    },
  };
}
