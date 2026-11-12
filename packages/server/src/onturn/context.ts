/**
 * The route's context, chosen by code (brief 012 design 3.0, G7, G16): one read of every Memory and the Snapshot
 * they are judged against, taken after `beginRequest`, outside the transaction. It feeds the FastSlots packet
 * (`entities`; `targets` stay empty for hardRule alone), the subject index validation resolves against, and the Head
 * the transaction compiles with the new `core/rules` (G16's overlay: a hardRule write changes no Memory, so the
 * overlay is the rules document alone).
 */
import { type CoreEpoch, type CoreRules, type EID, type Evidence, FAST_SLOTS_ENTITIES, FAST_SLOTS_TARGETS, type FastSlotsInput, type HeadMemory, type Hasher, type ID, type Memory, type Snapshot, type SubjectIndex, type TurnEvidence, TRUTH_ORDER, currentNames, entityLabel, mentionEid, mentionName, protectedRow, renderedMemory, rootKey } from "@franki/core";
import { pickOpen } from "../worker/extract";
import { readAllMemories, snapshotFor } from "../head-build";
import type { Tx } from "../store/port";

type Reader = Pick<Tx, "get" | "query">;
type Entity = { id: EID; label: string; aliases: readonly string[] };

export interface OnTurnContext {
  memories: HeadMemory[];
  snapshot: Snapshot;
  known: SubjectIndex;
  /**
   * Brief 025: the correct and transition routes this turn opened (RX6, RX7 or a parse candidate), and the targets the
   * FastSlots packet showed. Absent: neither route opened, no targets.
   */
  memoryRoutes?: { correct: boolean; transition: boolean };
  targets?: Map<ID, OnTurnTarget>;
}

export async function readOnTurnContext(reader: Reader, uid: string, epoch: CoreEpoch, generation: number): Promise<OnTurnContext> {
  const memories = await readAllMemories(reader, uid);
  const snapshot = await snapshotFor(reader, uid, memories, epoch, generation);
  return { memories, snapshot, known: subjectIndex(memories, null) };
}

/**
 * The subject index (G7): every active `person.relation` row of `self` (its `otherRef`, labelled with the owner's
 * word, else the relation code), then the subjects `core/rules` labels. `seen` is every EID a Memory names (SU7).
 */
export function subjectIndex(memories: readonly HeadMemory[], rules: CoreRules | null, hasher?: Hasher): SubjectIndex {
  const names = currentNames(memories);
  const entries: SubjectIndex["entries"][number][] = [];
  const has = new Set<string>();
  for (const { memory: m } of memories) {
    if (m.predicate !== "person.relation" || m.subjectId !== "self" || m.status !== "active") continue;
    const other = (m.args as { otherRef?: unknown }).otherRef;
    if (typeof other !== "string" || has.has(other)) continue;
    const code = m.value.kind === "enum" ? m.value.code : null;
    const word = (m.args as { label?: unknown }).label;
    const own = typeof word === "string" && word !== "" ? word : null;
    // G7 and G33 (task C2): the current name, else the name in the row's line, else the owner's word, else the code.
    const label = entityLabel(other, renderedMemory(m), m.args as { label?: unknown }, code, names, hasher);
    has.add(other);
    entries.push({ id: other, kind: "person", label, aliases: [...new Set([label, ...(own === null ? [] : [own]), ...(code === null ? [] : [code])])], relation: code });
  }
  for (const l of rules?.subjectLabels ?? []) {
    if (has.has(l.subjectId)) continue;
    has.add(l.subjectId);
    entries.push({ id: l.subjectId, kind: "person", label: l.label, aliases: [l.label], relation: null });
  }
  const seen = new Set<EID>();
  for (const { memory: m } of memories) for (const e of m.entityIds ?? []) seen.add(e);
  return { entries, seen };
}

/** At most `FAST_SLOTS_ENTITIES` entities: those the turn names by label or alias first, then the rest in order. */
export function entitiesFor(known: SubjectIndex, text: string): Entity[] {
  const t = ` ${text.toLowerCase()} `;
  const named = (e: SubjectIndex["entries"][number]) => [e.label, ...e.aliases].some((a) => a !== "" && t.includes(a.toLowerCase()));
  const all = known.entries.map((e) => ({ e, n: named(e) }));
  return [...all.filter((x) => x.n), ...all.filter((x) => !x.n)].slice(0, FAST_SLOTS_ENTITIES).map(({ e }) => ({ id: e.id, label: e.label.slice(0, 80), aliases: e.aliases.slice(0, 4) }));
}

