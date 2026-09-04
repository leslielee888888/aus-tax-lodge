import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PARAMS_VERSION, TARGET_YEAR } from "@aus-tax-lodge/params";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { encryptJson } from "../src/crypto";
import { returnDir, returnJsonPath } from "../src/paths";
import {
  createReturnRepository,
  RETURN_SCHEMA_VERSION,
  type ReturnEnvelope,
  type ReturnRepository,
} from "../src/returns";

const KEY = randomBytes(32);
const SECRET_MARKER = "PLAINTEXT-MARKER-SALARY-123456";

let dataDir: string;
let repo: ReturnRepository;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "atl-returns-"));
  repo = createReturnRepository({ dataDir, encryptionKey: KEY });
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  await rm(dataDir, { recursive: true, force: true });
});

describe("createReturn / loadReturn", () => {
  it("stamps the envelope and round-trips through encryption", async () => {
    const created = await repo.createReturn({
      data: { note: SECRET_MARKER },
      currentStep: "details",
    });

    expect(created.returnId).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
    expect(created.schemaVersion).toBe(RETURN_SCHEMA_VERSION);
    expect(created.targetYear).toBe(TARGET_YEAR);
    expect(created.paramsVersion).toBe(PARAMS_VERSION);
    expect(created.status).toBe("in-progress");
    expect(created.currentStep).toBe("details");
    expect(created.revision).toBe(1);
    expect(created.createdAt).toMatch(/^\d{4}-\d\d-\d\dT/);

    const { envelope, readOnly } = await repo.loadReturn(created.returnId);
    expect(envelope).toEqual(created);
    expect(readOnly).toBe(false);
  });

  it("writes no plaintext payload to disk", async () => {
    const created = await repo.createReturn({ data: { note: SECRET_MARKER } });
    const raw = await readFile(returnJsonPath(dataDir, created.returnId));
    expect(raw.toString("utf8")).not.toContain(SECRET_MARKER);
    expect(raw.toString("latin1")).not.toContain(SECRET_MARKER);
  });

  it("throws for an unknown return", async () => {
    await expect(repo.loadReturn("does-not-exist")).rejects.toThrow(/not found/);
  });
});

describe("saveReturn — last-write-wins with a revision stamp", () => {
  it("bumps revision and refreshes updatedAt", async () => {
    const created = await repo.createReturn({ data: { step: 0 } });

    const first = await repo.saveReturn(created.returnId, {
      data: { step: 1 },
      currentStep: "review",
      status: "exported",
    });
    expect(first.conflict).toBe(false);
    if (first.conflict) return;
    expect(first.envelope.revision).toBe(2);
    expect(first.envelope.currentStep).toBe("review");
    expect(first.envelope.status).toBe("exported");
    expect(first.envelope.data).toEqual({ step: 1 });
    expect(first.envelope.createdAt).toBe(created.createdAt);

    const reloaded = await repo.loadReturn(created.returnId);
    expect(reloaded.envelope.revision).toBe(2);
    expect(reloaded.envelope.data).toEqual({ step: 1 });
  });

  it("saves last-write-wins when no expectedRevision is given", async () => {
    const created = await repo.createReturn({ data: {} });
    await repo.saveReturn(created.returnId, { data: { a: 1 } });
    const res = await repo.saveReturn(created.returnId, { data: { a: 2 } });
    expect(res.conflict).toBe(false);
    if (res.conflict) return;
    expect(res.envelope.revision).toBe(3);
  });

  it("returns a conflict without writing when expectedRevision is stale", async () => {
    const created = await repo.createReturn({ data: {} });
    await repo.saveReturn(created.returnId, { data: { tab: "A" } }); // revision -> 2

    const res = await repo.saveReturn(created.returnId, {
      data: { tab: "B" },
      expectedRevision: 1,
    });

    expect(res.conflict).toBe(true);
    if (!res.conflict) return;
    expect(res.current.revision).toBe(2);
    expect(res.current.data).toEqual({ tab: "A" });

    const reloaded = await repo.loadReturn(created.returnId);
    expect(reloaded.envelope.revision).toBe(2);
    expect(reloaded.envelope.data).toEqual({ tab: "A" });
  });

  it("accepts a matching expectedRevision", async () => {
    const created = await repo.createReturn({ data: {} });
    const res = await repo.saveReturn(created.returnId, {
      data: { ok: true },
      expectedRevision: 1,
    });
    expect(res.conflict).toBe(false);
  });
});

