/**
 * The shared-passphrase access gate (PRD FR-17). An access gate only — it is
 * independent of `RETURN_ENCRYPTION_KEY`, so `APP_PASSPHRASE` can be changed on
 * the NAS and restarted with every encrypted return left intact.
 *
 * The session cookie value is `HMAC-SHA256(APP_PASSPHRASE, SESSION_MESSAGE)`
 * as hex — no separate signing secret. Only someone who knows the passphrase
 * can produce it, and it carries nothing sensitive. This module uses the Web
 * Crypto API so it runs in both the Edge middleware and Node server actions.
 */

const SESSION_MESSAGE = "atl-session-v1";

/** Name of the signed, httpOnly session cookie set on a successful unlock. */
export const SESSION_COOKIE = "atl_session";

/** Routes reachable without a valid session — the unlock screen and its POST. */
export function isPublicPath(pathname: string): boolean {
  return pathname === "/unlock";
}

/** The configured passphrase, trimmed, or `undefined` if unset/blank. */
export function configuredPassphrase(): string | undefined {
  const raw = process.env.APP_PASSPHRASE;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

const encoder = new TextEncoder();

async function hmacHex(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
  return Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Length-safe, branch-free comparison of two equal-purpose strings. */
function timingSafeEqual(a: string, b: string): boolean {
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i += 1) diff |= ab[i]! ^ bb[i]!;
  return diff === 0;
}

/** The cookie value for a given passphrase. */
export function sessionTokenFor(passphrase: string): Promise<string> {
  return hmacHex(passphrase, SESSION_MESSAGE);
}

/** Whether a cookie value proves knowledge of the configured passphrase. */
export async function verifySession(
  token: string | undefined,
  passphrase: string | undefined,
): Promise<boolean> {
  if (!token || !passphrase) return false;
  return timingSafeEqual(token, await sessionTokenFor(passphrase));
}

/**
 * Constant-time check of a submitted passphrase against the expected one. Both
 * sides are reduced to a fixed-length HMAC before comparison so neither the
 * timing nor the length of the compare leaks anything about `expected`.
 */
export async function passphraseMatches(
  submitted: string,
  expected: string | undefined,
): Promise<boolean> {
  if (!expected || !submitted) return false;
  const [a, b] = await Promise.all([sessionTokenFor(submitted), sessionTokenFor(expected)]);
  return timingSafeEqual(a, b);
}
