import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { unlock } from "../app/unlock/actions";
import { sessionTokenFor } from "../lib/auth";

const { cookieSet } = vi.hoisted(() => ({ cookieSet: vi.fn() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ set: cookieSet }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

const PASSPHRASE = "the shared phrase";
let original: string | undefined;

beforeAll(() => {
  original = process.env.APP_PASSPHRASE;
  process.env.APP_PASSPHRASE = PASSPHRASE;
});
afterAll(() => {
  if (original === undefined) delete process.env.APP_PASSPHRASE;
  else process.env.APP_PASSPHRASE = original;
});

function form(passphrase: string): FormData {
  const fd = new FormData();
  fd.set("passphrase", passphrase);
  return fd;
}

describe("unlock action", () => {
  it("returns an error and sets no cookie for a wrong passphrase", async () => {
    cookieSet.mockClear();
    const state = await unlock({}, form("nope"));
    expect(state.error).toMatch(/does not match/i);
    expect(cookieSet).not.toHaveBeenCalled();
  });

  it("sets a signed httpOnly SameSite=Lax cookie and redirects on the right passphrase", async () => {
    cookieSet.mockClear();
    await expect(unlock({}, form(PASSPHRASE))).rejects.toThrow("REDIRECT:/");

    expect(cookieSet).toHaveBeenCalledTimes(1);
    const [name, value, options] = cookieSet.mock.calls[0]!;
    expect(name).toBe("atl_session");
    expect(value).toBe(await sessionTokenFor(PASSPHRASE));
    expect(options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
  });
});
