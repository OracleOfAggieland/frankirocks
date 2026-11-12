/**
 * Install, pure and paged (spec §8 step 5; contracts §8 step 5; registry `forget` column). Writes, in order:
 *   1. root, semantic and provider blocks, and overlays (redact for removed ranges, withhold for a forgotten
 *      Memory's anchor: busy only, no moments, sensitivity never lower);
 *   2. the named Memories to `blocked`, and effects premised on them to `retracted`;
 *   3. sanitized Evidence revisions (new eid), the old Evidence to `blocked`, and `core/rules` with every affected
 *      rule re-anchored or pending.
 * A rule is never removed. Restraint that was not the target is not touched. With an uncommitted non-request turn
 * at the fence and no salvage in the floor, `noneConfirmed` is cleared (spec line 273).
 */
import { evidenceFieldText } from "../evidence";
import type { Hasher } from "../ids";
import { maxSens } from "../lexicon";
import { buildSlice } from "../slices";
import type { FP, ID, Ref, SC, Sens, Slice, Span, TS } from "../schema/primitives";
import type { Block, CoreRules, Effect, Evidence, Memory, Overlay } from "../schema/records";
import type { Stamps } from "./fence";
import { type RosterEntry, reanchorRule } from "./reanchor";
import { type TextRange, sanitizeText } from "./sanitize";

/** Contracts §8: a page holds at most 50 documents. */
export const FORGET_PAGE_DOCS = 50;

export interface InstallInput {
  uid: string;
  opId: ID;
  /** The barrier's stamps (the epoch and policyRev the fence raised to). */
  stamps: Stamps;
  now: TS;
  /** Memories the resolve named exactly. */
  targets: readonly { id: ID; memory: Memory }[];
  /** Candidates held for an ask (scopePending): review-blocked, nothing removed. */
  review: readonly { id: ID; memory: Memory }[];
  /** Verified ranges the resolve named for removal. */
  remove: readonly Span[];
  /** Every Evidence a target root or a removed range names. */
  evidence: ReadonlyMap<ID, Evidence>;
  /** Effects in the store (all states). */
  effects: readonly { id: ID; effect: Effect }[];
  rules: CoreRules;
  roster: readonly RosterEntry[];
  /** A non-request turn of the Session was still uncommitted at the fence. */
  uncommittedAtFence: boolean;
  hasher: Hasher;
}

export type InstallWrite =
  | { order: 1; collection: "blocks"; id: ID; doc: Block }
  | { order: 1; collection: "overlays"; id: ID; doc: Overlay }
  | { order: 2; collection: "memories"; id: ID; doc: Memory }
  | { order: 2; collection: "effects"; id: ID; doc: Effect }
  | { order: 3; collection: "evidence"; id: ID; doc: Evidence }
  | { order: 3; collection: "core"; id: "rules"; doc: CoreRules };

export interface InstallPlan {
  writes: InstallWrite[];
  retainedRuleIds: ID[];
  pendingRuleIds: ID[];
  sanitizedEids: ID[];
  blockedKeys: ID[];
  touched: { collection: SC; count: number }[];
}

const CONTENT_FIELDS = ["body", "bodyOwn", "bodyQuoted", "description", "text"] as const;
const STRING_FIELDS = ["subject", "title", "sender"] as const;
/** Contracts §1: a sanitize map holds at most 128 entries. */
const SANITIZE_MAP_MAX = 128;

/** Common fields for a row this forget writes: the barrier's stamps, empty lineage. */
function fresh(uid: string, stamps: Stamps, now: TS) {
  return {
    v: 1 as const,
    uid,
    rev: 1,
    createdAt: now,
    updatedAt: now,
    epoch: stamps.epoch,
    policyRev: stamps.policyRev,
    rootKeys: [] as ID[],
    rootSlices: [] as Slice[],
    contextIds: [] as Ref[],
    packetEids: [] as ID[],
    dependsOn: [] as string[],
    dirty: false,
    dependenciesComplete: true,
  };
}

function block(i: InstallInput, kind: Block["kind"], key: ID, state: Block["state"], fields: Partial<Block>): Block {
  return {
    ...fresh(i.uid, i.stamps, i.now),
    kind,
    state,
    opId: i.opId,
    key,
    boundaryMode: null,
    rootKey: null,
    providerKey: null,
    entityId: null,
    predicate: null,
    topicId: null,
    claimSimHash: null,
    allowedEvidenceId: null,
    createdFrom: null,
    reviewAt: null,
    ...fields,
  };
}

function withField(e: Evidence, field: FP, text: string): Evidence | null {
  if ((CONTENT_FIELDS as readonly string[]).includes(field)) return { ...e, [field]: { kind: "inline", text } } as Evidence;
  if ((STRING_FIELDS as readonly string[]).includes(field)) return { ...e, [field]: text } as Evidence;
  return null;
}

