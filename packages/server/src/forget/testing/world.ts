/**
 * A stored world for the forget properties of brief 047, built from `nrWorldArb` (core
 * `forget/testing/arb-no-resurrection.ts`): the turns, the mail, the Memories, effects and hard rule, a Session with
 * one registered call, and helpers to fence a forget and drive its job. Test-only; nothing here calls a model.
 */
import { type CoreEpoch, type CoreRules, type ID, type Job, type Memory, buildSlice, rootKey, tsFromMs } from "@franki/core";
import { NR_ALLERGY, type NrWorld, memoryText, sampleEffect, sampleEvidence, sampleMemory, sampleSession, testId, turnText } from "@franki/core/testing";
import { evidenceId } from "../../store/evidence";
import { paths } from "../../store/paths";
import type { StorePort } from "../../store/port";
import { commitUserTurnForTest, insertTurnForTest } from "../../testing/extract-fixtures";
import { type TestRig, patchRecord, testRig } from "../../testing/fakes";
import type { CallClosePort } from "../close-port";
import { type AdvanceResult, FORGET_RETRY_MS, advanceForget } from "../executor";
import { fenceForget } from "../fence";
import { fakeForgetResolve } from "../resolve-port";

export const WORLD_UID = "owner-1";
export const WORLD_SESSION = testId("nr-session");

export interface StoredWorld {
  rig: TestRig;
  w: NrWorld;
  memoryIds: ID[];
  turnEids: ID[];
  ruleIds: ID[];
  seq: number;
  /** Request food → the Memory the fake resolver names for it. */
  resolveFor: Map<string, ID>;
}

const UID = WORLD_UID;
const SESSION = WORLD_SESSION;

export const rootFoodOf = (w: NrWorld, i: number) => w.sentences[w.memories[i]!.sentence]!.food;

