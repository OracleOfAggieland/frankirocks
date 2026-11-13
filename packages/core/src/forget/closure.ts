/**
 * Closure, pure (spec §8 step 6; contracts §8 step 6; registry `forget` column; brief 047 rulings 1, 3, 4 and 5).
 * Given the whole store as read by the executor under its lease (maintenance: never through `eligible`, ruling 3),
 * it decides what withdraws and what is restamped:
 *
 *   - The walk. Forgotten inputs are the Evidence this op blocked (install's ranged Evidence and the request's own
 *     Evidence) and the target Memories. A Memory read a forgotten input when its packet names one (`packetEids`), its
 *     `dependsOn`, `contextIds`, `supportingIds` or hypothesis premises name one, or it carries a blocked root key. Its
 *     packet (`packetEids[0]`, one turn in the floor) is then dirty, and every output of a dirty packet is a
 *     derivative whether or not it cited the input (ruling 5). The walk repeats until nothing changes (transitive).
 *   - Code survivors (ruling 4, the floor: no re-extraction, no `ruleSalvage`). A derivative survives only as a typed
 *     value code can verify on the sanitized text with an independent subject (`codeSurvivor`). Hard rules were
 *     re-anchored by install and are not touched here.
 *   - Withdrawal. Every other derivative that is not a target withdraws through `planWithdrawal`: it is `retracted`
 *     (a `wrong` mark stays `wrong`), the effects it premised are retracted, and its exclude, quiet and care holds live
 *     on as content-free `withdrawnHold`s. Moments of a derivative are cancelled (`forgotten`). Turns whose Evidence
 *     this op blocked carry the sanitized text and Evidence, or none; the request turns lose their Evidence. Opened
 *     topics and grants on a derivative's topics are cleared from every Session.
 *   - Restamp (ruling 1, answers F-163). Every surviving Memory and retained Evidence below the barrier's epoch is
 *     stamped to it, `dirty: false`, so `eligible`'s clause 5 lets it through once the barrier clears.
 *
 * Writes come in groups (one withdrawn Memory with its effects and holds, or one row), so a page never splits a
 * retraction from the hold that keeps its restraint. The executor pages them (at most `FORGET_PAGE_DOCS`) and skips a
 * write already in place, so a page re-run after a lost lease writes the same thing.
 */
import type { Hasher } from "../ids";
import { rootKey } from "../ids";
import { maxSens } from "../lexicon";
import { buildSlice } from "../slices";
import type { ID, Ref, TS } from "../schema/primitives";
import type { Effect, Evidence, Memory, Moment, Session, Turn } from "../schema/records";
import { FIRST_PERSON } from "../writes/subject";
import { evidenceFieldText } from "../evidence";
import type { Stamps } from "./fence";
import { planWithdrawal } from "./withdraw";

export type ClosureWrite =
  | { collection: "memories"; id: ID; doc: Memory }
  | { collection: "effects"; id: ID; doc: Effect }
  | { collection: "moments"; id: ID; doc: Moment }
  | { collection: "evidence"; id: ID; doc: Evidence }
  | { collection: "turns"; id: ID; sessionId: ID; doc: Turn }
  | { collection: "sessions"; id: ID; doc: Session };

export interface ClosureGroup {
  /** 1: withdrawals and clearing; 2: restamps. A page holds one order. */
  order: 1 | 2;
  writes: ClosureWrite[];
}

export interface ClosureInput {
  opId: ID;
  /** The barrier's stamps. */
  stamps: Stamps;
  now: TS;
  hasher: Hasher;
  /** The resolve's exact targets (none when the scope is pending). */
  targetIds: readonly ID[];
  /** Evidence this op blocked: install's ranged Evidence and the request turns' Evidence. */
  blockedEids: readonly ID[];
  /** Root keys this op blocked. */
  blockedKeys: readonly ID[];
  /** Provider keys this op blocked, with the one revision each allows. */
  providerBlocks: readonly { providerKey: ID; allowedEvidenceId: ID | null }[];
  /** The request turns (dead), by Session. */
  requestTurns: readonly { sessionId: ID; id: ID }[];
  memories: readonly { id: ID; memory: Memory }[];
  evidence: readonly { id: ID; evidence: Evidence }[];
  effects: readonly { id: ID; effect: Effect }[];
  moments: readonly { id: ID; moment: Moment }[];
  turns: readonly { sessionId: ID; id: ID; turn: Turn }[];
  sessions: readonly { id: ID; session: Session }[];
}

