import {
  createClaudeClient,
  type AskOptions,
  type ClaudeClient,
  type VisionPart,
} from "@aus-tax-lodge/ai";

import { getServerConfig } from "../server-config";

let cached: ClaudeClient | undefined;

/**
 * TEMPORARY (2026-09-10, remove once Sonnet 5 / Opus 5 clear the rate limit
 * they're currently hitting on Leslie's subscription): wraps a {@link ClaudeClient}
 * so every `ask`/`askVision` call carries a forced `model`, read from
 * `CLAUDE_MODEL_OVERRIDE`. Explicitly requested — Leslie wants to keep testing
 * on the subscription token (not pay-as-you-go) while Sonnet/Opus are blocked;
 * Haiku 4.5 still has headroom. Lives entirely in `apps/web` — it never touches
 * `@aus-tax-lodge/ai` — so removing it (delete this function, drop the env var,
 * revert `getClaudeClient` to call `createClaudeClient(...)` directly) is a
 * one-file, one-commit revert.
 *
 * Accuracy risk while this is active: the document classification and figure
 * extraction this app depends on were built and tuned against Sonnet 5's vision
 * reasoning. Haiku is meaningfully weaker at precisely reading a misaligned
 * pre-fill report — every figure it proposes should be checked before trusting
 * it, exactly as the app's own confirmation flow already asks the user to do
 * for a doubtful figure.
 */
function withModelOverride(client: ClaudeClient, model: string): ClaudeClient {
  return {
    ask: (prompt: string, options?: AskOptions) => client.ask(prompt, { ...options, model }),
    askVision: (parts: readonly VisionPart[], prompt: string, options?: AskOptions) =>
      client.askVision(parts, prompt, { ...options, model }),
  };
}

/**
 * The shared Claude client, authenticated with the credential resolved in
 * `@aus-tax-lodge/config` (`CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`).
 * Server-only; cached for the process. Document classification (T10) and figure
 * extraction (T11) both go through this.
 */
export function getClaudeClient(): ClaudeClient {
  if (!cached) {
    const config = getServerConfig();
    const base = createClaudeClient({
      claudeCredential: config.claudeCredential,
      anthropicApiKey: config.secrets.anthropicApiKey,
      claudeCodeOauthToken: config.secrets.claudeCodeOauthToken,
    });
    const override = process.env.CLAUDE_MODEL_OVERRIDE?.trim();
    cached = override ? withModelOverride(base, override) : base;
  }
  return cached;
}
