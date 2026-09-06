import { NextResponse } from "next/server";

/**
 * Container liveness probe (PRD FR-16). Used by the Docker `HEALTHCHECK` and
 * the compose healthcheck so `docker compose up -d` only reports healthy once
 * the Next server is actually serving. Deliberately trivial: it reads no
 * return data, touches no secret, and is the one route besides `/unlock` that
 * the passphrase gate lets through (`isPublicPath`).
 */
export const dynamic = "force-dynamic";

export function GET(): NextResponse {
  return NextResponse.json({ status: "ok" });
}