describe("listReturns — a directory scan", () => {
  it("returns a summary per return, newest first, skipping a corrupt one", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T00:00:00.000Z"));
    const a = await repo.createReturn({ data: {}, currentStep: "details" });
    vi.setSystemTime(new Date("2026-07-02T00:00:00.000Z"));
    const b = await repo.createReturn({ data: {}, currentStep: "upload" });
    vi.setSystemTime(new Date("2026-07-03T00:00:00.000Z"));
    await repo.saveReturn(b.returnId, { data: {}, currentStep: "review" });
    vi.useRealTimers();

    // A corrupt return.json — present but not decryptable.
    await mkdir(returnDir(dataDir, "corrupt-one"), { recursive: true });
    await writeFile(returnJsonPath(dataDir, "corrupt-one"), Buffer.from("not encrypted json"));

    const summaries = await repo.listReturns();
    expect(summaries.map((s) => s.returnId).sort()).toEqual([a.returnId, b.returnId].sort());
    // newest activity first
    expect(summaries.map((s) => s.returnId)).toEqual([b.returnId, a.returnId]);

    const bSummary = summaries.find((s) => s.returnId === b.returnId);
    expect(bSummary).toMatchObject({
      targetYear: TARGET_YEAR,
      status: "in-progress",
      currentStep: "review",
      readOnly: false,
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("corrupt-one"));
  });

  it("returns [] when no returns directory exists", async () => {
    expect(await repo.listReturns()).toEqual([]);
  });
});

describe("read-only past returns (retired config)", () => {
  async function seedRetiredReturn(returnId: string): Promise<ReturnEnvelope> {
    const now = new Date().toISOString();
    const envelope: ReturnEnvelope = {
      schemaVersion: RETURN_SCHEMA_VERSION,
      returnId,
      targetYear: "2024-25",
      paramsVersion: "2024-25.1",
      status: "exported",
      currentStep: "archive",
      createdAt: now,
      updatedAt: now,
      revision: 4,
      data: { lodged: true },
    };
    await mkdir(returnDir(dataDir, returnId), { recursive: true });
    await writeFile(returnJsonPath(dataDir, returnId), encryptJson(KEY, envelope));
    return envelope;
  }

  it("loads readOnly when paramsVersion differs from PARAMS_VERSION", async () => {
    const seeded = await seedRetiredReturn("past-return");
    const { envelope, readOnly } = await repo.loadReturn("past-return");
    expect(readOnly).toBe(true);
    expect(envelope).toEqual(seeded);
  });

  it("refuses to save a read-only return", async () => {
    await seedRetiredReturn("past-return");
    await expect(repo.saveReturn("past-return", { data: { tampered: true } })).rejects.toThrow(
      /read-only/,
    );
  });

  it("lists a read-only return with readOnly: true", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await seedRetiredReturn("past-return");
    const summaries = await repo.listReturns();
    const past = summaries.find((s) => s.returnId === "past-return");
    expect(past).toMatchObject({ targetYear: "2024-25", status: "exported", readOnly: true });
  });
});

describe("deleteReturn", () => {
  it("removes the whole return directory", async () => {
    const created = await repo.createReturn({ data: {} });
    await stat(returnDir(dataDir, created.returnId)); // exists

    await repo.deleteReturn(created.returnId);

    await expect(stat(returnDir(dataDir, created.returnId))).rejects.toThrow();
    await expect(repo.loadReturn(created.returnId)).rejects.toThrow(/not found/);
  });

  it("is a no-op for an unknown return", async () => {
    await expect(repo.deleteReturn("ghost")).resolves.toBeUndefined();
  });
});
