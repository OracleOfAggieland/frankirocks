// Turn copies on the client (lab-ui-foundation R14.8, R17.5). Pure.
import type { TurnCopies } from "./surface-props";

export interface ReplyEntry {
  role: "user" | "franki";
  text: string;
}

/**
 * The Reply_Line text: Franki's entries after the last user entry, joined with spaces, or null when
 * there are none. Earlier lines never show (UI direction principle 1).
 */
export function latestReply(entries: readonly ReplyEntry[]): string | null {
  let lastUser = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].role === "user") {
      lastUser = i;
      break;
    }
  }
  const texts = entries
    .slice(lastUser + 1)
    .filter((e) => e.role === "franki")
    .map((e) => e.text.trim())
    .filter((t) => t !== "");
  return texts.length === 0 ? null : texts.join(" ");
}

/** After a completed forget, every turn copy goes: reply, caption, typed text, cards and jar items. */
export function clearTurnCopies(s: TurnCopies): TurnCopies {
  return { ...s, reply: null, caption: null, typedText: "", cards: [], jarItems: [] };
}
