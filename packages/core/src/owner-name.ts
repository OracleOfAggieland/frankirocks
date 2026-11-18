/**
 * The owner's own name (brief 052 rulings 1 and 2). Pure: it reads only its arguments.
 *
 * The name is a Memory that already exists: the owner's `identity.alias` (`args.entityRef: "self"`) or their
 * `identity.name` (subject `self`). Only a name the owner gave counts, so a row that rests only on fixture Evidence
 * (the sample persona's own name) is never picked. The text must fit a short name, so nothing else can ride into the
 * Head line that carries it.
 */
import { type Dependent, type DocRef, type EC, type Snapshot, eligible, parseDep } from "./eligible";
import type { HeadMemory } from "./head";
import type { Au, Ref } from "./schema/primitives";
import type { Evidence, Memory } from "./schema/records";
import { spokenGrade } from "./spoken";

/** Letters, marks, spaces, apostrophes, hyphens and periods, 1 to 40 of them once trimmed (ruling 2). */
const NAME_TEXT = /^[\p{L}\p{M} '’.-]{1,40}$/u;

export interface OwnerName {
  text: string;
  /** The Memory behind the name, so a forget of it reaches the Head. */
  ref: Ref;
}

/**
 * Whether a Memory line of this Sensitivity may sit in a Head compiled for this audience (task 45). Private takes
 * every spoken-grade line below S2; company and unknown take S0 only (fails closed for unknown).
 */
export function headAdmitsSens(audience: Au, sens: Memory["sens"]): boolean {
  return audience === "private" || sens === "S0";
}

/**
 * The Head's own filter for one Memory (R26.2, R26.3, R28.1 to R28.3; task 45): eligible at `project`, spoken grade,
 * not S2, and a Sensitivity the audience admits. `compileHead` and `ownerName` share it, so the two cannot drift.
 */
export function headAdmits(hm: HeadMemory, ec: EC, snapshot: Snapshot, audience: Au): boolean {
  const x: Dependent = { ref: memoryDocRef(hm), row: hm.memory };
  if (!eligible(x, { ...ec, stage: "project" }, snapshot).allow) return false;
  if (!spokenGrade(x, ec, snapshot).allow) return false;
  if (hm.memory.sens === "S2") return false;
  return headAdmitsSens(audience, hm.memory.sens);
}

/** A self `identity.name` or self `identity.alias`, whatever its value or what it rests on. */
export function isSelfNameRow(m: Memory): boolean {
  if (m.predicate === "identity.name") return m.subjectId === "self";
  if (m.predicate === "identity.alias") return m.args.entityRef === "self";
  return false;
}

/**
 * Whether the Memory rests only on fixture Evidence: it names at least one Evidence, and every Evidence it names is
 * in the Snapshot with `source: "fixture"`. An Evidence the Snapshot doesn't hold answers nothing either way, so the
 * caller fails closed on it (`restsOnOwnerWords`).
 */
export function restsOnlyOnFixture(m: Memory, snapshot: Snapshot): boolean {
  const deps = evidenceDeps(m);
  return deps.length > 0 && deps.every((id) => evidenceIn(snapshot, id)?.source === "fixture");
}

/** Whether every Evidence the Memory names is in the Snapshot and at least one of them is not fixture Evidence. */
function restsOnOwnerWords(m: Memory, snapshot: Snapshot): boolean {
  const found = evidenceDeps(m).map((id) => evidenceIn(snapshot, id));
  return found.length > 0 && found.every((e) => e !== undefined) && found.some((e) => e!.source !== "fixture");
}

/**
 * Ruling 2: the owner's own name from the Memories that pass the Head's filter for this audience, or null. A self
 * `identity.alias` or `identity.name`, kind `fact`, value `text`, resting on the owner's words (not fixture Evidence
 * only), whose trimmed text is a short name. Alias before name, then the latest `assertedAt`, then the smallest id,
 * so input order never matters.
 */
export function ownerName(input: { memories: readonly HeadMemory[]; ec: EC; snapshot: Snapshot; audience?: Au }): OwnerName | null {
  const audience = input.audience ?? "private";
  let best: { hm: HeadMemory; text: string } | null = null;
  for (const hm of input.memories) {
    const m = hm.memory;
    if (!isSelfNameRow(m) || m.kind !== "fact" || m.value.kind !== "text") continue;
    const text = m.value.text.trim();
    if (!NAME_TEXT.test(text)) continue;
    if (!restsOnOwnerWords(m, input.snapshot)) continue;
    if (!headAdmits(hm, input.ec, input.snapshot, audience)) continue;
    if (best === null || before(hm, best.hm)) best = { hm, text };
  }
  return best === null ? null : { text: best.text, ref: { type: "memory", id: best.hm.id, rev: best.hm.memory.rev } };
}

/** Alias before name, then the latest `assertedAt`, then the smallest id. */
function before(a: HeadMemory, b: HeadMemory): boolean {
  const alias = (hm: HeadMemory) => (hm.memory.predicate === "identity.alias" ? 0 : 1);
  if (alias(a) !== alias(b)) return alias(a) < alias(b);
  if (a.memory.assertedAt !== b.memory.assertedAt) return a.memory.assertedAt > b.memory.assertedAt;
  return a.id < b.id;
}

function evidenceDeps(m: Memory): string[] {
  const out: string[] = [];
  for (const d of m.dependsOn) {
    const p = parseDep(d);
    if (p?.collection === "evidence") out.push(p.id);
  }
  return out;
}

function evidenceIn(snapshot: Snapshot, id: string): Evidence | undefined {
  const i = snapshot.refs.findIndex((r) => r.collection === "evidence" && r.id === id);
  return i < 0 ? undefined : (snapshot.rows[i] as Evidence | undefined);
}

function memoryDocRef(hm: HeadMemory): DocRef {
  return { collection: "memories", id: hm.id, parentId: null, rev: hm.memory.rev };
}
