"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  configuredPassphrase,
  passphraseMatches,
  SESSION_COOKIE,
  sessionTokenFor,
} from "../../lib/auth";

export interface UnlockState {
  error?: string;
}

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * Verify the submitted passphrase (constant-time) and, on a match, set the
 * signed httpOnly `SameSite=Lax` session cookie, then redirect into the app
 * (PRD FR-17). On a mismatch, return an error for the unlock screen to show.
 */
export async function unlock(_previous: UnlockState, formData: FormData): Promise<UnlockState> {
  const submitted = String(formData.get("passphrase") ?? "");
  const expected = configuredPassphrase();

  if (!expected) {
    return {
      error:
        "No passphrase is configured on this server. Set APP_PASSPHRASE in the app config and restart.",
    };
  }
  if (!(await passphraseMatches(submitted, expected))) {
    return { error: "That passphrase does not match. Check it and try again." };
  }

  const jar = await cookies();
  jar.set(SESSION_COOKIE, await sessionTokenFor(expected), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  redirect("/");
}
