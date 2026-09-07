/**
 * T23 · Acceptance criterion 4 — persistence across a restart + the passphrase gate.
 *
 * Persistence: a REAL `@aus-tax-lodge/store` repository + document store on a
 * real temp `DATA_DIR` with real AES-256-GCM encryption. A return is created,
 * a document uploaded, and mid-flow model state saved — then a *fresh* pair of
 * store instances (no shared in-memory state) is pointed at the same directory
 * and must read everything back byte-for-byte: the model, the document bytes,
 * `currentStep` and `revision`. Also: a return whose envelope carries a retired
 * `paramsVersion` loads read-only.
 *
 * Auth: `apps/web/lib/auth.ts` — the shared-passphrase access gate (FR-17).
 * The session cookie is `HMAC-SHA256(APP_PASSPHRASE, "atl-session-v1")`; only
 * someone who knows the passphrase can mint one `verifySession` accepts, a
 * wrong passphrase's cookie is rejected, and an unset `APP_PASSPHRASE` fails
 * closed. Kept at the lib level — no Next request cycle (see `middleware.test.ts`
 * for that).
 */
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createEmptyReturnModel, answer } from "@aus-tax-lodge/model";
import { PARAMS_VERSION } from "@aus-tax-lodge/params";
import {
  createDocumentStore,
  createReturnRepository,
  decryptJson,
  encryptJson,
  returnJsonPath,
  type ReturnEnvelope,
} from "@aus-tax-lodge/store";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { configuredPassphrase, sessionTokenFor, verifySession } from "../../lib/auth";

// ---------------------------------------------------------------------------
// Persistence across a restart (FR-16)
// ---------------------------------------------------------------------------

describe("AC4 — persistence across a restart (FR-16, FR-17)", () => {
  let dir: string;
  const key = randomBytes(32);

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "atl-int-persist-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads the model, document bytes, currentStep and revision back through a fresh store instance", async () => {
    // --- "Session 1": create, upload, save mid-flow -----------------------
    const repo1 = createReturnRepository({ dataDir: dir, encryptionKey: key });
    const docs1 = createDocumentStore({ dataDir: dir, encryptionKey: key });

    const created = await repo1.createReturn({
      data: createEmptyReturnModel("2025-26"),
      currentStep: "details",
    });
    const returnId = created.returnId;
    expect(created.revision).toBe(1);

    const docBytes = randomBytes(2048);
    const putMeta = await docs1.putDocument(returnId, {
      filename: "ato-prefill-report.pdf",
      mimeType: "application/pdf",
      bytes: docBytes,
      detectedType: "ato-prefill-report",
    });

    // Save reviewed model state at `currentStep: "review"`, bumping revision.
    const midFlowModel = (() => {
      const m = createEmptyReturnModel("2025-26");
      return {
        ...m,
        taxpayer: { ...m.taxpayer, fullName: answer(m.taxpayer.fullName, "Restart Test") },
      };
    })();
    await repo1.saveReturn(returnId, { data: midFlowModel, currentStep: "review" });
    const saved2 = await repo1.saveReturn(returnId, {
      data: midFlowModel,
      currentStep: "review",
    });
    expect(saved2.conflict).toBe(false);
    const expectedRevision = saved2.conflict ? -1 : saved2.envelope.revision;
    expect(expectedRevision).toBe(3); // 1 (create) + 2 saves

    // --- "Restart": brand-new instances, same directory, no shared state --
    const repo2 = createReturnRepository({ dataDir: dir, encryptionKey: key });
    const docs2 = createDocumentStore({ dataDir: dir, encryptionKey: key });

    const reloaded = await repo2.loadReturn(returnId);
    expect(reloaded.readOnly).toBe(false);
    expect(reloaded.envelope.currentStep).toBe("review");
    expect(reloaded.envelope.revision).toBe(expectedRevision);
    expect(reloaded.envelope.data).toEqual(midFlowModel);
    expect((reloaded.envelope.data as typeof midFlowModel).taxpayer.fullName.value).toBe(
      "Restart Test",
    );

    const reloadedDoc = await docs2.getDocument(returnId, putMeta.docId);
    expect(reloadedDoc.bytes.equals(docBytes)).toBe(true);
    expect(reloadedDoc.metadata.filename).toBe("ato-prefill-report.pdf");
    expect(reloadedDoc.metadata.size).toBe(docBytes.length);

    const listed = await docs2.listDocuments(returnId);
    expect(listed.map((d) => d.docId)).toEqual([putMeta.docId]);
  });

  it("loads a return built against a retired paramsVersion as read-only", async () => {
    const repo = createReturnRepository({ dataDir: dir, encryptionKey: key });
    const created = await repo.createReturn({
      data: createEmptyReturnModel("2025-26"),
      currentStep: "documents",
    });

    // Rewrite return.json with a retired params dataset version, as an old
    // return on disk would carry after a params update on the NAS.
    const path = returnJsonPath(dir, created.returnId);
    const envelope = decryptJson<ReturnEnvelope>(key, await readFile(path));
    expect(envelope.paramsVersion).toBe(PARAMS_VERSION);
    await writeFile(
      path,
      encryptJson(key, { ...envelope, paramsVersion: "2019-20.0" } satisfies ReturnEnvelope),
    );

    const loaded = await repo.loadReturn(created.returnId);
    expect(loaded.readOnly).toBe(true);
    expect(loaded.envelope.paramsVersion).toBe("2019-20.0");

    // A read-only return refuses a save (not a conflict — an exception).
    await expect(
      repo.saveReturn(created.returnId, { data: createEmptyReturnModel("2025-26") }),
    ).rejects.toThrow(/read-only/i);
  });
});

// ---------------------------------------------------------------------------
// Passphrase gate (FR-17)
// ---------------------------------------------------------------------------

describe("AC4 — passphrase access gate (FR-17)", () => {
  const original = process.env.APP_PASSPHRASE;
  afterEach(() => {
    if (original === undefined) delete process.env.APP_PASSPHRASE;
    else process.env.APP_PASSPHRASE = original;
  });

  it("accepts a cookie minted from the configured passphrase and rejects everything else", async () => {
    const passphrase = "correct horse battery staple";
    process.env.APP_PASSPHRASE = `  ${passphrase}  `;
    expect(configuredPassphrase()).toBe(passphrase);

    const goodCookie = await sessionTokenFor(passphrase);
    expect(goodCookie).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifySession(goodCookie, configuredPassphrase())).toBe(true);

    // A cookie minted from a different passphrase is rejected.
    const wrongCookie = await sessionTokenFor("hunter2");
    expect(await verifySession(wrongCookie, configuredPassphrase())).toBe(false);
    expect(await verifySession(undefined, configuredPassphrase())).toBe(false);
    expect(await verifySession("not-hex-and-wrong-length", configuredPassphrase())).toBe(false);
  });

  it("fails closed when APP_PASSPHRASE is unset or blank", async () => {
    delete process.env.APP_PASSPHRASE;
    expect(configuredPassphrase()).toBeUndefined();
    // Even a structurally valid cookie cannot verify with no configured passphrase.
    const cookie = await sessionTokenFor("anything");
    expect(await verifySession(cookie, configuredPassphrase())).toBe(false);

    process.env.APP_PASSPHRASE = "   ";
    expect(configuredPassphrase()).toBeUndefined();
    expect(await verifySession(cookie, configuredPassphrase())).toBe(false);
  });
});
