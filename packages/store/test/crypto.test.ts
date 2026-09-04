import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { decrypt, decryptJson, encrypt, encryptJson } from "../src/crypto";

const KEY = randomBytes(32);

describe("AES-256-GCM round trip", () => {
  it("decrypts back to the original plaintext", () => {
    const plaintext = Buffer.from("the ATO pre-fill report for 2025–26", "utf8");
    const blob = encrypt(KEY, plaintext);
    expect(decrypt(KEY, blob).equals(plaintext)).toBe(true);
  });

  it("produces ciphertext that differs from the plaintext", () => {
    const plaintext = randomBytes(2048);
    const blob = encrypt(KEY, plaintext);
    expect(blob.includes(plaintext)).toBe(false);
    expect(blob.equals(plaintext)).toBe(false);
  });

  it("uses a fresh IV each call, so identical plaintext encrypts differently", () => {
    const plaintext = Buffer.from("same input");
    expect(encrypt(KEY, plaintext).equals(encrypt(KEY, plaintext))).toBe(false);
  });

  it("round-trips JSON", () => {
    const value = { docId: "abc", size: 12, nested: [1, 2, 3] };
    expect(decryptJson(KEY, encryptJson(KEY, value))).toEqual(value);
  });
});

describe("authentication", () => {
  it("fails the auth tag when the ciphertext is tampered with", () => {
    const blob = encrypt(KEY, Buffer.from("sensitive"));
    const last = blob.length - 1;
    blob[last] = blob[last]! ^ 0x01;
    expect(() => decrypt(KEY, blob)).toThrow();
  });

  it("fails when the IV is tampered with", () => {
    const blob = encrypt(KEY, Buffer.from("sensitive"));
    blob[0] = blob[0]! ^ 0x01;
    expect(() => decrypt(KEY, blob)).toThrow();
  });

  it("fails with the wrong key", () => {
    const blob = encrypt(KEY, Buffer.from("sensitive"));
    expect(() => decrypt(randomBytes(32), blob)).toThrow();
  });

  it("rejects a truncated blob", () => {
    expect(() => decrypt(KEY, Buffer.alloc(8))).toThrow(/truncated/);
  });

  it("rejects a key that is not 32 bytes", () => {
    expect(() => encrypt(randomBytes(16), Buffer.from("x"))).toThrow(/32 bytes/);
  });
});