/** The turn's Evidence as the validators and planners read it. */
export function turnEvidence(record: Evidence, eid: string, hasher: Hasher): TurnEvidence {
  const text = record.text !== null && record.text.kind === "inline" ? record.text.text : "";
  return { eid, rev: record.rev, text, slices: record.fieldSlices, rootKeys: record.fieldSlices.map((s) => rootKey(s, hasher)), assertedAt: record.assertedAt, zone: null };
}

/** One target code chose, as validation reads it and as the FastSlots packet carries it. */
export interface OnTurnTarget {
  rev: number;
  memory: Memory;
  line: string;
}

/**
 * The correct route's targets (design 3.0; task C2): `pickOpen` over the context with the turn's words and the earlier
 * turns' words, as extraction's `open` is chosen, minus protected rows (rules and allergies), at most
 * `FAST_SLOTS_TARGETS`, each with its stored line.
 */
export function correctionTargets(context: Pick<OnTurnContext, "memories">, said: readonly string[]): Map<ID, OnTurnTarget> {
  const byId = new Map(context.memories.map((m) => [m.id, m.memory]));
  const open = pickOpen(context.memories, said);
  const out = new Map<ID, OnTurnTarget>();
  for (const o of open.list) {
    const m = byId.get(o.id);
    if (m === undefined || protectedRow(m)) continue;
    if (out.size >= FAST_SLOTS_TARGETS) break;
    out.set(o.id, { rev: o.rev, memory: m, line: o.rendered });
  }
  return out;
}

/** Truth-order rows read for one turn, at most (brief 025 task D2). */
export const TRUTH_TARGETS_MAX = 48;
const TRUTH_PREDICATES = new Set(Object.values(TRUTH_ORDER).flat());

/**
 * The transition route's targets (design 3.3, brief 025 task D2): code's own pick, never shown to the model. Every
 * active or history row on a truth-order predicate whose subject is the owner or an entity the turn names (by the
 * subject index's labels, or by a word that derives the entity's ID, "my dad" naming dad), and every `care` row
 * about such an entity. Protected rows are never targets. Newest first, at most `TRUTH_TARGETS_MAX`.
 */
export function truthOrderTargets(context: Pick<OnTurnContext, "memories">, text: string, known: SubjectIndex, hasher: Hasher): Map<ID, OnTurnTarget> {
  const named = new Set<EID>(["self"]);
  const t = ` ${text.toLowerCase()} `;
  for (const e of known.entries) if ([e.label, ...e.aliases].some((a) => a !== "" && t.includes(a.toLowerCase()))) named.add(e.id);
  for (const w of text.match(/[\p{L}][\p{L}'-]*/gu) ?? []) for (const kind of ["person", "place", "organization"] as const) named.add(mentionEid(kind, mentionName(w), hasher));
  const rows = context.memories
    .filter(({ memory: m }) => (m.status === "active" || m.status === "history") && TRUTH_PREDICATES.has(m.predicate) && !protectedRow(m))
    .filter(({ memory: m }) => named.has(m.subjectId) || (m.predicate === "care" && typeof m.args.careSubjectRef === "string" && named.has(m.args.careSubjectRef)))
    .sort((a, b) => (a.memory.updatedAt < b.memory.updatedAt ? 1 : a.memory.updatedAt > b.memory.updatedAt ? -1 : a.id < b.id ? -1 : 1))
    .slice(0, TRUTH_TARGETS_MAX);
  return new Map(rows.map((r) => [r.id, { rev: r.memory.rev, memory: r.memory, line: renderedMemory(r.memory) }]));
}

/** The packet's `targets` (2.2): each target's predicate, value, args and stored line. */
export function packetTargets(targets: ReadonlyMap<ID, OnTurnTarget>): FastSlotsInput["targets"] {
  return [...targets].map(([id, t]) => ({ id, predicate: t.memory.predicate, value: t.memory.value, args: t.memory.args, line: t.line }));
}
