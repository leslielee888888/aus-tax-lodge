import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { sessionTokenFor, SESSION_COOKIE } from "../lib/auth";
import { middleware } from "../middleware";

const PASSPHRASE = "let me in please";
let original: string | undefined;

beforeAll(() => {
  original = process.env.APP_PASSPHRASE;
  process.env.APP_PASSPHRASE = PASSPHRASE;
});
afterAll(() => {
  if (original === undefined) delete process.env.APP_PASSPHRASE;
  else process.env.APP_PASSPHRASE = original;
});

function request(path: string, cookie?: string): NextRequest {
  const req = new NextRequest(`https://app.test${path}`);
  if (cookie) req.cookies.set(SESSION_COOKIE, cookie);
  return req;
}

describe("passphrase gate middleware", () => {
  it("redirects a protected route to /unlock without a valid cookie", async () => {
    const res = await middleware(request("/returns/new"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://app.test/unlock");
  });

  it("redirects when the cookie does not match the configured passphrase", async () => {
    const stale = await sessionTokenFor("some other passphrase");
    const res = await middleware(request("/", stale));
    expect(res.headers.get("location")).toBe("https://app.test/unlock");
  });

  it("lets a request through with a valid session cookie", async () => {
    const res = await middleware(request("/", await sessionTokenFor(PASSPHRASE)));
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("always allows /unlock", async () => {
    const res = await middleware(request("/unlock"));
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
});
