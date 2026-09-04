import { NextResponse, type NextRequest } from "next/server";

import { configuredPassphrase, isPublicPath, SESSION_COOKIE, verifySession } from "./lib/auth";

/**
 * The passphrase gate (PRD FR-17). Every route except `/unlock` (and its POST)
 * is blocked until the request carries a valid session cookie; without one the
 * user is redirected to `/unlock`. `APP_PASSPHRASE` is read from the runtime
 * environment — Next loads `.env` for the middleware in dev and production; on
 * the NAS it comes from the compose `env_file`.
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (await verifySession(token, configuredPassphrase())) return NextResponse.next();

  const unlockUrl = request.nextUrl.clone();
  unlockUrl.pathname = "/unlock";
  unlockUrl.search = "";
  return NextResponse.redirect(unlockUrl);
}

export const config = {
  // Everything except Next internals and static files (anything with a dot).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.\\w+$).*)"],
};
