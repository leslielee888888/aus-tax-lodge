import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readAcknowledgementAt, recordAcknowledgementAt } from "../lib/acknowledgement";
import { resolveNewReturn } from "../lib/new-return";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "atl-newret-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("resolveNewReturn", () => {
  it("shows the acknowledgement first, then skips it on the next return", async () => {
    const createReturn = vi.fn(async () => ({ returnId: "ret123" }));
    const deps = {
      readAcknowledgement: () => readAcknowledgementAt(dir),
      createReturn,
    };

    // First return: no acknowledgement yet.
    expect(await resolveNewReturn(deps)).toEqual({ kind: "acknowledge" });
    expect(createReturn).not.toHaveBeenCalled();

    // User accepts.
    await recordAcknowledgementAt(dir);

    // Second return: acknowledgement present -> straight to creating it.
    expect(await resolveNewReturn(deps)).toEqual({
      kind: "redirect",
      href: "/returns/ret123/details",
    });
    expect(createReturn).toHaveBeenCalledExactlyOnceWith({ currentStep: "details" });
  });
});
