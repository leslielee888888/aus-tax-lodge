import type { DocumentMetadata } from "@aus-tax-lodge/store";

import { Card, CardBody, CardHeader, CardTitle } from "../../../../components/Card";
import { FileIcon } from "../../../../components/icons";
import { documentTypeLabel } from "../../../../lib/document-types";

export interface DocumentsReadOnlyProps {
  readonly documents: readonly DocumentMetadata[];
}

/** Values-only document list for a return that's read-only under PRD FR-16 — no upload, correction, or extraction controls. */
export function DocumentsReadOnly({ documents }: DocumentsReadOnlyProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Uploaded documents</CardTitle>
      </CardHeader>
      <CardBody className="divide-y divide-border p-0">
        {documents.length === 0 ? (
          <p className="p-5 text-sm text-muted">No documents were uploaded on this return.</p>
        ) : (
          documents.map((doc) => (
            <div key={doc.docId} className="flex items-center gap-3 px-5 py-3.5">
              <span
                className="flex size-[30px] shrink-0 items-center justify-center rounded-[7px] border border-border bg-surface text-muted"
                aria-hidden="true"
              >
                <FileIcon className="size-3.5" />
              </span>
              <span className="text-[13px] font-medium">{doc.filename}</span>
              <span className="ml-auto text-xs text-muted">{documentTypeLabel(doc.detectedType)}</span>
            </div>
          ))
        )}
      </CardBody>
    </Card>
  );
}