export async function storeWorld(w: NrWorld): Promise<StoredWorld> {
  const rig = testRig();
  const { store, clock, hasher } = rig.deps;
  const turnEids: ID[] = [];
  let seq = 0;
  for (let t = 0; t < w.turns.length; t++) {
    const text = turnText(w, t);
    rig.clock.advance(2_000);
    if (w.turns[t]!.mail) {
      const epoch = (await store.get<CoreEpoch>(UID, paths.core(UID, "epoch")))!.data;
      const logicalId = hasher.id(["nr-mail-logical", t]);
      const eid = evidenceId(logicalId, 1, hasher);
      const now = tsFromMs(clock.read().opsClock.now);
      const mail = sampleEvidence({
        uid: UID,
        epoch: epoch.epoch,
        policyRev: epoch.policyRev,
        createdAt: now,
        updatedAt: now,
        logicalId,
        kind: "message",
        source: "gmail",
        providerKey: hasher.id(["nr-mail-provider", t]),
        text: { kind: "inline", text },
        fieldSlices: [buildSlice({ eid, fieldPath: "text", fieldText: text, start: 0, end: text.length, class: "U", sens: "S0" }, hasher)],
        turnId: null,
        sessionId: null,
      });
      await store.transaction(UID, async (tx) => tx.create(paths.evidence(UID, eid), mail));
      turnEids.push(eid);
      continue;
    }
    const turnId = testId(`nr-turn-${t}`);
    const committed = await commitUserTurnForTest(store, UID, turnId, text, clock, hasher);
    seq += 1;
    await insertTurnForTest(store, UID, SESSION, turnId, { seq, evidenceId: committed.eid, text, parseState: "committed", itemIds: [`item_${t}`], committedAt: tsFromMs(clock.read().opsClock.now) });
    turnEids.push(committed.eid);
  }
  const epoch = (await store.get<CoreEpoch>(UID, paths.core(UID, "epoch")))!.data;
  const stamp = { epoch: epoch.epoch, policyRev: epoch.policyRev };
  const memoryIds = w.memories.map((_, i) => hasher.id(["nr-memory", i]));
  for (let i = 0; i < w.memories.length; i++) {
    const m = w.memories[i]!;
    const eid = turnEids[m.turn]!;
    const text = turnText(w, m.turn);
    const sentence = w.sentences[m.sentence]!.text;
    const start = text.indexOf(sentence);
    const slice = buildSlice({ eid, fieldPath: "text", fieldText: text, start, end: start + sentence.length, class: "U", sens: "S0" }, hasher);
    const memory: Memory = sampleMemory({
      uid: UID,
      ...stamp,
      logicalId: hasher.id(["nr-logical", i]),
      key: hasher.id(["nr-key", i]),
      value: { kind: "text", text: memoryText(w, i) },
      rootSlices: [slice],
      rootKeys: [rootKey(slice, hasher)],
      packetEids: [eid],
      contextIds: m.context === null ? [] : [{ type: "memory", id: memoryIds[m.context]!, rev: 1 }],
      dependsOn: [`e:${eid}`, ...(m.parent === null ? [] : [`m:${memoryIds[m.parent]!}`])],
      supportingIds: [{ type: "evidence", id: eid, rev: 1 }],
      entityIds: [testId(`nr-person-${i}`)],
    });
    await store.transaction(UID, async (tx) => tx.create(paths.memory(UID, memoryIds[i]!), memory));
  }
  for (let k = 0; k < w.effects.length; k++) {
    const e = w.effects[k]!;
    const effect = sampleEffect({
      uid: UID,
      ...stamp,
      kind: e.kind,
      premiseIds: [{ type: "memory", id: memoryIds[e.premise]!, rev: 1 }],
      target: { type: "memory", id: memoryIds[e.target]!, rev: 1 },
      minSens: k % 2 === 0 ? "S1" : "S0",
    });
    await store.transaction(UID, async (tx) => tx.create(paths.effect(UID, hasher.id(["nr-effect", k])), effect));
  }
  const ruleIds: ID[] = [];
  const allergyTurn = w.turns.findIndex((t) => t.allergy);
  if (allergyTurn >= 0) {
    const eid = turnEids[allergyTurn]!;
    const text = turnText(w, allergyTurn);
    const proof = buildSlice({ eid, fieldPath: "text", fieldText: text, start: 0, end: NR_ALLERGY.length, class: "U", sens: "S0" }, hasher);
    const rules = (await store.get<CoreRules>(UID, paths.core(UID, "rules")))!.data;
    const id = testId("nr-shellfish");
    ruleIds.push(id);
    await patchRecord<CoreRules>(store, UID, paths.core(UID, "rules"), {
      rulesRev: rules.rulesRev + 1,
      allergies: [
        {
          id,
          subjectId: "self",
          code: "shellfish",
          state: "active",
          anonymous: false,
          proof: { eid, fieldPath: "text", start: 0, end: NR_ALLERGY.length, quote: NR_ALLERGY },
          proofRev: 1,
          rootKeys: [rootKey(proof, hasher)],
          dependsOn: [`e:${eid}`],
        },
      ],
    });
  }
  await store.transaction(UID, async (tx) => tx.create(paths.session(UID, SESSION), sampleSession({ uid: UID, status: "active", registeredCallIds: ["rtc_1"], callId: "rtc_1" })));
  return { rig, w, memoryIds, turnEids, ruleIds, seq, resolveFor: new Map() };
}

/** "Forget what I said about <food>", as a request turn with its Evidence, fenced. */
export async function forgetMemory(s: StoredWorld, target: number, requestId: string) {
  const { store, clock, hasher } = s.rig.deps;
  const food = rootFoodOf(s.w, target);
  s.resolveFor.set(food, s.memoryIds[target]!);
  s.rig.clock.advance(2_000);
  const turnId = testId(`nr-request-${requestId}`);
  const text = `Forget what I said about ${food}.`;
  const committed = await commitUserTurnForTest(store, UID, turnId, text, clock, hasher);
  s.seq += 1;
  await insertTurnForTest(store, UID, SESSION, turnId, { seq: s.seq, evidenceId: committed.eid, text, parseState: "committed", itemIds: [`item_${requestId}`], committedAt: tsFromMs(clock.read().opsClock.now) });
  return fenceForget(store, UID, { sessionId: SESSION, requestId, requestTurnIds: [turnId] }, clock.read().opsClock.now, hasher);
}

export function worldResolver(s: StoredWorld) {
  return fakeForgetResolve((input) => {
    const id = [...s.resolveFor].find(([food]) => input.request.quote.includes(food))?.[1];
    return { resolution: id === undefined ? "none" : "exact", remove: [], candidateIds: id === undefined ? [] : [id], entityIds: [], topicKeys: [], needsMore: false, clarification: null };
  });
}

