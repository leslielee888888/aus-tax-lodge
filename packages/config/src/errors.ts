/**
 * Thrown when configuration is invalid or a required secret is missing or
 * malformed. The message always starts with `Config error:` and names exactly
 * what is wrong — it is meant to be printed as-is, not as a stack trace. It
 * never contains a secret value (PRD FR-17, non-functional "secret hygiene").
 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message.startsWith("Config error:") ? message : `Config error: ${message}`);
    this.name = "ConfigError";
  }
}
