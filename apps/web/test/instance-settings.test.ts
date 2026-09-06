import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_INSTANCE_SETTINGS,
  normalizeInstanceSettings,
  PURGE_MAX_DAYS,
  PURGE_MIN_DAYS,
  readInstanceSettingsAt,
  writeInstanceSettingsAt,
} from "../lib/instance-settings";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "atl-settings-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("instance settings (PRD FR-18)", () => {
  it("defaults to purge OFF when the file is absent", async () => {
    expect(await readInstanceSettingsAt(dir)).toEqual(DEFAULT_INSTANCE_SETTINGS);
    expect(DEFAULT_INSTANCE_SETTINGS.purgeSourceDocuments.enabled).toBe(false);
  });

  it("round-trips a written setting", async () => {
    const written = await writeInstanceSettingsAt(dir, {
      purgeSourceDocuments: { enabled: true, afterDays: 120 },
    });
    expect(written.purgeSourceDocuments).toEqual({ enabled: true, afterDays: 120 });
    expect(await readInstanceSettingsAt(dir)).toEqual(written);
    const onDisk = JSON.parse(await readFile(join(dir, "instance-settings.json"), "utf8"));
    expect(onDisk.purgeSourceDocuments.enabled).toBe(true);
  });

  it("clamps the day count into range and never auto-enables", () => {
    expect(normalizeInstanceSettings({ purgeSourceDocuments: { afterDays: 1 } })).toEqual({
      purgeSourceDocuments: { enabled: false, afterDays: PURGE_MIN_DAYS },
    });
    expect(
      normalizeInstanceSettings({ purgeSourceDocuments: { enabled: true, afterDays: 999999 } }),
    ).toEqual({ purgeSourceDocuments: { enabled: true, afterDays: PURGE_MAX_DAYS } });
    expect(
      normalizeInstanceSettings({ purgeSourceDocuments: { enabled: "yes" } }).purgeSourceDocuments
        .enabled,
    ).toBe(false);
  });

  it("treats a corrupt file as the defaults", async () => {
    await writeFile(join(dir, "instance-settings.json"), "{ not json");
    expect(await readInstanceSettingsAt(dir)).toEqual(DEFAULT_INSTANCE_SETTINGS);
  });
});
