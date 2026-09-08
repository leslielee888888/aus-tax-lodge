/**
 * Cross-package integration harness for the **conversational v2** flow (T12).
 *
 * Wires the REAL modules together — `@aus-tax-lodge/{model,engine,params,store,
 * extraction,scope,validation,export}`, the real conversation state machine
 * (`apps/web/lib/*`), the real prefill / interview-document routes and the real
 * chat server actions — against a real AES-256-GCM encrypted temp-dir store.
 *
 * The ONLY thing mocked is Claude: a scripted {@link ClaudeScript} whose `ask` /
 * `askVision` dispatch on the prompt content and return canned JSON. Nothing
 * here touches the network or the wall clock.
 *
 * `documents` (`@aus-tax-lodge/ai` `classifyDocument`) is NOT separately mocked —
 * it runs for real against the scripted vision client, so a fixture's classified
 * type comes from the same scripted-Claude path the app uses.
 */
import { pbkdf2Sync, createCipheriv, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";

import { PDFDocument, StandardFonts } from "pdf-lib";
import type { AskOptions, ClaudeClient } from "@aus-tax-lodge/ai";
import {
  answer,
  createEmptyReturnModel,
  markNotApplicable,
  RENTAL_EXPENSE_KEYS,
  unsetField,
  type ReturnModel,
} from "@aus-tax-lodge/model";

import type { ConversationState } from "../../lib/conversation";
import { APPLY_TURN_SYSTEM, NEXT_TURN_SYSTEM } from "../../lib/interview/prompts";
import type { LoadedConversation } from "../../lib/returns";

// ---------------------------------------------------------------------------
// Environment / temp data dir
// ---------------------------------------------------------------------------

export interface TestEnv {
  readonly dir: string;
  readonly passphrase: string;
  readonly encryptionKeyHex: string;
  readonly cleanup: () => Promise<void>;
}

/**
 * Create an isolated temp `DATA_DIR` and point `process.env` at it. The
 * `apps/web` server singletons (`getServerConfig` / `getReturnRepository` /
 * `getDocumentStore`) read the env lazily on first use, so calling this in a
 * `beforeAll` — before the first `import("../../lib/...")` — is enough.
 */
export async function setupTestEnv(prefix = "atl-int-v2-"): Promise<TestEnv> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  const passphrase = "correct horse battery staple";
  const encryptionKeyHex = randomBytes(32).toString("hex");
  process.env.RETURN_ENCRYPTION_KEY = encryptionKeyHex;
  process.env.APP_PASSPHRASE = passphrase;
  process.env.DATA_DIR = dir;
  delete process.env.ANTHROPIC_API_KEY;
  process.env.CLAUDE_CODE_OAUTH_TOKEN = "test-token-not-used";
  return {
    dir,
    passphrase,
    encryptionKeyHex,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

// ---------------------------------------------------------------------------
// Scripted Claude
// ---------------------------------------------------------------------------

type Reply = string | ((prompt: string, options?: AskOptions) => string);

interface Matcher {
  readonly name: string;
  readonly when: (prompt: string, options?: AskOptions) => boolean;
  readonly reply: Reply;
  used: boolean;
  readonly once: boolean;
}

export interface ClaudeScript {
  /** The `ClaudeClient` to hand to `getClaudeClient()` (via the test's `vi.mock`). */
  readonly client: ClaudeClient;
  /** Register a matcher for a text `ask` (question-picking / answer-parsing). */
  onAsk(
    name: string,
    when: (p: string, o?: AskOptions) => boolean,
    reply: Reply,
    opts?: { once?: boolean },
  ): void;
  /** Register a matcher for an `askVision` call (classification / extraction / rental / scope-content). */
  onVision(
    name: string,
    when: (p: string, o?: AskOptions) => boolean,
    reply: Reply,
    opts?: { once?: boolean },
  ): void;
  /** Enqueue one `nextTurn` (`NEXT_TURN_SYSTEM`) response, consumed in order. */
  queueNextTurn(reply: string): void;
  /** Record of every call, for assertions. */
  readonly calls: {
    ask: { prompt: string; options?: AskOptions }[];
    askVision: { prompt: string; options?: AskOptions }[];
  };
}

/** The default `nextTurn` reply: claim done, and let `nextTurn`'s own deterministic
 *  re-check convert it to an `ask` while the model is still incomplete. */
const DONE = '{"kind":"done"}';

export function createClaudeScript(): ClaudeScript {
  const askMatchers: Matcher[] = [];
  const visionMatchers: Matcher[] = [];
  const nextTurnQueue: string[] = [];
  const calls: ClaudeScript["calls"] = { ask: [], askVision: [] };

  const resolve = (
    matchers: Matcher[],
    prompt: string,
    options: AskOptions | undefined,
    kind: string,
  ): string => {
    const hit = matchers.find((m) => (!m.once || !m.used) && m.when(prompt, options));
    if (hit) {
      hit.used = true;
      const out = typeof hit.reply === "function" ? hit.reply(prompt, options) : hit.reply;
      if (process.env.DEBUG_CLAUDE) {
        // eslint-disable-next-line no-console
        console.log(
          `[claude ${kind}] ${hit.name} | sys="${(options?.system ?? "").slice(0, 45)}" | p="${prompt.slice(0, 60)}" -> ${out.slice(0, 60)}`,
        );
      }
      return out;
    }
    if (kind === "ask" && options?.system === NEXT_TURN_SYSTEM) {
      return nextTurnQueue.length > 0 ? nextTurnQueue.shift()! : DONE;
    }
    throw new Error(
      `scripted Claude: no ${kind} matcher for prompt (system=${options?.system?.slice(0, 40) ?? "none"}):\n` +
        prompt.slice(0, 800),
    );
  };

  const client: ClaudeClient = {
    ask: async (prompt, options) => {
      calls.ask.push({ prompt, options });
      return resolve(askMatchers, prompt, options, "ask");
    },
    askVision: async (_parts, prompt, options) => {
      calls.askVision.push({ prompt, options });
      return resolve(visionMatchers, prompt, options, "askVision");
    },
  };

  return {
    client,
    calls,
    onAsk: (name, when, reply, opts) =>
      askMatchers.push({ name, when, reply, used: false, once: opts?.once ?? false }),
    onVision: (name, when, reply, opts) =>
      visionMatchers.push({ name, when, reply, used: false, once: opts?.once ?? false }),
    queueNextTurn: (reply) => nextTurnQueue.push(reply),
  };
}

/** `true` when this `ask` prompt is an answer-parsing (`applyUserTurn`) call. */
export function isApplyTurn(_prompt: string, options?: AskOptions): boolean {
  return options?.system === APPLY_TURN_SYSTEM;
}

/** `true` when this `ask` prompt carries the taxpayer reply `text`. */
export function replyContains(text: string): (p: string, o?: AskOptions) => boolean {
  return (prompt, options) => isApplyTurn(prompt, options) && prompt.includes(text);
}

// ---------------------------------------------------------------------------
// Real PDF fixtures — pdf-lib in, unpdf (the real text-layer reader) out
// ---------------------------------------------------------------------------

/** WinAnsi standard fonts can't draw every code point — keep fixtures ASCII-safe. */
function asciiSafe(text: string): string {
  return text
    .replace(/[‐-―]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[^\x20-\x7E]/g, " ");
}

/**
 * Build a REAL single-/multi-page PDF whose text layer contains `lines`
 * verbatim, so `@aus-tax-lodge/extraction`'s `extractTextLayer` (unpdf) locates
 * every snippet and confidence lands `high` — never `unverified`.
 */
export async function textPdf(lines: readonly string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let page = doc.addPage([612, 792]);
  let y = 750;
  for (const raw of lines) {
    page.drawText(asciiSafe(raw), { x: 36, y, size: 10, font });
    y -= 16;
    if (y < 48) {
      page = doc.addPage([612, 792]);
      y = 750;
    }
  }
  return Buffer.from(await doc.save());
}

// ---------------------------------------------------------------------------
// WinZip-AES (AES-256, method 99) zip reader — proves the archive decrypts
// with the given password and enumerates + extracts its entries. Recovered
// verbatim from the v1 T23 harness (commit 515fa95^).
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
// HTTP-route drivers (the real POST handlers, called with a real Request)
// ---------------------------------------------------------------------------

function multipartRequest(url: string, filename: string, bytes: Buffer): Request {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(bytes)], filename, { type: "application/pdf" }));
  return new Request(url, { method: "POST", body: form });
}