/** The sanitized revision of one Evidence, or null when a field cannot be rewritten in code (fail closed: blocked whole). */
function sanitizeEvidence(i: InstallInput, oldEid: ID, e: Evidence, ranges: ReadonlyMap<FP, TextRange[]>, newEid: ID): Evidence | null {
  let next: Evidence = e;
  const map: Evidence["sanitizeMap"] = [];
  let slices = e.fieldSlices;
  for (const [field, removed] of ranges) {
    const text = evidenceFieldText(e, field);
    if (text === null) return null;
    const ruleSpans = i.rules.allergies
      .filter((r) => r.state === "active" && r.proof !== null && r.proof.eid === oldEid && r.proof.fieldPath === field && text.slice(r.proof.start, r.proof.end) === r.proof.quote)
      .map((r) => ({ start: r.proof!.start, end: r.proof!.end }));
    const out = sanitizeText(text, removed, ruleSpans);
    const updated = withField(next, field, out.text);
    if (updated === null) return null;
    next = updated;
    for (const p of out.pieces) map.push({ oldField: field, oldStart: p.oldStart, oldEnd: p.oldEnd, newField: field, newStart: p.newStart, newEnd: p.newEnd });
    const old = slices.filter((s) => s.fieldPath === field);
    const classes = new Set(old.map((s) => s.class));
    const cls = classes.size === 1 ? [...classes][0]! : "M";
    const sens = old.reduce<Sens>((acc, s) => maxSens(acc, s.sens), "S0");
    slices = [...slices.filter((s) => s.fieldPath !== field), buildSlice({ eid: newEid, fieldPath: field, fieldText: out.text, start: 0, end: out.text.length, class: cls, sens }, i.hasher)];
  }
  if (map.length > SANITIZE_MAP_MAX) return null;
  return {
    ...next,
    ...fresh(i.uid, i.stamps, i.now),
    revisionOf: oldEid,
    sanitizedFrom: oldEid,
    providerKey: e.providerKey === null ? null : i.hasher.id(["localProvider", newEid]),
    status: "retained",
    fieldSlices: slices.map((s) => ({ ...s, eid: newEid })),
    sanitizeMap: map,
    purgedAt: null,
  };
}

const premisedOn = (e: Effect, ids: ReadonlySet<string>) => e.premiseIds.some((p) => p.type === "memory" && ids.has(p.id));

/** The ID of the redact overlay for one removed range; resolve writes it first, install completes it. */
export function redactOverlayId(hasher: Hasher, opId: ID, eid: ID, field: FP, r: TextRange): ID {
  return hasher.id(["overlay", opId, "redact", eid, field, r.start, r.end]);
}

