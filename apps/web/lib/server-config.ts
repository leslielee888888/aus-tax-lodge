import { type AppConfig, loadConfig } from "@aus-tax-lodge/config";

let cached: AppConfig | undefined;

/**
 * Validates the process environment (`RETURN_ENCRYPTION_KEY` + exactly one
 * Claude credential) and caches the result. Server-only.
 *
 * The unlock gate, the encrypted document store and per-return persistence wire
 * this in at T10 / T13 / T14. Nothing calls it yet, so `next build` stays free
 * of an environment requirement — but the cross-package import is typechecked.
 */
export function getServerConfig(): AppConfig {
  return (cached ??= loadConfig());
}
