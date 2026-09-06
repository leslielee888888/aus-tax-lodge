/**
 * Shared harness for the cross-package integration suite (T23).
 *
 * Wires the REAL modules together — `@aus-tax-lodge/{model,engine,params,store,
 * extraction,scope,validation,export}`, real AES-256-GCM persistence to a real
 * temp dir, real `pdf-lib` / `archiver` — and mocks ONLY Claude.
 *
 * Nothing here touches the network or the wall clock (timestamps are injected).
 */
import { pbkdf2Sync, createCipheriv, randomBytes } from "node:crypto";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";

import {
  answer,
  confirm,
  createEmptyReturnModel,
  markNotApplicable,
  unsetField,
  type Provenanced,
  type ReturnModel,
} from "@aus-tax-lodge/model";

// ---------------------------------------------------------------------------
// Environment / temp data dir
// ---------------------------------------------------------------------------

export interface TestEnv {
  readonly dir: string;
  readonly passphrase: string;
  readonly cleanup: () => Promise<void>;
}

/**
 * Create an isolated temp `DATA_DIR` and point the process env at it. The
 * `apps/web` server singletons (`getServerConfig` / `getReturnRepository` /
 * `getDocumentStore` / `getClaudeClient`) read the env lazily on first use, so
 * calling this in a `beforeAll` — before the first `import("../lib/...")` — is
 * enough. Mirrors `apps/web/test/export-archive.test.ts`.
 */
export async function setupTestEnv(prefix = "atl-integration-"): Promise<TestEnv> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  const passphrase = "correct horse battery staple";
  process.env.RETURN_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  process.env.APP_PASSPHRASE = passphrase;
  process.env.DATA_DIR = dir;
  delete process.env.ANTHROPIC_API_KEY;
  process.env.CLAUDE_CODE_OAUTH_TOKEN = "test-token-not-used";
  return {
    dir,
    passphrase,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

// ---------------------------------------------------------------------------
// Mock Claude
// ---------------------------------------------------------------------------

export interface VisionRoute {
  /** Matched against the prompt text (which embeds the fixture filename). */
  readonly match: RegExp;
  readonly reply: string;
}

/**
 * A `ClaudeClient`-shaped stub whose `askVision` dispatches on the prompt text.
 * An unmatched call throws loudly rather than silently returning `"[]"` — a
 * missing canned reply is a test bug, not a pass.
 */
export function createMockClaude(routes: readonly VisionRoute[]): {
  askVision: (parts: unknown, prompt: string, options?: unknown) => Promise<string>;
  calls: { prompt: string }[];
} {
  const calls: { prompt: string }[] = [];
  return {
    calls,
    askVision: async (_parts: unknown, prompt: string) => {
      calls.push({ prompt });
      const route = routes.find((r) => r.match.test(prompt));
      if (!route) {
        throw new Error(`mock Claude: no canned reply for prompt:\n${prompt.slice(0, 400)}…`);
      }
      return route.reply;
    },
  };
}

/**
 * A fake text-layer reader for `extractDocument` — decodes the fixture bytes as
 * UTF-8 and returns them as the single page. The fixture "PDFs" carry the
 * verbatim snippets, so `locateSnippet` succeeds and confidence is `high`
 * (never `unverified`). Injected via `deps.extractTextLayer`.
 */
export const fakeTextLayer = async (bytes: Buffer): Promise<{ pages: string[] }> => ({
  pages: [bytes.toString("utf8")],
});

/** A tiny "PDF" whose bytes contain `text` verbatim (for the fake text layer + a real `PK`/`%PDF` header check). */
export function fakePdf(text: string): Buffer {
  return Buffer.from(`%PDF-1.4\n${text}\n%%EOF\n`, "utf8");
}

// ---------------------------------------------------------------------------
// Model helpers
// ---------------------------------------------------------------------------

function isProvenanced(v: unknown): v is Provenanced<unknown> {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    "status" in v &&
    "origin" in v &&
    "proposedValue" in v &&
    Array.isArray((v as { edits?: unknown }).edits)
  );
}

/**
 * Confirm every `proposed` field anywhere in the model (the review-screen
 * "accept" action applied in bulk — PRD FR-7). `unset` / `confirmed` /
 * `not-applicable` fields are left untouched.
 */
export function confirmAllProposed<T>(node: T): T {
  if (node === null || typeof node !== "object") return node;
  if (isProvenanced(node)) {
    return (node.status === "proposed" ? confirm(node) : node) as unknown as T;
  }
  if (Array.isArray(node)) return node.map((n) => confirmAllProposed(n)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    out[k] = confirmAllProposed(v);
  }
  return out as T;
}

