import { createClaudeClient, type ClaudeClient } from "@aus-tax-lodge/ai";

import { getServerConfig } from "../server-config";

let cached: ClaudeClient | undefined;

/**
 * The shared Claude client, authenticated with the credential resolved in
 * `@aus-tax-lodge/config` (`CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`).
 * Server-only; cached for the process. Document classification (T10) and figure
 * extraction (T11) both go through this.
 */
export function getClaudeClient(): ClaudeClient {
  if (!cached) {
    const config = getServerConfig();
    cached = createClaudeClient({
      claudeCredential: config.claudeCredential,
      anthropicApiKey: config.secrets.anthropicApiKey,
      claudeCodeOauthToken: config.secrets.claudeCodeOauthToken,
    });
  }
  return cached;
}
