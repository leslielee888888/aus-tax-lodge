import type { CardRef } from "../../../lib/conversation";
import { ConfirmFigureCard } from "./ConfirmFigureCard";
import { IncomeCheckpointCard } from "./IncomeCheckpointCard";
import { OutOfScopeCard } from "./OutOfScopeCard";
import type { CardComponent, CardComponentMap } from "./types";
import { UploadPrefillCard } from "./UploadPrefillCard";

/**
 * `CardRef` → real card body (PRD §7, Q4). See {@link import("./types")} for the
 * pattern: T5–T8 add their entry here and nothing in `ChatTranscript` changes.
 * A type with no entry renders the `CardPlaceholder` shell.
 */
export const CARD_COMPONENTS: CardComponentMap = {
  "upload-prefill": UploadPrefillCard,
  "income-checkpoint": IncomeCheckpointCard,
  "confirm-figure": ConfirmFigureCard,
  "out-of-scope": OutOfScopeCard,
};

export function cardComponentFor(type: CardRef): CardComponent | undefined {
  return CARD_COMPONENTS[type];
}