/** `answer()` a field with `value` (origin `user-answer`). */
export function ans<T>(value: T): Provenanced<T> {
  return answer(unsetField<T>(), value);
}

/** Mark a fresh field nil / not-applicable. */
export function na<T>(): Provenanced<T> {
  return markNotApplicable(unsetField<T>());
}

/**
 * A base return model as the T15 details form + a "no rental" default would
 * leave it: taxpayer identity and context confirmed (user answers), every
 * deduction label the fixtures don't populate marked nil, private health "no".
 * Income arrives later via the extraction pipeline; the questionnaire fills the
 * joint-account share and the scope gate.
 */
export function detailsModel(opts: { holdsStudyLoan: boolean; targetYear?: string }): ReturnModel {
  const base = createEmptyReturnModel(opts.targetYear);
  return {
    ...base,
    taxpayer: {
      fullName: ans("Priya Example"),
      dateOfBirth: ans("1985-03-02"),
      postalAddress: ans({
        line1: "1 Test St",
        line2: "",
        suburb: "Sydney",
        state: "NSW",
        postcode: "2000",
        country: "Australia",
      }),
      taxFileNumber: ans("123456782"),
      refundAccount: ans({
        bsb: "062-000",
        accountNumber: "12345678",
        accountName: "Priya Example",
      }),
    },
    context: {
      ...base.context,
      residency: ans("resident-full-year"),
      spouse: { ...base.context.spouse, status: ans("none") },
      holdsStudyLoan: ans(opts.holdsStudyLoan),
      // privateHospitalCoverDays is set by the questionnaire step.
      dependentChildren: ans(0),
    },
    income: {
      ...base.income,
      // Income labels the fixtures don't populate — marked nil on review.
      governmentAllowances: na<number>(),
      reportableFringeBenefits: na<number>(),
      reportableEmployerSuper: na<number>(),
    },
    deductions: {
      ...base.deductions,
      workRelatedCar: {
        ...base.deductions.workRelatedCar,
        businessKilometres: na<number>(),
        ratePerKm: na<number>(),
        amount: na<number>(),
        substantiationRef: na<string>(),
      },
      workRelatedTravel: {
        amount: na<number>(),
        substantiationRef: na<string>(),
        unsubstantiated: false,
      },
      selfEducation: {
        amount: na<number>(),
        substantiationRef: na<string>(),
        unsubstantiated: false,
      },
      otherWorkRelated: {
        amount: na<number>(),
        substantiationRef: na<string>(),
        unsubstantiated: false,
      },
      costOfManagingTaxAffairs: {
        amount: na<number>(),
        substantiationRef: na<string>(),
        unsubstantiated: false,
      },
      workFromHome: {
        ...base.deductions.workFromHome,
        hours: na<number>(),
        ratePerHour: na<number>(),
        amount: na<number>(),
        substantiationRef: na<string>(),
      },
    },
    privateHealth: { ...base.privateHealth, held: ans(false) },
  };
}

/**
 * Settle the rental expense lines the fixture set doesn't populate: every
 * `RENTAL_EXPENSE_KEYS` amount still `unset` → nil, plus `otherRentalIncome`.
 * Mirrors the review screen, where the user marks the untouched rental
 * deduction rows nil.
 */
export function settleRentalScheduleGaps(model: ReturnModel): ReturnModel {
  // Local import to avoid a cycle at module top.

  const RENTAL_EXPENSE_KEYS = (
    require("@aus-tax-lodge/model") as typeof import("@aus-tax-lodge/model")
  ).RENTAL_EXPENSE_KEYS;
  const expenses = { ...model.rental.expenses };
  for (const key of RENTAL_EXPENSE_KEYS) {
    const line = expenses[key];
    if (line.amount.status === "unset") {
      expenses[key] = { ...line, amount: markNotApplicable(line.amount) };
    }
  }
  const otherRentalIncome =
    model.rental.otherRentalIncome.status === "unset"
      ? markNotApplicable(model.rental.otherRentalIncome)
      : model.rental.otherRentalIncome;
  return { ...model, rental: { ...model.rental, expenses, otherRentalIncome } };
}

/**
 * ⚠️ COMPENSATES FOR A REAL WIRING GAP (see the T23 report). No production code
 * in `apps/web` ever sets `rental.property.*` or the `rental.soleOwnership` /
 * `rentedOrAvailableAllYear` / `noPrivateUse` scope-gate booleans, yet
 * `@aus-tax-lodge/validation` `collectInScopeFields` requires them confirmed
 * before export. This helper does what the missing web glue should do: derive
 * the three booleans from the answered `questionnaire.rentalScopeGate` and
 * record a property identity.
 */
