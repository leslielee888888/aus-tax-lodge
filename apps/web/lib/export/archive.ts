import { PassThrough } from "node:stream";

import archiver from "archiver";
import zipEncrypted from "archiver-zip-encrypted";

import {
  assembleExportPackage,
  buildLodgeInstructions,
  lodgeInstructionsFilename,
  type ExportPackage,
  type ExportPackageInput,
} from "@aus-tax-lodge/export";

import { getDocumentStore } from "../store";

/**
 * The records archive (PRD FR-14, FR-18) — ONE standard **AES-256 encrypted
 * ZIP** (openable years later in 7-Zip / Keka / WinZip with the password)
 * containing the return JSON, the PDF, the validation report, the source index,
 * the "how to lodge" note, AND every source document decrypted from the
 * per-return store.
 *
 * Built on `archiver` + `archiver-zip-encrypted` (`format: "zip-encrypted"`,
 * `encryptionMethod: "aes256"`) — both pure JS, no native deps. The password is
 * used transiently here and never persisted anywhere (PRD FR-14, FR-17).
 */
const REGISTERED_FORMAT = "zip-encrypted";
let formatRegistered = false;

function ensureFormatRegistered(): void {
  if (formatRegistered) return;
  try {
    archiver.registerFormat(
      REGISTERED_FORMAT,
      zipEncrypted as unknown as (...args: unknown[]) => unknown,
    );
  } catch (err) {
    // "format already registered" — harmless when the module is re-evaluated.
    if (!/already registered/i.test((err as Error).message)) throw err;
  }
  formatRegistered = true;
}

/** Minimum records-archive password length (PRD FR-14). */
export const MIN_ARCHIVE_PASSWORD_LENGTH = 12;

export class WeakArchivePasswordError extends Error {
  constructor() {
    super(`The archive password must be at least ${MIN_ARCHIVE_PASSWORD_LENGTH} characters.`);
    this.name = "WeakArchivePasswordError";
  }
}

async function collect(stream: PassThrough): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return new Promise<Buffer>((resolve, reject) => {
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

export interface RecordsArchive {
  readonly filename: string;
  readonly bytes: Buffer;
  /** The export package that went into the archive — reused by the caller to persist the artifacts. */
  readonly pkg: ExportPackage;
}

/**
 * Build the encrypted records-archive zip for `returnId`.
 *
 * @param input     the export-package input (model + assessment + acknowledgements)
 * @param password  user-set, min {@link MIN_ARCHIVE_PASSWORD_LENGTH} chars — used
 *                  only to encrypt the zip, never stored.
 */
export async function buildRecordsArchive(
  returnId: string,
  input: ExportPackageInput,
  password: string,
): Promise<RecordsArchive> {
  if (password.length < MIN_ARCHIVE_PASSWORD_LENGTH) {
    throw new WeakArchivePasswordError();
  }
  ensureFormatRegistered();

  const pkg = await assembleExportPackage(input);
  const lodgeNote = buildLodgeInstructions(input);
  const store = getDocumentStore();
  const documents = await Promise.all(
    input.documents.map(async (ref) => {
      const stored = await store.getDocument(returnId, ref.docId);
      return { filename: ref.filename, bytes: stored.bytes };
    }),
  );

  const options = {
    zlib: { level: 9 },
    encryptionMethod: "aes256",
    password,
  } as unknown as archiver.ArchiverOptions;
  const archive = archiver.create(REGISTERED_FORMAT, options);
  const sink = new PassThrough();
  const done = collect(sink);
  archive.pipe(sink);

  for (const artifact of [pkg.pdf, pkg.json, pkg.validationReport, pkg.sourceIndex]) {
    archive.append(Buffer.from(artifact.bytes), { name: artifact.filename });
  }
  archive.append(Buffer.from(lodgeNote, "utf8"), {
    name: lodgeInstructionsFilename(input.targetYear),
  });

  const usedNames = new Set<string>();
  for (const doc of documents) {
    let name = `source-documents/${doc.filename}`;
    let counter = 2;
    while (usedNames.has(name)) {
      const dot = doc.filename.lastIndexOf(".");
      const base = dot > 0 ? doc.filename.slice(0, dot) : doc.filename;
      const ext = dot > 0 ? doc.filename.slice(dot) : "";
      name = `source-documents/${base} (${counter})${ext}`;
      counter += 1;
    }
    usedNames.add(name);
    archive.append(doc.bytes, { name });
  }

  await archive.finalize();
  const bytes = await done;

  return { filename: `tax-records-${input.targetYear}.zip`, bytes, pkg };
}
