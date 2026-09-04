/** Which Claude credential the app authenticates with — exactly one is ever set. */
export type ClaudeCredentialKind = "ANTHROPIC_API_KEY" | "CLAUDE_CODE_OAUTH_TOKEN";

export interface AppSecrets {
  /** Raw `RETURN_ENCRYPTION_KEY` value as supplied (hex or base64). */
  returnEncryptionKey: string;
  /**
   * `APP_PASSPHRASE` — the shared passphrase that gates access to the app
   * (PRD FR-17). An access gate only: it is **independent of**
   * `returnEncryptionKey`, so changing it on the NAS leaves the encrypted data
   * intact. Always set — the app is unusable without it.
   */
  appPassphrase: string;
  /** Set only when the pay-as-you-go Anthropic API key is the active credential. */
  anthropicApiKey?: string;
  /** Set only when the Claude subscription OAuth token is the active credential. */
  claudeCodeOauthToken?: string;
}

export interface AppConfig {
  /** Decoded 32-byte AES-256 key for `return.json` + document encryption (PRD FR-17). */
  readonly encryptionKey: Buffer;
  /**
   * Absolute path to the directory holding the encrypted per-return data on the
   * mounted volume (PRD FR-16 / §8 — no database). Returns live under
   * `<dataDir>/returns/<returnId>/`. From `DATA_DIR`, default `./data`.
   */
  readonly dataDir: string;
  /** Which Claude credential is active. The value under it lives in {@link AppConfig.secrets}. */
  readonly claudeCredential: ClaudeCredentialKind;
  readonly secrets: AppSecrets;
}

export const SECRET_KEYS = [
  "returnEncryptionKey",
  "appPassphrase",
  "anthropicApiKey",
  "claudeCodeOauthToken",
] as const;
export type SecretKey = (typeof SECRET_KEYS)[number];

/** Maps each {@link AppSecrets} key to its environment-variable name, for messages. */
export const SECRET_ENV_NAMES: Record<SecretKey, string> = {
  returnEncryptionKey: "RETURN_ENCRYPTION_KEY",
  appPassphrase: "APP_PASSPHRASE",
  anthropicApiKey: "ANTHROPIC_API_KEY",
  claudeCodeOauthToken: "CLAUDE_CODE_OAUTH_TOKEN",
};
