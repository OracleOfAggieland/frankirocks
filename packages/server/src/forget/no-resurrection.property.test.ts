// Feature: forget, part two (brief 047), the No Resurrection property (spec §13 line 361; spec §8). Under any
// interleaving of the forget job's steps with the events below, after a forget nothing a reader produces contains the
// target or a derivative of it, except what comes from a new statement by the owner; and survivors stay usable.
//
// The world is plain sentences (`forget/testing/arb-no-resurrection.ts`). Each sentence's food is its root marker and
// each Memory's place is that Memory's own marker. The oracle below is the test's own: it computes what must be gone
// from the generated lineage (the target, every output of a packet that read a forgotten input, the transitive walk
// over `dependsOn`, rows on the target's root), and never calls closure, `planWithdrawal` or `planInstall`. "Contains"
// is a whole-word search of every string a reader returns for the forgotten markers.
//
// Events interleaved with the job's steps (one committed step at a time): an extraction from a packet captured before
// the fence; a mail re-sync bringing back a blocked provider ID; a step whose commit is lost with its lease; a second
// forget (queued while a barrier is up); a clock advance (the fixture jump is refused while fenced); and a new
// statement by the owner about the same thing (writers wait, so it lands when no barrier is up).
//
// Readers, after every step. Those that check the barrier themselves (through `eligible`) run every time; those whose
// route refuses under a barrier run only when no barrier is up, as their route would:
//   every step: `eligible` over every Memory and Evidence (speech), `recallLines`, the Head (`buildHead`), the stored
//               bundle, the food tool's snapshot (`readFoodPrefs`), the hero's pattern (`heroOffer`).
//   no barrier: the memory screen (`getMemory` overview, item, why and lab), the turns a fresh call carries over
//               (`earlierSafeTurns`), the people list (`peopleRoster` over `readAllMemories`), and the turns resume
//               names for the fresh call (the job's stored carry list, once it exists).
// Not driven here: delivery's `chooseNow` (moments), whisper notes; see the lane report.
import {
  type CoreEpoch,
  type CoreRules,
  type Evidence,
  type ID,
  type Job,
  type Memory,
  buildSlice,
  docRef,
  eligible,
  idParts,
  peopleRoster,
  recallLines,
  rootKey,
  tsFromMs,
} from "@franki/core";
import { NR_ALLERGY, type NrWorld, describeWorld, memoryText, nrWorldArb, sampleEffect, sampleEvidence, sampleMemory, sampleSession, testId, turnText } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { readCoreDocs } from "../core-docs";
import { buildHead, foregroundEC, readAllMemories, snapshotFor, storeReader } from "../head-build";
import { ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { getMemory } from "../routes/memory";
import { planAdvance } from "../routes/seed-advance";
import { heroOffer } from "../routes/tool-food";
import { earlierSafeTurns } from "../routes/turn";
import { readFoodPrefs } from "../food/prefs-read";
import { evidenceId } from "../store/evidence";
import { paths } from "../store/paths";
import type { StorePort } from "../store/port";
import { commitUserTurnForTest, extractOutput, factItem, insertTurnForTest } from "../testing/extract-fixtures";
import { T0_MS, type TestRig, patchRecord, testRig } from "../testing/fakes";
import { runExtractJob } from "../worker/extract";
import { fakeCallClose } from "./close-port";
import { FORGET_LEASE_MS, FORGET_RETRY_MS, advanceForget, requeueExpiredForget } from "./executor";
import { fenceForget, forgetJobId } from "./fence";
import { fakeForgetResolve } from "./resolve-port";

const UID = "owner-1";
const SESSION = testId("nr-session");
const MAX_STEPS = 200;

interface Built {
  rig: TestRig;
  w: NrWorld;
  memoryIds: ID[];
  turnEids: ID[];
  extractJobs: ID[];
  mailEid: ID | null;
  mailKey: ID | null;
  ruleIds: ID[];
  seq: number;
}

const own = (w: NrWorld, i: number) => w.memories[i]!.place;
const rootFood = (w: NrWorld, i: number) => w.sentences[w.memories[i]!.sentence]!.food;
const personEntity = (i: number) => testId(`nr-person-${i}`);

/** The oracle: every Memory that must be gone after forgetting `target`, from the generated lineage alone. */
export function derivatives(w: NrWorld, target: number): Set<number> {
  const gone = new Set<number>([target]);
  const dirtyTurns = new Set<number>([w.memories[target]!.turn]);
  for (let changed = true; changed; ) {
    changed = false;
    w.memories.forEach((m, i) => {
      // An output of a packet that read a forgotten input (its own turn's packet, a context it read, a Memory it
      // depends on), and every Memory on the target's root sentence.
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

async function build(w: NrWorld): Promise<Built> {
  const rig = testRig();
  const { store, clock, hasher } = rig.deps;
  const turnEids: ID[] = [];
  const extractJobs: ID[] = [];
  let mailEid: ID | null = null;
  let mailKey: ID | null = null;
  let seq = 0;
  for (let t = 0; t < w.turns.length; t++) {
    const text = turnText(w, t);
    rig.clock.advance(2_000);
    if (w.turns[t]!.mail) {
      // A mail message (always the last "turn"): no Turn and no extract job here; a provider key a re-sync can bring back.
      const epoch = (await store.get<CoreEpoch>(UID, paths.core(UID, "epoch")))!.data;
      const logicalId = hasher.id(["nr-mail-logical", t]);
      const eid = evidenceId(logicalId, 1, hasher);
      const now = tsFromMs(clock.read().opsClock.now);
      mailEid = eid;
      mailKey = hasher.id(["nr-mail-provider", t]);
      const mail = sampleEvidence({
        uid: UID,
        epoch: epoch.epoch,
        policyRev: epoch.policyRev,
        createdAt: now,
        updatedAt: now,
        logicalId,
        kind: "message",
        source: "gmail",
        providerKey: mailKey,
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
    extractJobs.push(committed.jobId);
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
    const memory = sampleMemory({
      uid: UID,
      ...stamp,
      createdAt: tsFromMs(clock.read().opsClock.now),
      updatedAt: tsFromMs(clock.read().opsClock.now),
      logicalId: hasher.id(["nr-logical", i]),
      key: hasher.id(["nr-key", i]),
      value: { kind: "text", text: memoryText(w, i) },
      rootSlices: [slice],
      rootKeys: [rootKey(slice, hasher)],
      packetEids: [eid],
      contextIds: m.context === null ? [] : [{ type: "memory", id: memoryIds[m.context]!, rev: 1 }],
      dependsOn: [`e:${eid}`, ...(m.parent === null ? [] : [`m:${memoryIds[m.parent]!}`])],
      supportingIds: [{ type: "evidence", id: eid, rev: 1 }],
      entityIds: [personEntity(i)],
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
  return { rig, w, memoryIds, turnEids, extractJobs, mailEid, mailKey, ruleIds, seq };
}

/** Writes a request turn ("Forget what I said about <food>") with its Evidence, and fences it. */
async function requestForget(b: Built, food: string, requestId: string) {
  const { store, clock, hasher } = b.rig.deps;
  b.rig.clock.advance(2_000);
  const turnId = testId(`nr-request-${requestId}`);
  const text = `Forget what I said about ${food}.`;
  const committed = await commitUserTurnForTest(store, UID, turnId, text, clock, hasher);
  const epoch = (await store.get<CoreEpoch>(UID, paths.core(UID, "epoch")))!.data;
  await patchRecord<Evidence>(store, UID, paths.evidence(UID, committed.eid), { epoch: epoch.epoch, policyRev: epoch.policyRev });
  b.seq += 1;
  await insertTurnForTest(store, UID, SESSION, turnId, { seq: b.seq, evidenceId: committed.eid, text, parseState: "committed", itemIds: [`item_${requestId}`], committedAt: tsFromMs(clock.read().opsClock.now) });
  return fenceForget(store, UID, { sessionId: SESSION, requestId, requestTurnIds: [turnId] }, clock.read().opsClock.now, hasher);
}

/** The owner's new statement about the target's subject: its own turn, Evidence and roots, at the current epoch. */
async function newStatement(b: Built, target: number): Promise<ID> {
  const { store, clock, hasher } = b.rig.deps;
  b.rig.clock.advance(2_000);
  const { person, food, place } = b.w.fresh;
  const text = `${person} loves ${food}.`;
  const turnId = testId("nr-new-statement");
  const now = tsFromMs(clock.read().opsClock.now);
  const epoch = (await store.get<CoreEpoch>(UID, paths.core(UID, "epoch")))!.data;
  const stamp = { epoch: epoch.epoch, policyRev: epoch.policyRev, createdAt: now, updatedAt: now };
  const logicalId = hasher.id(idParts.evidenceLogical(turnId));
  const eid = evidenceId(logicalId, 1, hasher);
  const slice = buildSlice({ eid, fieldPath: "text", fieldText: text, start: 0, end: text.length, class: "U", sens: "S0" }, hasher);
  const evidence = sampleEvidence({ uid: UID, ...stamp, logicalId, text: { kind: "inline", text }, fieldSlices: [slice], turnId, sessionId: SESSION });
  const old = (await store.get<Memory>(UID, paths.memory(UID, b.memoryIds[target]!)))!.data;
  // About the same thing: the target's subject, predicate and slot key, on new roots.
  const memory = sampleMemory({
    uid: UID,
    ...stamp,
    logicalId: hasher.id(["nr-logical", "fresh"]),
    key: old.key,
    subjectId: old.subjectId,
    predicate: old.predicate,
    value: { kind: "text", text: `${person} likes ${food} at the ${place}` },
    rootSlices: [slice],
    rootKeys: [rootKey(slice, hasher)],
    packetEids: [eid],
    dependsOn: [`e:${eid}`],
    supportingIds: [{ type: "evidence", id: eid, rev: 1 }],
    entityIds: [testId("nr-person-fresh")],
  });
  const id = hasher.id(["nr-memory", "fresh"]);
  b.seq += 1;
  const seq = b.seq;
  await store.transaction(UID, async (tx) => {
    tx.create(paths.evidence(UID, eid), evidence);
    tx.create(paths.memory(UID, id), memory);
  });
  await insertTurnForTest(store, UID, SESSION, turnId, { seq, evidenceId: eid, text, parseState: "committed", itemIds: ["item_fresh"], committedAt: now });
  return id;
}

/** A store whose every transaction after the first fails: the step's commit and the settle are lost with the lease. */
function losingStore(inner: StorePort): StorePort {
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

interface Reading {
  reader: string;
  text: string;
}

const stringify = (v: unknown) => JSON.stringify(v) ?? "";

/** Every string the readers return now. */
async function readAll(b: Built, carry: ID[]): Promise<Reading[]> {
  const { store, clock } = b.rig.deps;
  const reader = storeReader(store, UID);
  const core = await readCoreDocs(reader, UID);
  const epoch = core.epoch.data;
  const pair = clock.read();
  const out: Reading[] = [];
  const memories = await readAllMemories(reader, UID);
  const snapshot = await snapshotFor(reader, UID, memories, epoch, 1);
  const ec = { ...foregroundEC(UID, epoch, pair, 1), stage: "speech" as const };
  const evidence = (await store.query<Evidence>(UID, { collection: paths.collection(UID, "evidence"), where: [], orderBy: { field: "__name__", dir: "asc" }, limit: 100 })).map((d) => ({ id: d.id, data: d.data }));
  // eligible, directly.
  for (const m of memories) if (eligible({ ref: docRef("memories", m.id, m.memory.rev), row: m.memory }, ec, snapshot).allow) out.push({ reader: `eligible(memory ${m.id})`, text: stringify(m.memory) });
  for (const e of evidence) if (eligible({ ref: docRef("evidence", e.id, e.data.rev), row: e.data }, ec, snapshot).allow) out.push({ reader: `eligible(evidence ${e.id})`, text: stringify(e.data) });
  // recall.
  const byEid = new Map(evidence.map((e) => [e.id, e.data] as const));
  out.push({ reader: "recallLines", text: stringify(recallLines(memories, foregroundEC(UID, epoch, pair, 1), snapshot, byEid).lines) });
  // the Head and the stored bundle.
  out.push({ reader: "buildHead", text: stringify(await buildHead(reader, UID, { epoch, rules: core.rules.data }, pair, 1)) });
  out.push({ reader: "core/bundle", text: stringify(core.bundle.data.head) });
  // the food tool's snapshot.
  out.push({ reader: "readFoodPrefs", text: stringify(await readFoodPrefs(reader, UID, clock, 1, "what should I eat", []).catch((e: unknown) => ({ error: String(e) }))) });
  const ctx = { uid: UID, deps: b.rig.deps, schedule: b.rig.sched.schedule };
  out.push({ reader: "heroOffer", text: stringify(await heroOffer(ctx, 0).catch(() => null)) });
  if (epoch.barrier === null) {
    for (const view of ["overview", "lab"] as const) out.push({ reader: `getMemory(${view})`, text: stringify(await getMemory(ctx, { view, id: null, cursor: null } as never)) });
    for (const m of memories) {
      for (const view of ["item", "why"] as const) {
        const r = await getMemory(ctx, { view, id: m.id, cursor: null } as never).catch(() => null);
        out.push({ reader: `getMemory(${view} ${m.id})`, text: stringify(r) });
      }
    }
    out.push({ reader: "earlierSafeTurns", text: stringify(await earlierSafeTurns(reader, UID, SESSION, b.seq + 1, ctx)) });
    out.push({ reader: "peopleRoster", text: stringify([...peopleRoster(memories).roles.keys()]) });
    for (const id of carry) {
      const turn = await store.get(UID, paths.turn(UID, SESSION, id));
      out.push({ reader: `carried turn ${id}`, text: stringify(turn?.data ?? null) });
    }
  }
  return out;
}

const word = (w: string) => new RegExp(`\\b${w}\\b`, "i");

async function forgetJobs(store: StorePort): Promise<{ id: ID; job: Job }[]> {
  const rows = await store.query<Job>(UID, { collection: paths.collection(UID, "jobs"), where: [], orderBy: { field: "__name__", dir: "asc" }, limit: 100 });
  return rows.filter((r) => r.data.kind === "forget").map((r) => ({ id: r.id as ID, job: r.data }));
}

async function run(w: NrWorld): Promise<void> {
  const b = await build(w);
  const { store, hasher, clock } = b.rig.deps;
  const why = describeWorld(w);
  const resolveFor = new Map<string, ID>();
  const resolver = fakeForgetResolve((input) => {
    const id = [...resolveFor].find(([food]) => input.request.quote.includes(food))?.[1];
    return { resolution: id === undefined ? "none" : "exact", remove: [], candidateIds: id === undefined ? [] : [id], entityIds: [], topicKeys: [], needsMore: false, clarification: null };
  });
  const closer = fakeCallClose(() => "closed");
  const deps = { store, hasher, resolver, closer };

  // What must be gone, by the oracle, and the words that would show it.
  const gone = new Set<number>();
  const forgotten = new Set<string>();
  const forgetOp = (target: number) => {
    resolveFor.set(rootFood(w, target), b.memoryIds[target]!);
    forgotten.add(rootFood(w, target));
    for (const i of derivatives(w, target)) {
      gone.add(i);
      forgotten.add(own(w, i));
      forgotten.add(personEntity(i));
    }
  };
  forgetOp(w.target);
  const first = await requestForget(b, rootFood(w, w.target), "nr-1");
  expect(first.kind).toBe("fenced");

  let freshId: ID | null = null;
  let freshPending = false;
  let forgot2 = false;
  let resyncs = 0;
  const events = [...w.events];
  const fire = async (at: number) => {
    while (events.length > 0 && events[0]!.at <= at) {
      const e = events.shift()!.event;
      const epoch = (await store.get<CoreEpoch>(UID, paths.core(UID, "epoch")))!.data;
      if (e === "extract") {
        // A packet captured before the fence commits now: it names the turn's first sentence.
        const t = w.extractPick % b.extractJobs.length;
        const text = turnText(w, t);
        const end = text.indexOf(".") + 1;
        const eid = b.turnEids[t]!;
        b.rig.openai.script("responses.create", ok(completed(JSON.stringify(extractOutput([factItem("statement", "new", text.slice(0, end), [{ eid, fieldPath: "text", start: 0, end, quote: text.slice(0, end) }])])))));
        await runExtractJob(UID, b.extractJobs[t]!, b.rig.deps);
      } else if (e === "resync" && b.mailEid !== null) {
        // The mail comes back from the provider with the same provider ID, as a new Evidence at the current epoch.
        const mail = (await store.get<Evidence>(UID, paths.evidence(UID, b.mailEid)))!.data;
        const original = turnText(w, w.turns.findIndex((t) => t.mail));
        resyncs += 1;
        const id = hasher.id(["nr-resync", resyncs]);
        const now = tsFromMs(clock.read().opsClock.now);
        await store.transaction(UID, async (tx) =>
          tx.create(paths.evidence(UID, id), { ...mail, epoch: epoch.epoch, policyRev: epoch.policyRev, status: "retained", logicalId: hasher.id(["nr-resync-logical", id]), text: { kind: "inline", text: original }, fieldSlices: [buildSlice({ eid: id, fieldPath: "text", fieldText: original, start: 0, end: original.length, class: "U", sens: "S0" }, hasher)], providerKey: b.mailKey, sanitizedFrom: null, revisionOf: null, sanitizeMap: [], purgedAt: null, createdAt: now, updatedAt: now }),
        );
      } else if (e === "lostLease") {
        for (const j of await forgetJobs(store)) {
          if (j.job.payload.kind !== "forget" || j.job.payload.phase === "done") continue;
          await advanceForget({ ...deps, store: losingStore(store) }, UID, j.id, clock.read().opsClock.now, { maxSteps: 1 }).catch(() => null);
          b.rig.clock.advance(FORGET_LEASE_MS + 1);
          await requeueExpiredForget(store, UID, j.id, clock.read().opsClock.now);
          break;
        }
      } else if (e === "forget2" && !forgot2) {
        forgot2 = true;
        const free = w.memories.map((_, i) => i).filter((i) => !gone.has(i));
        if (free.length > 0) {
          const t2 = free[w.secondPick % free.length]!;
          forgetOp(t2);
          const second = await requestForget(b, rootFood(w, t2), "nr-2");
          expect(["fenced", "queued"]).toContain(second.kind);
        }
      } else if (e === "clock") {
        if (epoch.barrier !== null) {
          const core = await readCoreDocs(storeReader(store, UID), UID);
          expect(planAdvance({ epoch: core.epoch.data, state: core.state.data }, testId("nr-ns"), clock.read().worldClock.now + 86_400_000)).toEqual({ ok: false, error: "BARRIER" });
        }
        b.rig.clock.advance(60_000);
      } else if (e === "newStatement") {
        freshPending = true;
      }
    }
    if (freshPending && freshId === null) {
      const epoch = (await store.get<CoreEpoch>(UID, paths.core(UID, "epoch")))!.data;
      if (epoch.barrier === null) freshId = await newStatement(b, w.target);
    }
  };

  const check = async (when: string) => {
    const jobs = await forgetJobs(store);
    const carry = jobs.flatMap((j) => ((j.job.payload as { carryTurnIds?: ID[] }).carryTurnIds ?? []) as ID[]);
    for (const r of await readAll(b, carry)) {
      for (const f of forgotten) {
        if (word(f).test(r.text)) expect.fail(`${when}: "${f}" came back through ${r.reader}\n${why}\n--- output ---\n${r.text.slice(0, 600)}`);
      }
    }
  };

  let step = 0;
  for (; step < MAX_STEPS; step++) {
    await fire(step);
    const jobs = await forgetJobs(store);
    const live = jobs.filter((j) => j.job.payload.kind === "forget" && j.job.payload.phase !== "done" && j.job.status !== "blocked" && j.job.status !== "failed");
    if (live.length === 0 && events.length === 0) break;
    for (const j of live) {
      const r = await advanceForget(deps, UID, j.id, clock.read().opsClock.now, { maxSteps: 1 });
      if (r.kind === "retry" || r.kind === "waiting") b.rig.clock.advance(FORGET_RETRY_MS);
      if (r.kind === "blocked") expect.fail(`the forget job blocked (${r.reason})\n${why}`);
    }
    b.rig.clock.advance(1_000);
    await check(`after step ${step}`);
  }
  await fire(Number.MAX_SAFE_INTEGER);
  await check("at the end");

  // Every forget completed.
  const jobs = await forgetJobs(store);
  for (const j of jobs) expect(j.job.payload.kind === "forget" && j.job.payload.phase, `job ${j.id}\n${why}`).toBe("done");
  expect(jobs.map((j) => j.id)).toContain(forgetJobId(first.kind === "refused" ? "" : first.opId, hasher));
  const epoch = (await store.get<CoreEpoch>(UID, paths.core(UID, "epoch")))!.data;
  expect(epoch.barrier, why).toBeNull();

  // Survivors: every Memory the oracle leaves alone, and the new statement, are allowed in a fresh context.
  const reader = storeReader(store, UID);
  const memories = await readAllMemories(reader, UID);
  const snapshot = await snapshotFor(reader, UID, memories, epoch, 1);
  const ec = { ...foregroundEC(UID, epoch, clock.read(), 1), stage: "read" as const };
  for (let i = 0; i < w.memories.length; i++) {
    if (gone.has(i)) continue;
    const m = memories.find((x) => x.id === b.memoryIds[i])!;
    expect(eligible({ ref: docRef("memories", m.id, m.memory.rev), row: m.memory }, ec, snapshot), `survivor memory ${i} ("${memoryText(w, i)}")\n${why}`).toEqual({ allow: true, reason: "ok" });
  }
  if (freshId !== null) {
    const m = memories.find((x) => x.id === freshId)!;
    expect(eligible({ ref: docRef("memories", m.id, m.memory.rev), row: m.memory }, ec, snapshot), `the new statement\n${why}`).toEqual({ allow: true, reason: "ok" });
    const head = stringify(await buildHead(reader, UID, { epoch, rules: (await readCoreDocs(reader, UID)).rules.data }, clock.read(), 1));
    expect(word(w.fresh.place).test(head), `the new statement is in the Head\n${why}`).toBe(true);
  }
  // Every committed hard rule is still in core/rules, active or pending.
  const rules = (await store.get<CoreRules>(UID, paths.core(UID, "rules")))!.data;
  for (const id of b.ruleIds) expect(rules.allergies.find((r) => r.id === id)?.state, `rule ${id}\n${why}`).toMatch(/^(active|pending)$/);
}

describe("No Resurrection (spec line 361; brief 047)", () => {
  it("after any interleaving, nothing a reader returns contains a forgotten root or derivative, and survivors stay usable", async () => {
    await fc.assert(fc.asyncProperty(nrWorldArb, async (w) => run(w)), { numRuns: 1000 });
  }, 1_200_000);
});
