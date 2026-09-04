import type { AppConfig } from "./types";
import { SECRET_ENV_NAMES, SECRET_KEYS } from "./types";

const REDACTED = "[redacted]";

/**
 * Every non-empty secret string a config holds, in each encoding it might appear
 * in — pass to {@link redact} before logging anything derived from the config.
 */
export function secretValues(config: AppConfig): string[] {
  const candidates = [
    config.secrets.returnEncryptionKey,
    config.secrets.anthropicApiKey,
    config.secrets.claudeCodeOauthToken,
    config.encryptionKey.toString("hex"),
    config.encryptionKey.toString("base64"),
  ];
  return candidates.filter((v): v is string => typeof v === "string" && v.length > 0);
}

/**
 * Returns a deep copy of `value` with every occurrence of any of `secrets`
 * replaced by `[redacted]`. Use before logging anything that might embed a
 * secret (PRD FR-17 / "secret hygiene").
 */
export function redact<T>(value: T, secrets: readonly string[]): T {
  const needles = secrets.filter((s) => s.length > 0);
  if (needles.length === 0) return value;

  const scrub = (input: unknown): unknown => {
    if (typeof input === "string") {
      let out = input;
      for (const needle of needles) {
        if (out.includes(needle)) out = out.split(needle).join(REDACTED);
      }
      return out;
    }
    if (Array.isArray(input)) return input.map(scrub);
    if (input !== null && typeof input === "object") {
      return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, scrub(v)]));
    }
    return input;
  };

  return scrub(value) as T;
}

/**
 * A human-readable dump of the resolved configuration for startup logs. Secret
 * values are never included — each is shown only as `<set>` / `<unused>` (PRD
 * FR-17 / "secret hygiene").
 */
export function describeConfig(config: AppConfig): string {
  const lines = [
    "Resolved configuration:",
    `  claude credential   ${config.claudeCredential}`,
    `  encryption key      ${config.encryptionKey.length} bytes (AES-256)`,
    "  secrets:",
  ];
  for (const key of SECRET_KEYS) {
    lines.push(`    ${SECRET_ENV_NAMES[key]}: ${config.secrets[key] ? "<set>" : "<unused>"}`);
  }
  return lines.join("\n");
}
