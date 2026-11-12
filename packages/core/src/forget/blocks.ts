/**
 * Forget's clause of `eligible` (contracts §4 clause "root/provider/semantic/topic block in state active or
 * review"; spec §8 step 5; brief 021). Pure. Called from one seam in `eligible.ts`; nothing else decides what a
 * block or an overlay denies.
 *
 * - A root block denies every row carrying its root key.
 * - A provider block denies Evidence with its provider key, except the revision it allows.
 * - A semantic block denies a Memory with its subject, predicate and slot key (design note 021, gap 4); a topic
 *   block denies a Memory in its topic. A new U or C Memory written after the block, on roots no root block
 *   names, passes both (contracts §4).
 * - A negative assertion restrains; it denies no read.
 * - An overlay (active or materialized) denies the Memory or Evidence it names. Overlays on a dependency are
 *   not read here: walking dependencies is closure (spec §8 step 6), which this part does not build.
 */
import type { DocRef, Row, Snapshot } from "../eligible";
import { msFromTs } from "../schema/primitives";
import type { Block, Evidence, Memory, Overlay } from "../schema/records";

interface BlockIndex {
  roots: Set<string>;
  providers: Block[];
  semantic: Block[];
  topics: Block[];
  overlaid: Set<string>;
}

const cache = new WeakMap<object, BlockIndex>();

const OVERLAY_COLLECTION: Partial<Record<string, string>> = { memory: "memories", evidence: "evidence" };

function indexOf(s: Snapshot): BlockIndex {
  let ix = cache.get(s);
  if (ix !== undefined) return ix;
  ix = { roots: new Set(), providers: [], semantic: [], topics: [], overlaid: new Set() };
  for (const b of s.blocks) {
    if (b.kind === "root" && b.rootKey !== null) ix.roots.add(b.rootKey);
    else if (b.kind === "provider" && b.providerKey !== null) ix.providers.push(b);
    else if (b.kind === "semantic") ix.semantic.push(b);
    else if (b.kind === "topic" && b.topicId !== null) ix.topics.push(b);
  }
  for (let i = 0; i < s.refs.length; i++) {
    if (s.refs[i]!.collection !== "overlays") continue;
    const o = s.rows[i] as Overlay;
    const collection = OVERLAY_COLLECTION[o.targetRef.type];
    if (collection !== undefined) ix.overlaid.add(`${collection}/${o.targetRef.id}`);
  }
  cache.set(s, ix);
  return ix;
}

/** A U or C Memory written after `b`, on roots no root block names. */
function newerOwn(m: Memory, b: Block, ix: BlockIndex): boolean {
  if (m.sourceClass !== "U" && m.sourceClass !== "C") return false;
  if (msFromTs(m.createdAt) <= msFromTs(b.createdAt)) return false;
  return m.rootKeys.every((k) => !ix.roots.has(k));
}

/** True when a forget block or overlay denies this row. */
export function forgetDenies(ref: DocRef, row: Row, s: Snapshot): boolean {
  const ix = indexOf(s);
  if (ix.overlaid.has(`${ref.collection}/${ref.id}`)) return true;
  if (row.rootKeys.some((k) => ix.roots.has(k))) return true;
  if (ref.collection === "evidence") {
    const e = row as Evidence;
    return e.providerKey !== null && ix.providers.some((b) => b.providerKey === e.providerKey && b.allowedEvidenceId !== ref.id);
  }
  const m = row as Memory;
  for (const b of ix.semantic) {
    if (b.entityId === m.subjectId && b.predicate === m.predicate && b.key === m.key && !newerOwn(m, b, ix)) return true;
  }
  for (const b of ix.topics) {
    if (m.topicIds.includes(b.topicId!) && !newerOwn(m, b, ix)) return true;
  }
  return false;
}