export function planInstall(i: InstallInput): InstallPlan {
  const blocks = new Map<ID, Block>();
  const overlays = new Map<ID, Overlay>();
  const order2: InstallWrite[] = [];
  const order3: InstallWrite[] = [];
  const blockedKeys: ID[] = [];

  const rootBlock = (key: ID, state: Block["state"], from: Ref) => {
    const id = i.hasher.id(["block", i.opId, "root", key]);
    const prior = blocks.get(id);
    if (prior !== undefined && (prior.state === "active" || state === "review")) return;
    blocks.set(id, block(i, "root", key, state, { rootKey: key, createdFrom: from }));
    if (!blockedKeys.includes(key)) blockedKeys.push(key);
  };

  // 1. Blocks and overlays.
  for (const t of i.targets) {
    const from: Ref = { type: "memory", id: t.id, rev: t.memory.rev };
    for (const key of t.memory.rootKeys) rootBlock(key, "active", from);
    const sid = i.hasher.id(["block", i.opId, "semantic", t.memory.key]);
    blocks.set(sid, block(i, "semantic", t.memory.key, "active", { entityId: t.memory.subjectId, predicate: t.memory.predicate, createdFrom: from }));
    if (t.memory.anchorId !== null) {
      const oid = i.hasher.id(["overlay", i.opId, "withhold", t.memory.anchorId]);
      overlays.set(oid, {
        ...fresh(i.uid, i.stamps, i.now),
        opId: i.opId,
        verb: "withhold",
        targetRef: { type: "anchor", id: t.memory.anchorId, rev: 1 },
        fieldPath: null,
        start: null,
        end: null,
        replacementRef: null,
        sanitizedEid: null,
        state: "active",
        minSens: t.memory.sens,
      });
    }
  }
  for (const r of i.review) for (const key of r.memory.rootKeys) rootBlock(key, "review", { type: "memory", id: r.id, rev: r.memory.rev });

  // Ranges to remove, by Evidence and field: the named spans and every target root.
  const ranges = new Map<ID, Map<FP, TextRange[]>>();
  const addRange = (eid: ID, field: FP, start: number, end: number) => {
    if (end <= start) return;
    let byField = ranges.get(eid);
    if (byField === undefined) {
      byField = new Map();
      ranges.set(eid, byField);
    }
    const list = byField.get(field) ?? [];
    list.push({ start, end });
    byField.set(field, list);
  };
  for (const s of i.remove) addRange(s.eid, s.fieldPath, s.start, s.end);
  for (const t of i.targets) for (const s of t.memory.rootSlices) if (s.start !== null && s.end !== null) addRange(s.eid, s.fieldPath, s.start, s.end);

  // 2. Named Memories blocked; effects premised on them retracted (target-premise effects, contracts §4).
  const targetIds = new Set(i.targets.map((t) => t.id));
  for (const t of i.targets) {
    if (t.memory.status !== "blocked") order2.push({ order: 2, collection: "memories", id: t.id, doc: { ...t.memory, status: "blocked", updatedAt: i.now } });
  }
  for (const { id, effect } of i.effects) {
    if (effect.state === "active" && premisedOn(effect, targetIds)) order2.push({ order: 2, collection: "effects", id, doc: { ...effect, state: "retracted", updatedAt: i.now } });
  }

  // 3. Sanitized revisions, the old Evidence blocked, and the rules.
  const survivors = new Map<ID, { eid: ID; evidence: Evidence } | null>();
  const sanitizedEids: ID[] = [];
  for (const [eid, byField] of [...ranges].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const e = i.evidence.get(eid);
    if (e === undefined || e.status !== "retained") continue;
    const newEid = i.hasher.id(["sanitized", i.opId, eid]);
    const next = sanitizeEvidence(i, eid, e, byField, newEid);
    if (next !== null) {
      order3.push({ order: 3, collection: "evidence", id: newEid, doc: next });
      sanitizedEids.push(newEid);
    }
    order3.push({ order: 3, collection: "evidence", id: eid, doc: { ...e, status: "blocked", updatedAt: i.now } });
    survivors.set(eid, next === null ? null : { eid: newEid, evidence: next });
    for (const [field, list] of byField) {
      for (const r of list) {
        const oid = redactOverlayId(i.hasher, i.opId, eid, field, r);
        overlays.set(oid, {
          ...fresh(i.uid, i.stamps, i.now),
          opId: i.opId,
          verb: "redact",
          targetRef: { type: "evidence", id: eid, rev: e.rev },
          fieldPath: field,
          start: r.start,
          end: r.end,
          replacementRef: next === null ? null : { type: "evidence", id: newEid, rev: 1 },
          sanitizedEid: next === null ? null : newEid,
          state: "active",
          minSens: e.fieldSlices.reduce<Sens>((acc, s) => maxSens(acc, s.sens), "S0"),
        });
      }
    }
    if (e.providerKey !== null) {
      const pid = i.hasher.id(["block", i.opId, "provider", e.providerKey]);
      blocks.set(
        pid,
        block(i, "provider", e.providerKey, "active", { providerKey: e.providerKey, allowedEvidenceId: next === null ? null : newEid, createdFrom: { type: "evidence", id: eid, rev: e.rev } }),
      );
    }
  }

  const retainedRuleIds: ID[] = [];
  const pendingRuleIds: ID[] = [];
  let rulesChanged = false;
  const allergies = i.rules.allergies.map((rule) => {
    const eids = [rule.proof?.eid, ...rule.dependsOn.map((d) => (d.startsWith("e:") ? d.slice(2).split("@")[0] : undefined))];
    const hit = eids.find((eid) => eid !== undefined && survivors.has(eid));
    if (hit === undefined) return rule;
    rulesChanged = true;
    retainedRuleIds.push(rule.id);
    const survivor = survivors.get(hit) ?? null;
    const r = reanchorRule(rule, survivor?.evidence.sanitizeMap ?? [], survivor, i.roster, i.hasher);
    if (r.rule.state === "pending") pendingRuleIds.push(rule.id);
    return r.rule;
  });
  const clearNone = i.uncommittedAtFence && i.rules.noneConfirmed.length > 0;
  if (rulesChanged || clearNone) {
    order3.push({
      order: 3,
      collection: "core",
      id: "rules",
      doc: { ...i.rules, allergies, noneConfirmed: clearNone ? [] : i.rules.noneConfirmed, rulesRev: i.rules.rulesRev + 1, updatedAt: i.now },
    });
  }

  const writes: InstallWrite[] = [
    ...[...blocks].map(([id, doc]): InstallWrite => ({ order: 1, collection: "blocks", id, doc })),
    ...[...overlays].map(([id, doc]): InstallWrite => ({ order: 1, collection: "overlays", id, doc })),
    ...order2,
    ...order3,
  ];
  const counts = new Map<SC, number>();
  for (const w of writes) counts.set(w.collection, (counts.get(w.collection) ?? 0) + 1);
  return {
    writes,
    retainedRuleIds,
    pendingRuleIds,
    sanitizedEids,
    blockedKeys,
    touched: [...counts].map(([collection, count]) => ({ collection, count })),
  };
}

export function installPages(writes: readonly InstallWrite[], size: number = FORGET_PAGE_DOCS): InstallWrite[][] {
  const pages: InstallWrite[][] = [];
  let page: InstallWrite[] = [];
  for (const w of writes) {
    if (page.length >= size || (page.length > 0 && page[0]!.order !== w.order)) {
      pages.push(page);
      page = [];
    }
    page.push(w);
  }
  if (page.length > 0) pages.push(page);
  return pages;
}
