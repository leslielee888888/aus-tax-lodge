import { describe, expect, it } from "vitest";

import { ConfigError, describeConfig, loadConfig, redact, secretValues } from "../src/index";

const HEX_KEY = "a1b2c3d4".repeat(8); // 64 hex chars => 32 bytes
const B64_KEY = Buffer.from("b".repeat(32)).toString("base64"); // 44 chars => 32 bytes
const OAUTH_TOKEN = "sk-ant-oat01-fake-subscription-token-0000";
const API_KEY = "sk-ant-fake-api-key-1111";

function baseEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    RETURN_ENCRYPTION_KEY: HEX_KEY,
    CLAUDE_CODE_OAUTH_TOKEN: OAUTH_TOKEN,
    ...overrides,
  } as NodeJS.ProcessEnv;
}

function load(env: NodeJS.ProcessEnv) {
  return loadConfig({ env, loadDotenvFile: false });
}

describe("loadConfig — valid config", () => {
  it("loads a hex encryption key and an OAuth token", () => {
    const config = load(baseEnv());
    expect(config.claudeCredential).toBe("CLAUDE_CODE_OAUTH_TOKEN");
    expect(config.encryptionKey).toHaveLength(32);
    expect(config.secrets.claudeCodeOauthToken).toBe(OAUTH_TOKEN);
    expect(config.secrets.anthropicApiKey).toBeUndefined();
  });

  it("accepts a base64-encoded encryption key", () => {
    const config = load(baseEnv({ RETURN_ENCRYPTION_KEY: B64_KEY }));
    expect(config.encryptionKey).toHaveLength(32);
  });

  it("accepts ANTHROPIC_API_KEY as the sole Claude credential", () => {
    const config = load(
      baseEnv({ CLAUDE_CODE_OAUTH_TOKEN: undefined, ANTHROPIC_API_KEY: API_KEY }),
    );
    expect(config.claudeCredential).toBe("ANTHROPIC_API_KEY");
    expect(config.secrets.anthropicApiKey).toBe(API_KEY);
    expect(config.secrets.claudeCodeOauthToken).toBeUndefined();
  });
});

describe("loadConfig — invalid config fails startup with a clear message", () => {
  it("rejects a missing encryption key, naming it", () => {
    expect(() => load(baseEnv({ RETURN_ENCRYPTION_KEY: undefined }))).toThrow(ConfigError);
    expect(() => load(baseEnv({ RETURN_ENCRYPTION_KEY: undefined }))).toThrow(
      /RETURN_ENCRYPTION_KEY is not set/,
    );
  });

  it("rejects a blank encryption key", () => {
    expect(() => load(baseEnv({ RETURN_ENCRYPTION_KEY: "   " }))).toThrow(
      /RETURN_ENCRYPTION_KEY is not set/,
    );
  });

  it("rejects a malformed encryption key", () => {
    expect(() => load(baseEnv({ RETURN_ENCRYPTION_KEY: "deadbeef" }))).toThrow(
      /32-byte AES-256 key is 64 hex characters/,
    );
    expect(() => load(baseEnv({ RETURN_ENCRYPTION_KEY: "not a valid key!!" }))).toThrow(
      /must be a 32-byte AES-256 key/,
    );
  });

  it("rejects both Claude credentials set at once", () => {
    expect(() => load(baseEnv({ ANTHROPIC_API_KEY: API_KEY }))).toThrow(
      /ANTHROPIC_API_KEY and CLAUDE_CODE_OAUTH_TOKEN are both set/,
    );
  });

  it("rejects no Claude credential", () => {
    expect(() => load(baseEnv({ CLAUDE_CODE_OAUTH_TOKEN: undefined }))).toThrow(
      /no Claude credential set/,
    );
  });

  it("throws a ConfigError, not a bare stack trace", () => {
    try {
      load(baseEnv({ RETURN_ENCRYPTION_KEY: undefined }));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as Error).message.startsWith("Config error: ")).toBe(true);
    }
  });
});

describe("a blank ANTHROPIC_API_KEY cannot shadow the OAuth token", () => {
  it("clears a blank ANTHROPIC_API_KEY and keeps the OAuth token", () => {
    const env = baseEnv({ ANTHROPIC_API_KEY: "   " });
    const config = load(env);
    expect(config.claudeCredential).toBe("CLAUDE_CODE_OAUTH_TOKEN");
    expect(config.secrets.anthropicApiKey).toBeUndefined();
    // removed from the environment so a child process never sees it either
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect("ANTHROPIC_API_KEY" in env).toBe(false);
  });

  it("treats an empty-string ANTHROPIC_API_KEY the same way", () => {
    const env = baseEnv({ ANTHROPIC_API_KEY: "" });
    expect(load(env).claudeCredential).toBe("CLAUDE_CODE_OAUTH_TOKEN");
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });
});

describe("secret hygiene", () => {
  it("describeConfig never contains a secret value", () => {
    const config = load(baseEnv());
    const output = describeConfig(config);

    expect(output).not.toContain(HEX_KEY);
    expect(output).not.toContain(OAUTH_TOKEN);
    expect(output).not.toContain(config.encryptionKey.toString("hex"));
    expect(output).toContain("RETURN_ENCRYPTION_KEY: <set>");
    expect(output).toContain("CLAUDE_CODE_OAUTH_TOKEN: <set>");
    expect(output).toContain("ANTHROPIC_API_KEY: <unused>");
  });

  it("redact() replaces secret values inside an arbitrary payload", () => {
    const config = load(baseEnv());
    const payload = {
      message: `encrypting with ${config.secrets.returnEncryptionKey}`,
      nested: { auth: `Bearer ${config.secrets.claudeCodeOauthToken}` },
      list: [config.encryptionKey.toString("hex")],
    };

    const cleaned = redact(payload, secretValues(config));
    const asText = JSON.stringify(cleaned);

    expect(asText).not.toContain(HEX_KEY);
    expect(asText).not.toContain(OAUTH_TOKEN);
    expect(asText).not.toContain(config.encryptionKey.toString("hex"));
    expect(cleaned.message).toContain("[redacted]");
    expect(cleaned.nested.auth).toBe("Bearer [redacted]");
  });
});
