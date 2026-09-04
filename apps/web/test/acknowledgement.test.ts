import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readAcknowledgementAt, recordAcknowledgementAt } from "../lib/acknowledgement";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "atl-ack-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("first-run acknowledgement", () => {
  it("is null before it is recorded", async () => {
    expect(await readAcknowledgementAt(dir)).toBeNull();
  });

  it("records once, with an ISO-8601 timestamp, and reads back", async () => {
    const recorded = await recordAcknowledgementAt(dir);
    expect(recorded.acceptedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(Number.isNaN(Date.parse(recorded.acceptedAt))).toBe(false);

    const onDisk = JSON.parse(await readFile(join(dir, "acknowledgement.json"), "utf8"));
    expect(onDisk.acceptedAt).toBe(recorded.acceptedAt);

    expect(await readAcknowledgementAt(dir)).toEqual(recorded);
  });

  it("keeps the original timestamp when recorded a second time", async () => {
    const first = await recordAcknowledgementAt(dir);
    await new Promise((r) => setTimeout(r, 5));
    const second = await recordAcknowledgementAt(dir);
    expect(second.acceptedAt).toBe(first.acceptedAt);
  });

  it("treats a corrupt file as not recorded", async () => {
    await writeFile(join(dir, "acknowledgement.json"), "{ not json");
    expect(await readAcknowledgementAt(dir)).toBeNull();
  });
});