export interface ClosurePlan {
  groups: ClosureGroup[];
  /** Every Memory the walk reached, targets included. */
  derivativeIds: ID[];
  /** Derivatives that withdrew (not targets, not code survivors). */
  withdrawnIds: ID[];
  /** Derivatives kept by code (ruling 4). */
  survivorIds: ID[];
}

const MOMENT_DONE: readonly Moment["status"][] = ["delivered", "expired", "skipped", "cancelled"];
const SELF_WORDS: ReadonlySet<string> = new Set([...FIRST_PERSON, "my", "mine"]);
/** Value kinds code can verify on the text (ruling 4). Free text is never a code survivor. */
const TYPED_VALUES: readonly Memory["value"]["kind"][] = ["number", "boolean", "enum", "money"];

const depId = (d: string, prefix: "e" | "m"): string | null => (d.startsWith(`${prefix}:`) ? d.slice(2).split("@")[0]! : null);

/**
 * The re-anchored Memory when `m` is a typed value code can verify on a sanitized revision with an independent
 * subject (ruling 4), or null. Fails closed: one root slice, mapped whole into one kept piece of the sanitized text,
 * the same quote there, a first-person word in it for a `self` subject (no other subject is independent in the floor),
 * and no dependency but that Evidence.
 */
export function codeSurvivor(m: Memory, sanitizedOf: ReadonlyMap<ID, { eid: ID; evidence: Evidence }>, originals: ReadonlyMap<ID, Evidence>, i: Pick<ClosureInput, "stamps" | "now" | "hasher">): Memory | null {
  if (!TYPED_VALUES.includes(m.value.kind) || m.subjectId !== "self" || m.rootSlices.length !== 1) return null;
  const s = m.rootSlices[0]!;
  if (s.start === null || s.end === null) return null;
  if (m.dependsOn.some((d) => d !== `e:${s.eid}` && !d.startsWith(`e:${s.eid}@`)) || m.contextIds.length > 0 || m.hypothesis !== null) return null;
  const survivor = sanitizedOf.get(s.eid);
  const original = originals.get(s.eid);
  if (survivor === undefined || original === undefined) return null;
  const piece = survivor.evidence.sanitizeMap.find((p) => p.oldField === s.fieldPath && p.oldStart <= s.start! && s.end! <= p.oldEnd);
  if (piece === undefined) return null;
  const oldText = evidenceFieldText(original, s.fieldPath);
  const newText = evidenceFieldText(survivor.evidence, piece.newField);
  if (oldText === null || newText === null) return null;
  const start = piece.newStart + (s.start - piece.oldStart);
  const end = start + (s.end - s.start);
  const quote = oldText.slice(s.start, s.end);
  if (newText.slice(start, end) !== quote) return null;
  const words = quote.toLowerCase().replace(/’/g, "'").match(/[a-z']+/g) ?? [];
  if (!words.some((w) => SELF_WORDS.has(w))) return null;
  const slice = buildSlice({ eid: survivor.eid, fieldPath: piece.newField, fieldText: newText, start, end, class: s.class, sens: s.sens }, i.hasher);
  return {
    ...m,
    epoch: i.stamps.epoch,
    dirty: false,
    updatedAt: i.now,
    rootSlices: [slice],
    rootKeys: [rootKey(slice, i.hasher)],
    packetEids: [survivor.eid],
    dependsOn: [`e:${survivor.eid}`],
    supportingIds: [{ type: "evidence", id: survivor.eid, rev: survivor.evidence.rev }],
    contextIds: [],
  };
}

/** The Memories a forget reaches, from lineage alone (status is not read: a re-run walks the same set). */
export function walkDerivatives(i: Pick<ClosureInput, "targetIds" | "blockedEids" | "blockedKeys" | "memories">): Set<ID> {
  const gone = new Set<ID>(i.targetIds);
  const eids = new Set<ID>(i.blockedEids);
  const keys = new Set<ID>(i.blockedKeys);
  const dirty = new Set<ID>();
  for (const m of i.memories) if (gone.has(m.id) && m.memory.packetEids[0] !== undefined) dirty.add(m.memory.packetEids[0]);
  const memRef = (r: Ref) => r.type === "memory" && gone.has(r.id);
  for (let changed = true; changed; ) {
    changed = false;
    for (const { id, memory: m } of i.memories) {
      const packet = m.packetEids[0];
      if (!gone.has(id)) {
        const read =
          (packet !== undefined && dirty.has(packet)) ||
          m.packetEids.some((e) => eids.has(e)) ||
          m.rootKeys.some((k) => keys.has(k)) ||
          m.dependsOn.some((d) => {
            const e = depId(d, "e");
            const mm = depId(d, "m");
            return (e !== null && eids.has(e)) || (mm !== null && gone.has(mm));
          }) ||
          m.contextIds.some((r) => memRef(r as Ref)) ||
          m.supportingIds.some(memRef) ||
          (m.hypothesis?.premiseIds.some(memRef) ?? false);
        if (read) {
          gone.add(id);
          changed = true;
        }
      }
      if (gone.has(id) && packet !== undefined && !dirty.has(packet)) {
        dirty.add(packet);
        changed = true;
      }
    }
  }
  return gone;
}

export function planClosure(i: ClosureInput): ClosurePlan {
  const targets = new Set(i.targetIds);
  const derivative = walkDerivatives(i);
  const blockedEids = new Set(i.blockedEids);
  const originals = new Map(i.evidence.map((e) => [e.id, e.evidence] as const));
  const sanitizedOf = new Map<ID, { eid: ID; evidence: Evidence }>();
  for (const e of i.evidence) if (e.evidence.sanitizedFrom !== null && e.evidence.status === "retained" && blockedEids.has(e.evidence.sanitizedFrom)) sanitizedOf.set(e.evidence.sanitizedFrom, { eid: e.id, evidence: e.evidence });
  const order1: ClosureGroup[] = [];
  const order2: ClosureGroup[] = [];
  const withdrawnIds: ID[] = [];
  const survivorIds: ID[] = [];
  const topics = new Set<ID>();
  const holdIndex = new Map<ID, ClosureWrite & { collection: "effects" }>();

  for (const { id, memory } of [...i.memories].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (!derivative.has(id)) continue;
    for (const t of memory.topicIds) topics.add(t);
    if (targets.has(id)) continue;
    const kept = codeSurvivor(memory, sanitizedOf, originals, i);
    if (kept !== null) {
      survivorIds.push(id);
      order1.push({ order: 1, writes: [{ collection: "memories", id, doc: kept }] });
      continue;
    }
    withdrawnIds.push(id);
    const w = planWithdrawal({ opId: i.opId, stamps: i.stamps, now: i.now, withdrawn: { type: "memory", id, rev: memory.rev }, memory, effects: i.effects, hasher: i.hasher });
    const writes: ClosureWrite[] = [];
    if (w.memory !== null && w.memory.status !== memory.status) writes.push({ collection: "memories", id, doc: w.memory });
    for (const r of w.retracted) writes.push({ collection: "effects", id: r.id, doc: r.effect });
    for (const h of w.holds) {
      // Two withdrawn rows restraining the same thing share one hold, at the higher sensitivity (ruling F-11).
      const prior = holdIndex.get(h.id);
      if (prior !== undefined) {
        prior.doc = { ...prior.doc, minSens: maxSens(prior.doc.minSens, h.effect.minSens) };
        continue;
      }
      const write = { collection: "effects" as const, id: h.id, doc: h.effect };
      holdIndex.set(h.id, write);
      writes.push(write);
    }
    if (writes.length > 0) order1.push({ order: 1, writes });
  }

  // Moments of every derivative, targets included, are cancelled; the anchor stays as busy time (install's overlay).
  for (const { id, moment } of i.moments) {
    if (moment.memoryId === null || !derivative.has(moment.memoryId) || MOMENT_DONE.includes(moment.status)) continue;
    order1.push({ order: 1, writes: [{ collection: "moments", id, doc: { ...moment, status: "cancelled", cancelReason: "forgotten", leaseToken: null, leaseUntil: null, rendered: null, updatedAt: i.now } }] });
  }

  // The request turns' own Evidence is blocked (it never enters safe turns, spec §8 step 2).
  const requestIds = new Set(i.requestTurns.map((t) => `${t.sessionId}/${t.id}`));
  const requestEids = new Set<ID>();
  for (const t of i.turns) if (requestIds.has(`${t.sessionId}/${t.id}`) && t.turn.evidenceId !== null) requestEids.add(t.turn.evidenceId);
  for (const { id, evidence } of i.evidence) {
    if (!requestEids.has(id) || evidence.status !== "retained") continue;
    order1.push({ order: 1, writes: [{ collection: "evidence", id, doc: { ...evidence, status: "blocked", updatedAt: i.now } }] });
  }

  // Turns: a request turn keeps no Evidence; a turn whose Evidence this op blocked carries its sanitized revision.
  for (const { sessionId, id, turn } of i.turns) {
    if (turn.evidenceId === null) continue;
    let next: Turn | null = null;
    if (requestIds.has(`${sessionId}/${id}`)) next = { ...turn, evidenceId: null, updatedAt: i.now };
    else if (blockedEids.has(turn.evidenceId)) {
      const s = sanitizedOf.get(turn.evidenceId);
      const text = s === undefined ? null : evidenceFieldText(s.evidence, "text");
      next = { ...turn, evidenceId: s === undefined || text === null ? null : s.eid, text: s === undefined ? null : text, updatedAt: i.now };
    }
    if (next !== null) order1.push({ order: 1, writes: [{ collection: "turns", id, sessionId, doc: next }] });
  }

  // Opened topics and grants on a forgotten topic (registry openedTopics/grants R+D).
  if (topics.size > 0) {
    for (const { id, session } of i.sessions) {
      const opened = session.openedTopics.filter((o) => !topics.has(o.topicId));
      const granted = session.hiddenDisclosureGranted.filter((g) => !topics.has(g.topicId));
      if (opened.length === session.openedTopics.length && granted.length === session.hiddenDisclosureGranted.length) continue;
      order1.push({ order: 1, writes: [{ collection: "sessions", id, doc: { ...session, openedTopics: opened, hiddenDisclosureGranted: granted, updatedAt: i.now } }] });
    }
  }

  // Restamp every survivor below the barrier's epoch (ruling 1).
  const withdrawn = new Set(withdrawnIds);
  const reanchored = new Set(survivorIds);
  for (const { id, memory } of i.memories) {
    if ((derivative.has(id) && !reanchored.has(id)) || withdrawn.has(id) || reanchored.has(id)) continue;
    if (memory.epoch >= i.stamps.epoch && !memory.dirty) continue;
    if (memory.status === "blocked" || memory.status === "retracted") continue;
    order2.push({ order: 2, writes: [{ collection: "memories", id, doc: { ...memory, epoch: i.stamps.epoch, dirty: false, updatedAt: i.now } }] });
  }
  const deniedByProvider = (e: Evidence, id: ID) => e.providerKey !== null && i.providerBlocks.some((b) => b.providerKey === e.providerKey && b.allowedEvidenceId !== id);
  for (const { id, evidence } of i.evidence) {
    if (evidence.status !== "retained" || blockedEids.has(id) || requestEids.has(id) || deniedByProvider(evidence, id)) continue;
    if (evidence.epoch >= i.stamps.epoch && !evidence.dirty) continue;
    order2.push({ order: 2, writes: [{ collection: "evidence", id, doc: { ...evidence, epoch: i.stamps.epoch, dirty: false, updatedAt: i.now } }] });
  }

  return { groups: [...order1, ...order2], derivativeIds: [...derivative], withdrawnIds, survivorIds };
}

/** Pages of whole groups, at most `size` writes each (a group larger than `size` is a page alone), one order each. */
export function closurePages(groups: readonly ClosureGroup[], size: number): ClosureWrite[][] {
  const pages: ClosureWrite[][] = [];
  let page: ClosureWrite[] = [];
  let order: number | null = null;
  for (const g of groups) {
    if (page.length > 0 && (page.length + g.writes.length > size || order !== g.order)) {
      pages.push(page);
      page = [];
    }
    order = g.order;
    page.push(...g.writes);
  }
  if (page.length > 0) pages.push(page);
  return pages;
}