export function settleRentalWiringGap(model: ReturnModel): ReturnModel {
  const gate = model.questionnaire.rentalScopeGate.value;
  return {
    ...model,
    rental: {
      ...model.rental,
      property: {
        addressLine1: ans("2 Rental Rd"),
        suburb: ans("Sydney"),
        state: ans("NSW"),
        postcode: ans("2000"),
        firstEarnedIncomeOn: ans("2020-06-01"),
      },
      soleOwnership: ans(gate?.solelyOwned ?? true),
      rentedOrAvailableAllYear: ans(gate?.rentedOrAvailableAllYear ?? true),
      noPrivateUse: ans(gate?.noPrivateUse ?? true),
    },
  };
}

// ---------------------------------------------------------------------------
// WinZip-AES (AES-256, method 99) zip reader — proves the archive decrypts
// with the given password and enumerates + extracts its entries.
// ---------------------------------------------------------------------------

interface ZipEntry {
  readonly name: string;
  readonly bytes: Buffer;
}

function findEocd(buf: Buffer): number {
  for (let i = buf.length - 22; i >= 0; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new Error("not a zip: no end-of-central-directory record");
}

/** AES-256-CTR with the little-endian counter WinZip AES uses (first block = counter 1). */
function aesCtrDecrypt(key: Buffer, data: Buffer): Buffer {
  const out = Buffer.alloc(data.length);
  const counter = Buffer.alloc(16);
  for (let i = 0; i < data.length; i += 16) {
    for (let b = 0; b < 16; b += 1) {
      counter[b] = (counter[b]! + 1) & 0xff;
      if (counter[b] !== 0) break;
    }
    const ecb = createCipheriv("aes-256-ecb", key, null);
    ecb.setAutoPadding(false);
    const keystream = Buffer.concat([ecb.update(counter), ecb.final()]);
    for (let j = 0; j < 16 && i + j < data.length; j += 1) {
      out[i + j] = data[i + j]! ^ keystream[j]!;
    }
  }
  return out;
}

/**
 * Read a WinZip-AES-256 encrypted zip. Throws `"bad password"` if the PBKDF2
 * password-verification value doesn't match — that check IS "the password
 * decrypts it". Returns every entry's name and decrypted+inflated bytes.
 */
export function readAesZip(zip: Buffer, password: string): ZipEntry[] {
  const eocd = findEocd(zip);
  const cdCount = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);

  const entries: ZipEntry[] = [];
  for (let n = 0; n < cdCount; n += 1) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error("corrupt central directory");
    const compressedSize = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const localOffset = zip.readUInt32LE(p + 42);
    const name = zip.toString("utf8", p + 46, p + 46 + nameLen);

    // Read the AES extra field (0x9901) from the central-directory record.
    let strength = 3;
    let actualMethod = 8;
    let ep = p + 46 + nameLen;
    const extraEnd = ep + extraLen;
    while (ep + 4 <= extraEnd) {
      const id = zip.readUInt16LE(ep);
      const size = zip.readUInt16LE(ep + 2);
      if (id === 0x9901) {
        strength = zip.readUInt8(ep + 4 + 4);
        actualMethod = zip.readUInt16LE(ep + 4 + 5);
      }
      ep += 4 + size;
    }
    if (strength !== 3) throw new Error(`expected AES-256 (strength 3), got ${strength}`);

    // Locate the file data via the local header.
    if (zip.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("corrupt local header");
    const lNameLen = zip.readUInt16LE(localOffset + 26);
    const lExtraLen = zip.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const blob = zip.subarray(dataStart, dataStart + compressedSize);

    const saltLen = 16; // AES-256
    const salt = blob.subarray(0, saltLen);
    const pwVerify = blob.subarray(saltLen, saltLen + 2);
    const ciphertext = blob.subarray(saltLen + 2, blob.length - 10); // trailing 10 = HMAC-SHA1 auth code

    const dk = pbkdf2Sync(Buffer.from(password, "utf8"), salt, 1000, 32 + 32 + 2, "sha1");
    const encKey = dk.subarray(0, 32);
    const verify = dk.subarray(64, 66);
    if (!verify.equals(pwVerify)) throw new Error("bad password");

    const plain = aesCtrDecrypt(encKey, ciphertext);
    const bytes = actualMethod === 8 ? inflateRawSync(plain) : plain;
    entries.push({ name, bytes });

    p = p + 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export { readFile, readdir };
