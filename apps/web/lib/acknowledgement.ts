import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { getServerConfig } from "./server-config";

/**
 * The one-time "not tax advice / I'm responsible" acknowledgement (PRD FR-19).
 * Instance-level, not per return: recorded once, with a timestamp, before the
 * first return can be created, then never shown again.
 *
 * Stored as `<config.dataDir>/acknowledgement.json`. Server-only.
 */
export interface Acknowledgement {
  /** ISO-8601 instant the acknowledgement was accepted. */
  readonly acceptedAt: string;
}

const FILE_NAME = "acknowledgement.json";

function isAcknowledgement(value: unknown): value is Acknowledgement {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).acceptedAt === "string"
  );
}

/** Read the acknowledgement from `dataDir`, or `null` if it has not been recorded. */
export async function readAcknowledgementAt(dataDir: string): Promise<Acknowledgement | null> {
  let raw: string;
  try {
    raw = await readFile(join(dataDir, FILE_NAME), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isAcknowledgement(parsed) ? { acceptedAt: parsed.acceptedAt } : null;
}

/**
 * Record the acknowledgement in `dataDir` if it is not already there, and
 * return it. Recorded once: a second call keeps the original timestamp.
 */
export async function recordAcknowledgementAt(dataDir: string): Promise<Acknowledgement> {
  const existing = await readAcknowledgementAt(dataDir);
  if (existing) return existing;

  const acknowledgement: Acknowledgement = { acceptedAt: new Date().toISOString() };
  await mkdir(dataDir, { recursive: true });
  try {
    // `wx` fails if the file appeared between the read above and now.
    await writeFile(join(dataDir, FILE_NAME), `${JSON.stringify(acknowledgement, null, 2)}\n`, {
      flag: "wx",
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
  return (await readAcknowledgementAt(dataDir)) ?? acknowledgement;
}

/** Instance acknowledgement, bound to the configured data directory. */
export function readAcknowledgement(): Promise<Acknowledgement | null> {
  return readAcknowledgementAt(getServerConfig().dataDir);
}

/** Record the instance acknowledgement (idempotent), bound to the configured data directory. */
export function recordAcknowledgement(): Promise<Acknowledgement> {
  return recordAcknowledgementAt(getServerConfig().dataDir);
}
