import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM authenticated encryption for data at rest (PRD FR-17). Every blob
 * is self-describing: a fresh random IV and the GCM auth tag are prepended to
 * the ciphertext, so {@link decrypt} needs only the same key. Any tampering with
 * the stored bytes fails the tag check and throws rather than returning
 * corrupted plaintext.
 *
 *   blob = IV (12 bytes) ‖ auth tag (16 bytes) ‖ ciphertext
 */

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export const ENCRYPTION_OVERHEAD_BYTES = IV_BYTES + TAG_BYTES;

function assertKey(key: Buffer): void {
  if (key.length !== KEY_BYTES) {
    throw new Error(`encryption key must be ${KEY_BYTES} bytes for AES-256, got ${key.length}`);
  }
}

/** Encrypts `plaintext` under `key`, returning `IV ‖ tag ‖ ciphertext`. */
export function encrypt(key: Buffer, plaintext: Buffer): Buffer {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]);
}

/**
 * Decrypts a blob produced by {@link encrypt}. Throws if the key is wrong, the
 * blob is truncated, or any byte (IV, tag or ciphertext) has been altered.
 */
export function decrypt(key: Buffer, blob: Buffer): Buffer {
  assertKey(key);
  if (blob.length < ENCRYPTION_OVERHEAD_BYTES) {
    throw new Error("encrypted blob is truncated — missing IV or auth tag");
  }
  const iv = blob.subarray(0, IV_BYTES);
  const tag = blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = blob.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/** Encrypts a UTF-8 JSON serialisation of `value`. */
export function encryptJson(key: Buffer, value: unknown): Buffer {
  return encrypt(key, Buffer.from(JSON.stringify(value), "utf8"));
}

/** Inverse of {@link encryptJson}. */
export function decryptJson<T>(key: Buffer, blob: Buffer): T {
  return JSON.parse(decrypt(key, blob).toString("utf8")) as T;
}
