import {
  isAcceptedMimeType,
  isDocumentType,
  type AcceptedMimeType,
  type DocumentMetadata,
  type DocumentStore,
  type DocumentType,
} from "@aus-tax-lodge/store";
import type { ClassifyDocumentInput } from "@aus-tax-lodge/ai";

/**
 * Ingest path for uploaded tax documents (PRD FR-2): validate the file types,
 * classify each file, and store it encrypted via `@aus-tax-lodge/store`. Pure of
 * Next.js — the route handler passes a `FormData` and the resolved
 * store/classifier so this is unit-testable without the framework or the real
 * Claude API.
 */

const EXT_TO_MIME: Record<string, AcceptedMimeType> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

/** Accepted upload MIME types, for a human-readable error. */
export const ACCEPTED_UPLOAD_LABEL = "PDF, PNG or JPG";

/**
 * Resolves the effective MIME type for an upload, or `null` if it is not one of
 * the accepted types. A declared type wins; an empty/opaque declared type falls
 * back to the filename extension.
 */
export function resolveUploadMime(filename: string, declaredMime: string): AcceptedMimeType | null {
  if (isAcceptedMimeType(declaredMime)) return declaredMime;
  const opaque = declaredMime === "" || declaredMime === "application/octet-stream";
  if (opaque) {
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    return EXT_TO_MIME[ext] ?? null;
  }
  return null;
}

export interface RejectedUpload {
  readonly filename: string;
  readonly reason: string;
}

export interface IngestDeps {
  readonly store: Pick<DocumentStore, "putDocument">;
  readonly classify: (input: ClassifyDocumentInput) => Promise<DocumentType>;
}

export type IngestResult =
  | { readonly status: 201; readonly body: { readonly documents: DocumentMetadata[] } }
  | {
      readonly status: 400 | 415;
      readonly body: { readonly error: string; readonly rejected?: RejectedUpload[] };
    };

interface PreparedFile {
  readonly filename: string;
  readonly mimeType: AcceptedMimeType;
  readonly file: File;
}

/**
 * @param returnId  the return to attach the documents to
 * @param formData  `multipart/form-data` with one or more `files` entries and an
 *                  optional `type` field (a {@link DocumentType}) that, when
 *                  present and valid, is applied to every file and skips
 *                  classification (the user has told us what these are).
 */
export async function ingestUploads(
  returnId: string,
  formData: FormData,
  deps: IngestDeps,
): Promise<IngestResult> {
  const uploads = formData.getAll("files").filter((v): v is File => v instanceof File);
  if (uploads.length === 0) {
    return { status: 400, body: { error: "no files in the `files` field" } };
  }

  const forcedTypeRaw = formData.get("type");
  const forcedType =
    typeof forcedTypeRaw === "string" && isDocumentType(forcedTypeRaw) ? forcedTypeRaw : undefined;
  if (typeof forcedTypeRaw === "string" && forcedTypeRaw !== "" && !forcedType) {
    return { status: 400, body: { error: `unknown document type "${forcedTypeRaw}"` } };
  }

  const prepared: PreparedFile[] = [];
  const rejected: RejectedUpload[] = [];
  for (const file of uploads) {
    const mimeType = resolveUploadMime(file.name, file.type);
    if (!mimeType) {
      rejected.push({
        filename: file.name,
        reason: `unsupported file type (${file.type || "unknown"}) — accepts ${ACCEPTED_UPLOAD_LABEL}`,
      });
      continue;
    }
    prepared.push({ filename: file.name, mimeType, file });
  }

  // Atomic: reject the whole batch if any file is the wrong type, before storing.
  if (rejected.length > 0) {
    return {
      status: 415,
      body: { error: `only ${ACCEPTED_UPLOAD_LABEL} files are accepted`, rejected },
    };
  }

  const documents: DocumentMetadata[] = [];
  for (const item of prepared) {
    const bytes = Buffer.from(await item.file.arrayBuffer());
    const detectedType =
      forcedType ??
      (await deps.classify({ bytes, mimeType: item.mimeType, filename: item.filename }));
    documents.push(
      await deps.store.putDocument(returnId, {
        filename: item.filename,
        mimeType: item.mimeType,
        bytes,
        detectedType,
      }),
    );
  }

  return { status: 201, body: { documents } };
}