export async function forgetJobsOf(store: StorePort): Promise<{ id: ID; job: Job }[]> {
  const rows = await store.query<Job>(UID, { collection: paths.collection(UID, "jobs"), where: [], orderBy: { field: "__name__", dir: "asc" }, limit: 100 });
  return rows.filter((r) => r.data.kind === "forget").map((r) => ({ id: r.id as ID, job: r.data }));
}

/** One committed step of every live forget job; retries and waits move the clock on. */
export async function stepAll(s: StoredWorld, closer: CallClosePort): Promise<AdvanceResult[]> {
  const { store, hasher, clock } = s.rig.deps;
  const out: AdvanceResult[] = [];
  for (const j of await forgetJobsOf(store)) {
    if (j.job.payload.kind !== "forget" || j.job.payload.phase === "done" || j.job.status === "blocked" || j.job.status === "failed") continue;
    const r = await advanceForget({ store, hasher, resolver: worldResolver(s), closer }, UID, j.id, clock.read().opsClock.now, { maxSteps: 1 });
    if (r.kind === "retry" || r.kind === "waiting") s.rig.clock.advance(FORGET_RETRY_MS);
    out.push(r);
  }
  s.rig.clock.advance(1_000);
  return out;
}

/** True when every forget job is done. */
export async function allDone(store: StorePort): Promise<boolean> {
  return (await forgetJobsOf(store)).every((j) => j.job.payload.kind === "forget" && j.job.payload.phase === "done");
}

/** Every stored document of the owner, by path (turns included), for comparing two stores. */
export async function dumpStore(store: StorePort): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  const collections = ["evidence", "memories", "sessions", "jobs", "ledger", "core", "blocks", "overlays", "effects", "moments"] as const;
  for (const c of collections) {
    let after: string | null = null;
    for (;;) {
      const page: { id: string; data: Record<string, unknown> }[] = await store.query<Record<string, unknown>>(UID, {
        collection: paths.collection(UID, c),
        where: after === null ? [] : [{ field: "__name__", op: ">", value: after }],
        orderBy: { field: "__name__", dir: "asc" },
        limit: 100,
      });
      for (const d of page) out.set(`${c}/${d.id}`, d.data);
      if (page.length < 100) break;
      after = page[page.length - 1]!.id;
    }
  }
  const turns = await store.query<Record<string, unknown>>(UID, { collection: paths.turns(UID, SESSION), where: [], orderBy: { field: "seq", dir: "asc" }, limit: 100 });
  for (const t of turns) out.set(`turns/${t.id}`, t.data);
  return out;
}

/**
 * What must withdraw when `target` is forgotten, from the generated lineage alone (the same rule as the No
 * Resurrection oracle): the target, every output of a packet that read a forgotten input, the transitive walk over
 * `dependsOn` and context, and every Memory on the target's root sentence. Never calls the code under test.
 */
export function oracleDerivatives(w: NrWorld, target: number): Set<number> {
  const gone = new Set<number>([target]);
  const dirtyTurns = new Set<number>([w.memories[target]!.turn]);
  for (let changed = true; changed; ) {
    changed = false;
    w.memories.forEach((m, i) => {
      const read = dirtyTurns.has(m.turn) || (m.parent !== null && gone.has(m.parent)) || (m.context !== null && gone.has(m.context)) || m.sentence === w.memories[target]!.sentence;
      if (read && !gone.has(i)) {
        gone.add(i);
        changed = true;
      }
      if (gone.has(i) && !dirtyTurns.has(m.turn)) {
        dirtyTurns.add(m.turn);
        changed = true;
      }
    });
  }
  return gone;
}

/** A store whose every transaction after the first fails: a step's commit, and its settle, are lost with the lease. */
export function losingStore(inner: StorePort): StorePort {
  let n = 0;
  return {
    get: (uid, path) => inner.get(uid, path),
    query: (uid, spec) => inner.query(uid, spec),
    transaction: (uid, fn) => {
      n += 1;
      if (n === 1) return inner.transaction(uid, fn);
      return Promise.reject(new Error("lost lease: the worker died before its commit"));
    },
  };
}
