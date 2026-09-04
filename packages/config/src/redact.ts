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
    config.secrets.appPassphrase,
    config.secrets.anthropicApiKey,
    config.secrets.claudeCodeOauthToken,
    config.encryptionKey.toString("hex"),
    config.encryptionKey.toString("base64"),
  ];
  return candidates.filter((v): v is string => typeof v === "string" && v.length > 0);
}

function isPlainObject(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Returns a copy of `value` safe to log: every occurrence of any of `secrets` in
 * a string is replaced by `[redacted]` (PRD FR-17 / "secret hygiene").
 *
 * Only plain objects and arrays are rebuilt and recursed into. Other object
 * types are collapsed to a short marker rather than corrupted into `{}` — a
 * `Buffer` becomes `"[Buffer]"`, an `Error` becomes `"[Name: <scrubbed
 * message>]"`, a `Date` is passed through, a `Map`/`Set` becomes `"[Map(n)]"` /
 * `"[Set(n)]"`, any other class instance becomes `"[ClassName]"`. A circular
 * reference renders as `"[Circular]"`. The return type is `unknown` because the
 * shape genuinely changes.
 */
export function redact(value: unknown, secrets: readonly string[]): unknown {
  const needles = secrets.filter((s) => s.length > 0);
  if (needles.length === 0) return value;

  const scrubString = (input: string): string => {
    let out = input;
    for (const needle of needles) {
      if (out.includes(needle)) out = out.split(needle).join(REDACTED);
    }
    return out;
  };

  const seen = new WeakSet<object>();

  const scrub = (input: unknown): unknown => {
    if (typeof input === "string") return scrubString(input);
    if (typeof input === "function") return "[Function]";
    if (typeof input !== "object" || input === null) return input;

    if (seen.has(input)) return "[Circular]";

    if (Buffer.isBuffer(input)) return "[Buffer]";
    if (input instanceof Error) return `[${input.name}: ${scrubString(input.message)}]`;
    if (input instanceof Date) return input;
    if (input instanceof Map) return `[Map(${input.size})]`;
    if (input instanceof Set) return `[Set(${input.size})]`;

    if (Array.isArray(input)) {
      seen.add(input);
      const out = input.map(scrub);
      seen.delete(input);
      return out;
    }

    if (isPlainObject(input)) {
      seen.add(input);
      const out = Object.fromEntries(Object.entries(input).map(([key, val]) => [key, scrub(val)]));
      seen.delete(input);
      return out;
    }

    const name = (input.constructor as { name?: string } | undefined)?.name ?? "Object";
    return `[${name}]`;
  };

  return scrub(value);
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
    `  data dir            ${config.dataDir}`,
    "  secrets:",
  ];
  for (const key of SECRET_KEYS) {
    lines.push(`    ${SECRET_ENV_NAMES[key]}: ${config.secrets[key] ? "<set>" : "<unused>"}`);
  }
  return lines.join("\n");
}
