/**
 * The route note and the typed lines (brief 012 design 2.7, G2, G17, G30; CQ 97). Pure.
 *
 * A route note is a fixed S0 pointer: a closed template with no slot, so no owner words, allergen, name or value.
 * The specifics reach the model only through the Head's rules section. One route note per turn; its text joins the
 * templates the plan chose, and its kind is `result` when anything was saved, else `clarification`.
 */
import type { ID, TS } from "../schema/primitives";
import type { W } from "../schema/wire";
import type { RouteNoteKind } from "./types";

export const ROUTE_NOTE_TEXT: Readonly<Record<RouteNoteKind, string>> = {
  ruleSaved: "The hard rule the owner just stated is saved and listed under Hard rules. Confirm it briefly in your own words.",
  ruleAlready: "That hard rule was already saved and is listed under Hard rules. Say so briefly.",
  ruleKept: "That hard rule stays on; a spoken request can't remove it. Say so briefly, and don't name another way to remove it.",
  noneSaved: "Saved: nothing beyond what is listed under Hard rules. Confirm it briefly.",
  "ask.whatItem": "Something under Hard rules is not yet clear, and food stays filtered for it. Ask one short question: what it was.",
  "ask.whoHas": "Something under Hard rules is not yet clear, and food stays filtered for it. Ask one short question: who it applies to.",
  "ask.isAllergy": "Something under Hard rules is not yet clear, and food stays filtered for it. Ask one short question: whether it is a real reaction or just a dislike.",
  "ask.notListed": "What the owner named isn't on the list that can be saved yet, so food stays filtered. Say so plainly, and that you'll check with them before any food.",
  corrected: "The correction the owner just made is saved. Use the corrected value.",
  renamed: "The name the owner just corrected is saved. Use the new name.",
  retracted: "The saved detail the owner just called wrong is no longer used.",
};

/** `ruleSaved` outside a private audience (2.7). */
export const RULE_SAVED_NOT_PRIVATE = "The hard rule the owner just stated is saved and listed under Hard rules. Say only that it is noted.";

/** The templates that report a saved write; any of them makes the note a `result`. */
const SAVED: ReadonlySet<RouteNoteKind> = new Set(["ruleSaved", "ruleAlready", "noneSaved", "corrected", "renamed", "retracted"]);

/** A route note's time to live, the same as a typed reply's. */
export const ROUTE_NOTE_TTL_MS = 60_000;

/** The one route note for a turn's templates, or null when there are none. */
export function routeNote(kinds: readonly RouteNoteKind[], at: { noteId: ID; expiresAt: TS; privateAudience: boolean }): W | null {
  const unique = [...new Set(kinds)];
  if (unique.length === 0) return null;
  const text = unique.map((k) => (k === "ruleSaved" && !at.privateAudience ? RULE_SAVED_NOT_PRIVATE : ROUTE_NOTE_TEXT[k])).join(" ");
  return {
    noteId: at.noteId,
    rev: 1,
    kind: unique.some((k) => SAVED.has(k)) ? "result" : "clarification",
    text: text.slice(0, 1024),
    rootKeys: [],
    dependsOn: [],
    sens: "S0",
    expiresAt: at.expiresAt,
    unprompted: false,
    momentId: null,
    tokens: [],
  };
}

/** The owner-facing typed lines (G17), a closed table chosen from the committed write. */
export const TYPED_LINES = {
  saved: "Saved as a hard rule.",
  kept: "That hard rule stays on.",
  filtered: "Noted. I'll check with you before suggesting food.",
  none: "Saved.",
  corrected: "Corrected.",
} as const;

/** The one typed line for a turn's templates: a question first (food stays filtered), then saved, kept, none. */
export function typedLine(kinds: readonly RouteNoteKind[]): string | null {
  if (kinds.some((k) => k.startsWith("ask."))) return TYPED_LINES.filtered;
  if (kinds.includes("ruleSaved")) return TYPED_LINES.saved;
  if (kinds.includes("ruleAlready") || kinds.includes("ruleKept")) return TYPED_LINES.kept;
  if (kinds.includes("noneSaved")) return TYPED_LINES.none;
  if (kinds.some((k) => k === "corrected" || k === "renamed" || k === "retracted")) return TYPED_LINES.corrected;
  return null;
}
