import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  configuredPassphrase,
  isPublicPath,
  passphraseMatches,
  sessionTokenFor,
  verifySession,
} from "../lib/auth";

const PASSPHRASE = "correct horse battery staple";

describe("passphraseMatches", () => {
  it("accepts the right passphrase and rejects a wrong one", async () => {
    expect(await passphraseMatches(PASSPHRASE, PASSPHRASE)).toBe(true);
    expect(await passphraseMatches("wrong", PASSPHRASE)).toBe(false);
    expect(await passphraseMatches(`${PASSPHRASE} `, PASSPHRASE)).toBe(false);
  });

  it("rejects empty input or a missing configured passphrase", async () => {
    expect(await passphraseMatches("", PASSPHRASE)).toBe(false);
    expect(await passphraseMatches(PASSPHRASE, undefined)).toBe(false);
  });
});

describe("session cookie value", () => {
  it("is a stable 64-char hex HMAC of the passphrase", async () => {
    const token = await sessionTokenFor(PASSPHRASE);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(await sessionTokenFor(PASSPHRASE)).toBe(token);
    expect(await sessionTokenFor("other")).not.toBe(token);
  });

  it("verifySession accepts a token for the configured passphrase only", async () => {
    const token = await sessionTokenFor(PASSPHRASE);
    expect(await verifySession(token, PASSPHRASE)).toBe(true);
    expect(await verifySession(token, "different passphrase")).toBe(false);
    expect(await verifySession(undefined, PASSPHRASE)).toBe(false);
    expect(await verifySession("deadbeef", PASSPHRASE)).toBe(false);
  });
});

describe("isPublicPath", () => {
  it("only /unlock and the health check are public", () => {
    expect(isPublicPath("/unlock")).toBe(true);
    expect(isPublicPath("/api/health")).toBe(true);
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/returns/new")).toBe(false);
    expect(isPublicPath("/api/returns/abc/documents")).toBe(false);
  });
});

describe("configuredPassphrase", () => {
  const original = process.env.APP_PASSPHRASE;
  beforeEach(() => {
    delete process.env.APP_PASSPHRASE;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.APP_PASSPHRASE;
    else process.env.APP_PASSPHRASE = original;
  });

  it("trims, and treats blank as unset", () => {
    expect(configuredPassphrase()).toBeUndefined();
    process.env.APP_PASSPHRASE = "   ";
    expect(configuredPassphrase()).toBeUndefined();
    process.env.APP_PASSPHRASE = "  hunter2  ";
    expect(configuredPassphrase()).toBe("hunter2");
  });
});
