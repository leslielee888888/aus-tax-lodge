/**
 * Help copy for the inline `upload-prefill` drop zone (PRD FR-1).
 *
 * Its own zero-dependency module so both the server seed
 * ({@link import("./returns").loadConversationForChat}) and the Client
 * Component ({@link import("../components/chat/cards/UploadPrefillCard").UploadPrefillCard})
 * can import it without pulling `lib/returns` (and its Node-only store/config
 * imports) into the client bundle.
 *
 * The seed writes these onto the card's `payload`; the card reads `payload`
 * first and falls back here, so a later task can override the copy per card.
 */
export const UPLOAD_PREFILL_HELP = {
  where: "Get it in myGov → ATO → Tax → Lodgments → Income tax → Pre-fill.",
  freshnessNote:
    "Your pre-fill report isn't final until employers, banks and funds finish reporting — usually late July or August. An earlier copy may understate your income.",
} as const;