export interface RouteResult {
  status: number;
  body: Record<string, unknown>;
}

/** `POST /api/returns/:id/prefill` with `fixture` as the uploaded file. */
export async function postPrefill(
  returnId: string,
  filename: string,
  bytes: Buffer,
): Promise<RouteResult> {
  const { POST } = await import("../../app/api/returns/[returnId]/prefill/route");
  const res = await POST(
    multipartRequest("http://localhost/api/returns/x/prefill", filename, bytes),
    {
      params: Promise.resolve({ returnId }),
    },
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** `POST /api/returns/:id/interview-document` with `fixture` as the uploaded file. */
export async function postInterviewDocument(
  returnId: string,
  filename: string,
  bytes: Buffer,
): Promise<RouteResult> {
  const { POST } = await import("../../app/api/returns/[returnId]/interview-document/route");
  const res = await POST(
    multipartRequest("http://localhost/api/returns/x/interview-document", filename, bytes),
    { params: Promise.resolve({ returnId }) },
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// Base return model — the pre-conversation state
// ---------------------------------------------------------------------------

/**
 * The return model as it stands the moment the chat opens.
 *
 * The v2 conversation owns everything from here — income confirmation, deduction
 * amounts, the FR-6 facts, the rental, review and approval. But two categories
 * of `collectInScopeFields` field have **no capture path in v2** and are seeded
 * here, exactly as the v1 T23 integration harness's `detailsModel()` seeded them
 * (they were the deleted six-step wizard's `details` step's job — see the T12
 * report):
 *
 *  1. the taxpayer identity block (`taxpayer.*`);
 *  2. the deduction substantiation metadata the interview allow-list has no path
 *     for (`deductions.workRelatedCar.ratePerKm` / `.substantiationRef` /
 *     `.businessKilometres`, every `deductions.*.substantiationRef`,
 *     `deductions.workFromHome.ratePerHour` / `.substantiationRef`);
 *  3. the rental property identity block (`rental.property.*`) — only checked
 *     once `rental.present`, so harmless on a non-rental return; the deleted
 *     wizard's `applyRentalIdentity` set it (v1 harness `settleRentalWiringGap`
 *     precedent).
 *
 * The interview still sets every deduction `.amount`, `workFromHome.hours`, the
 * income figures, private health, the FR-6 facts and the rental scope gate for
 * real.
 */
export function baseReturnModel(): ReturnModel {
  const m = createEmptyReturnModel("2025-26");
  const nilN = () => answer(unsetField<number>(), null);
  const nilS = () => answer(unsetField<string>(), null);
  return {
    ...m,
    rental: {
      ...m.rental,
      property: {
        ...m.rental.property,
        addressLine1: answer(unsetField<string>(), "10 Landlord Lane"),
        suburb: answer(unsetField<string>(), "Brunswick"),
        state: answer(unsetField<string>(), "VIC"),
        postcode: answer(unsetField<string>(), "3056"),
        firstEarnedIncomeOn: answer(unsetField<string>(), "2019-07-01"),
      },
    },
    taxpayer: {
      fullName: answer(unsetField<string>(), "Priya Example"),
      dateOfBirth: answer(unsetField<string>(), "1985-03-02"),
      postalAddress: answer(unsetField(), {
        line1: "1 Test St",
        line2: "",
        suburb: "Sydney",
        state: "NSW",
        postcode: "2000",
        country: "Australia",
      }),
      taxFileNumber: answer(unsetField<string>(), "123456782"),
      refundAccount: answer(unsetField(), {
        bsb: "062-000",
        accountNumber: "12345678",
        accountName: "Priya Example",
      }),
    },
    deductions: {
      ...m.deductions,
      workRelatedCar: {
        ...m.deductions.workRelatedCar,
        businessKilometres: nilN(),
        ratePerKm: nilN(),
        substantiationRef: nilS(),
      },
      workRelatedTravel: { ...m.deductions.workRelatedTravel, substantiationRef: nilS() },
      workRelatedClothing: { ...m.deductions.workRelatedClothing, substantiationRef: nilS() },
      selfEducation: { ...m.deductions.selfEducation, substantiationRef: nilS() },
      otherWorkRelated: { ...m.deductions.otherWorkRelated, substantiationRef: nilS() },
      giftsAndDonations: { ...m.deductions.giftsAndDonations, substantiationRef: nilS() },
      costOfManagingTaxAffairs: {
        ...m.deductions.costOfManagingTaxAffairs,
        substantiationRef: nilS(),
      },
      workFromHome: {
        ...m.deductions.workFromHome,
        ratePerHour: nilN(),
        substantiationRef: nilS(),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Conversation drivers — the real server actions + routes, revision-managed
// ---------------------------------------------------------------------------

async function returns() {
  return import("../../lib/returns");
}
async function actions() {
  return import("../../app/returns/[returnId]/actions");
}

/** Create a return seeded with {@link baseReturnModel} and the opening chat prompt. */
export async function createChatReturn(): Promise<string> {
  const { getReturnRepository, loadConversationForChat } = await returns();
  const created = await getReturnRepository().createReturn({
    data: baseReturnModel(),
    currentStep: "chat",
  });
  await loadConversationForChat(created.returnId); // seeds greeting + upload-prefill card
  return created.returnId;
}

/** `loadConversation` — the current conversation + model + envelope. */
export async function load(returnId: string): Promise<LoadedConversation> {
  return (await returns()).loadConversation(returnId);
}

/** The id of the last assistant card turn in the conversation. */
export function lastCardId(conversation: ConversationState): string {
  const card = [...conversation.turns]
    .reverse()
    .find((t) => t.role === "assistant" && t.kind === "card");
  if (!card) throw new Error("no assistant card turn in the conversation");
  return card.id;
}

/** `sendMessage` with the current revision fetched for you. */
export async function send(returnId: string, text: string) {
  const { sendMessage } = await actions();
  const rev = (await load(returnId)).envelope.revision;
  return sendMessage(returnId, rev, text);
}

/** `confirmIncome` on the latest income-checkpoint card. */
export async function confirmIncomeCheckpoint(returnId: string) {
  const { confirmIncome } = await actions();
  const loaded = await load(returnId);
  return confirmIncome(returnId, loaded.envelope.revision, lastCardId(loaded.conversation));
}

/** Resolve every still-unresolved `pendingConfirmation` by accepting it (PRD FR-5 "Yes"). */
export async function acceptAllPendingConfirmations(returnId: string): Promise<number> {
  const { resolveConfirmation } = await actions();
  let resolved = 0;
  // Each resolution recomputes the list; loop until nothing is left unresolved.
  for (let guard = 0; guard < 30; guard += 1) {
    const loaded = await load(returnId);
    const pending = loaded.conversation.pendingConfirmations.find((c) => !c.resolved);
    if (!pending) break;
    await resolveConfirmation(
      returnId,
      loaded.envelope.revision,
      lastCardId(loaded.conversation),
      pending.id,
      { accept: true },
    );
    resolved += 1;
  }
  return resolved;
}

/** `approveReturn` on the review-summary card with `password`. */
export async function approve(
  returnId: string,
  password: string,
  acknowledgeWarningIds?: string[],
) {
  const { approveReturn } = await actions();
  const loaded = await load(returnId);
  return approveReturn(
    returnId,
    loaded.envelope.revision,
    lastCardId(loaded.conversation),
    password,
    acknowledgeWarningIds,
  );
}

/**
 * Nil every still-`unset` rental expense line and `otherRentalIncome` — the
 * review screen's "mark the untouched rows nil" action, which v2 has no chat
 * equivalent for (v1 integration harness `settleRentalScheduleGaps`). Persisted
 * straight through the store; the conversation transcript is untouched.
 */
export async function settleRentalGaps(returnId: string): Promise<void> {
  const { loadConversation, saveConversation } = await returns();
  const loaded = await loadConversation(returnId);
  const { model } = loaded;
  const expenses = { ...model.rental.expenses };
  for (const key of RENTAL_EXPENSE_KEYS) {
    if (expenses[key].amount.status === "unset") {
      expenses[key] = { ...expenses[key], amount: markNotApplicable(expenses[key].amount) };
    }
  }
  const otherRentalIncome =
    model.rental.otherRentalIncome.status === "unset"
      ? markNotApplicable(model.rental.otherRentalIncome)
      : model.rental.otherRentalIncome;
  await saveConversation(returnId, {
    model: { ...model, rental: { ...model.rental, expenses, otherRentalIncome } },
    conversation: loaded.conversation,
    expectedRevision: loaded.envelope.revision,
  });
}

/** `correctIncome` — an inline "Something's off" correction on the income checkpoint. */
export async function correctIncomeCheckpoint(
  returnId: string,
  corrections: readonly { modelPath: string; value: number }[],
) {
  const { correctIncome } = await actions();
  const loaded = await load(returnId);
  return correctIncome(
    returnId,
    loaded.envelope.revision,
    lastCardId(loaded.conversation),
    corrections,
  );
}
