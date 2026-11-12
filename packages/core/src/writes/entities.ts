/**
 * The names code gives the entities it knows (brief 012 design 3.0, G7, G33; task C2). Pure.
 *
 * An entity a relation row names is labelled, in order, with its current name (an active `identity.name` row of the
 * entity), else the word in the row's stored line that derives the entity's ID (G33: "Maya is the owner's sister."
 * names Maya), else the owner's own word for the relation (`args.label`), else the relation code.
 */
import type { Hasher } from "../ids";
import type { EID } from "../schema/primitives";
import type { Memory } from "../schema/records";
import { mentionEid, mentionName } from "./subject";
import type { EntityKind } from "./types";

/** The word in `line` whose mention name derives `entity`, or null. */
export function nameInLine(entity: EID, line: string, kind: EntityKind, hasher: Hasher): string | null {
  for (const t of line.match(/[\p{L}][\p{L}'-]*/gu) ?? []) {
    if (mentionEid(kind, mentionName(t), hasher) === entity) return t;
  }
  return null;
}

/** Each entity's current name: the text of its one active `identity.name` row. Two active rows name nothing. */
export function currentNames(memories: readonly { memory: Memory }[]): Map<EID, string> {
  const seen = new Map<EID, string | null>();
  for (const { memory: m } of memories) {
    if (m.predicate !== "identity.name" || m.subjectId === "self" || m.status !== "active" || m.value.kind !== "text") continue;
    seen.set(m.subjectId, seen.has(m.subjectId) ? null : m.value.text);
  }
  return new Map([...seen].flatMap(([k, v]) => (v === null ? [] : [[k, v] as const])));
}

/** The label of the entity a relation row names (G7's order, above). */
export function entityLabel(entity: EID, line: string, args: { label?: unknown }, code: string | null, names: ReadonlyMap<EID, string>, hasher?: Hasher): string {
  const current = names.get(entity);
  if (current !== undefined && current.trim() !== "") return current;
  const said = hasher === undefined ? null : nameInLine(entity, line, "person", hasher);
  if (said !== null) return said;
  if (typeof args.label === "string" && args.label !== "") return args.label;
  return code ?? "someone";
}
