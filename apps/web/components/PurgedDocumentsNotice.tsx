import { InfoIcon } from "./icons";
import { formatDate } from "../lib/format";

/**
 * A calm notice (not an error) shown on a return whose original source
 * documents were cleared by the FR-18 retention sweep. The return, its figures
 * and its export package are all still here; the encrypted records archive the
 * user downloaded at export time is the retention copy.
 */
export function PurgedDocumentsNotice({ purgedAt }: { purgedAt: string }) {
  return (
    <aside className="flex items-start gap-2 rounded-lg border border-border bg-surface-2 px-3.5 py-3 text-[12px] text-muted">
      <InfoIcon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
      <p className="text-pretty">
        Source documents for this return were purged on{" "}
        <time dateTime={purgedAt}>{formatDate(purgedAt)}</time> by the retention setting. The
        return, its figures and its export package are kept — the encrypted records archive you
        downloaded is your retention copy.
      </p>
    </aside>
  );
}
