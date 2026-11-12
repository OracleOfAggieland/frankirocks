/**
 * The rename index (brief 012 design G14, CQ 109; brief 025 task C4). Pure.
 *
 * A `wrong` `identity.name` row of an entity gives an old name; the entity's one current name row that passes the
 * caller's checks (eligible, Spoken_Grade, below S2, and for the Head the audience) gives the new one. Every line
 * whose `entityIds` hold that entity is rendered with the current name in place of the old one (whole word), and
 * the name row joins the line's refs. With no such current row, a line that names the entity by the old name is left
 * out, never shown with it. An old name that is also the current name of another entity in the line is left alone.
 */
import type { Ref } from "../schema/primitives";
import type { Memory } from "../schema/records";
import { mentionName } from "./subject";

export interface RenameRow {
  id: string;
  memory: Memory;
}

export interface Rename {
  /** Old names, as said, never equal to the current one after `mentionName`. */
  from: string[];
  /** The current name and its row, or null when no current name row may be spoken. */
  to: { name: string; ref: Ref } | null;
  /** The newest wrong name row's ID and when the current name was asserted: extraction's salt and cut-off (G14). */
  renameId: string;
  at: string;
}

export interface RenameIndex {
  /** By entity. */
  renames: ReadonlyMap<string, Rename>;
  /** Every entity's one speakable current name, renamed or not. */
  names: ReadonlyMap<string, string>;
}

export const NO_RENAMES: RenameIndex = { renames: new Map(), names: new Map() };

const isName = (m: Memory) => m.predicate === "identity.name" && m.subjectId !== "self" && m.value.kind === "text" && m.value.text.trim() !== "";

/**
 * The index over `all` rows, with current names taken only from `speakable` rows (already checked by the caller).
 * Two speakable current names for one entity name nothing: its old-name lines are left out (fail closed).
 */
export function renameIndex(all: readonly RenameRow[], speakable: readonly RenameRow[]): RenameIndex {
  const current = currentNameRows(speakable);
  const wrong = new Map<string, RenameRow[]>();
  for (const r of all) {
    if (!isName(r.memory) || r.memory.status !== "wrong") continue;
    wrong.set(r.memory.subjectId, [...(wrong.get(r.memory.subjectId) ?? []), r]);
  }
  const out = new Map<string, Rename>();
  for (const [entity, rows] of wrong) {
    const cur = current.get(entity) ?? null;
    const curName = cur === null ? null : textOf(cur.memory);
    const from = [...new Set(rows.map((r) => textOf(r.memory)))].filter((n) => curName === null || mentionName(n) !== mentionName(curName));
    if (from.length === 0) continue;
    const newest = [...rows].sort((a, b) => (a.memory.updatedAt < b.memory.updatedAt ? 1 : a.memory.updatedAt > b.memory.updatedAt ? -1 : a.id < b.id ? -1 : 1))[0]!;
    out.set(entity, {
      from,
      to: cur === null ? null : { name: curName!, ref: { type: "memory", id: cur.id, rev: cur.memory.rev } },
      renameId: newest.id,
      at: cur?.memory.assertedAt ?? newest.memory.updatedAt,
    });
  }
  return { renames: out, names: new Map([...current].map(([k, v]) => [k, textOf(v.memory)])) };
}

/** Each entity's one speakable current name row; two of them name nothing. */
function currentNameRows(rows: readonly RenameRow[]): Map<string, RenameRow> {
  const seen = new Map<string, RenameRow | null>();
  for (const r of rows) {
    if (!isName(r.memory) || r.memory.status !== "active") continue;
    const prior = seen.get(r.memory.subjectId);
    seen.set(r.memory.subjectId, prior === undefined ? r : prior !== null && mentionName(textOf(prior.memory)) === mentionName(textOf(r.memory)) ? prior : null);
  }
  return new Map([...seen].flatMap(([k, v]) => (v === null ? [] : [[k, v] as const])));
}

const textOf = (m: Memory) => (m.value.kind === "text" ? m.value.text : "");

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordRe = (w: string) => new RegExp(`(^|[^\\p{L}\\p{N}])(${escape(w)})(?=$|[^\\p{L}\\p{N}])`, "giu");

/** Whether `text` holds `w` as a whole word, ignoring case. */
export function hasWord(text: string, w: string): boolean {
  return wordRe(w).test(text);
}

/**
 * One line rendered through the index: its text with old names replaced and the name rows it now leans on, or null
 * when the line must be left out. A name row of the renamed entity itself is never rewritten.
 */
export function renameLine(text: string, m: Memory, index: RenameIndex): { text: string; refs: Ref[] } | null {
  if (index.renames.size === 0) return { text, refs: [] };
  const ents = m.entityIds ?? [];
  let out = text;
  const refs: Ref[] = [];
  for (const e of ents) {
    const r = index.renames.get(e);
    if (r === undefined) continue;
    if (m.predicate === "identity.name" && m.subjectId === e) continue;
    for (const old of r.from) {
      if (!hasWord(out, old)) continue;
      // Another entity in the line is called this now: the word may be theirs, so it stays.
      if (ents.some((o) => o !== e && index.names.has(o) && mentionName(index.names.get(o)!) === mentionName(old))) continue;
      if (r.to === null) return null;
      out = out.replace(wordRe(old), (_all, pre: string) => `${pre}${r.to!.name}`);
      if (!refs.some((x) => x.id === r.to!.ref.id)) refs.push(r.to.ref);
    }
  }
  return { text: out, refs };
}
