// Feature: forget on the wire (brief 048), No Resurrection with Franki's replies in the world (brief 048 ruling 1;
// spec §13 line 361). The first property (`no-resurrection.property.test.ts`, not edited) has only the owner's words.
// This one adds what Franki said back: after every spoken turn an assistant turn, written through the receipt route
// (`/api/receipt`, kind `transcript`), that repeats the turn's root food; and for every Memory a delivered moment whose
// `rendered` line names the Memory's own place. Code cannot search Franki's free speech, so after a forget none of it
// may come back, whatever it says.
//
// The oracle is the first property's, from the generated lineage alone (`oracleDerivatives`), never the closure
// code. "Contains" is a whole-word search of every reader's output for the forgotten markers (root foods, the places
// of every derivative, their people).
//
// Readers, after every step (those whose route refuses under a barrier only when none is up):
//   every step: `eligible` over every Memory and Evidence, `recallLines`, `buildHead`, the stored bundle.
//   no barrier: the turns a fresh call carries over (`earlierSafeTurns`, the Deck's `turns`), the job's carried turns,
//               every stored moment's `rendered` line, delivery's `chooseNow` (its spoken line), the memory screen
//               (`getMemory` overview and lab).
// Interleaved with the job's steps: a step lost with its lease, a second forget that queues, and a new statement.
import { type CoreBundle, type CoreEpoch, type CoreRules, type Evidence, type ID, type Moment, type MomentPlan, type Session, docRef, eligible, momentRow, recallLines, tsFromMs } from "@franki/core";
import { type NrWorld, describeWorld, memoryText, nrWorldArb, testId } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { readCoreDocs } from "../core-docs";
import { currentStamp } from "../deck";
import { buildHead, foregroundEC, readAllMemories, snapshotFor, storeReader } from "../head-build";
import { getMemory } from "../routes/memory";
import { receiptRoute } from "../routes/receipt";
import { earlierSafeTurns } from "../routes/turn";
import { paths } from "../store/paths";
import { callRoute, patchRecord } from "../testing/fakes";
import { chooseNow } from "../time/proactive";
import { fakeCallClose } from "./close-port";
import { FORGET_LEASE_MS, advanceForget, requeueExpiredForget } from "./executor";
import { WORLD_SESSION, WORLD_UID, type StoredWorld, forgetJobsOf, forgetMemory, losingStore, oracleDerivatives, rootFoodOf, stepAll, storeWorld, worldResolver } from "./testing/world";

const UID = WORLD_UID;
const SESSION = WORLD_SESSION;
const MAX_STEPS = 200;
const RUNS = Number(process.env.NR_SPEECH_RUNS ?? 300);

const stringify = (v: unknown) => JSON.stringify(v) ?? "";
const word = (w: string) => new RegExp(`\\b${w}\\b`, "i");

/** What Franki says back to turn `t`: its first sentence's food, repeated (free speech, as the model would word it). */
export const replyText = (w: NrWorld, t: number): string => {
  const s = w.sentences[w.turns[t]!.sentences[0]!]!;
  return `Oh, ${s.food}! Tell me more about ${s.person}.`;
};

/** After every spoken turn, Franki's reply through the receipt route; then a delivered moment for every Memory. */
async function addSpeech(s: StoredWorld): Promise<void> {
  const { store, hasher, clock } = s.rig.deps;
  let seq = 0;
  for (let t = 0; t < s.w.turns.length; t++) {
    if (s.w.turns[t]!.mail) continue;
    seq += 1;
    s.rig.clock.advance(500);
    // The reply answers this turn: the receipt route gives it seq = nextClientSeq - 1.
    await patchRecord<Session>(store, UID, paths.session(UID, SESSION), { nextClientSeq: seq + 1, lastClientSeq: seq });
    const core = await readCoreDocs(storeReader(store, UID), UID);
    const session = (await store.get<Session>(UID, paths.session(UID, SESSION)))!.data;
    const stamp = { ...currentStamp(SESSION, session.generation, { epoch: core.epoch.data, rules: core.rules.data as CoreRules, bundle: core.bundle.data as CoreBundle }), turnId: testId(`nr-turn-${t}`) };
    const res = await callRoute(s.rig, receiptRoute, { requestId: testId(`nrs-rcpt-${t}`), stamp, responseId: `resp_${t}`, kind: "transcript", momentIds: [], noteIds: [], pendingId: null, permitKind: null, text: replyText(s.w, t) });
    expect(res.body).toEqual({ accepted: true, controlCheck: "none" });
  }
  await patchRecord<Session>(store, UID, paths.session(UID, SESSION), { nextClientSeq: s.seq + 1, lastClientSeq: s.seq });
  const epoch = (await store.get<CoreEpoch>(UID, paths.core(UID, "epoch")))!.data;
  const ops = clock.read().opsClock.now;
  for (let i = 0; i < s.w.memories.length; i++) {
    const id = hasher.id(["nrs-moment", i]);
    const plan: MomentPlan = {
      momentId: id,
      source: { kind: "memory", id: s.memoryIds[i]! },
      kind: "checkIn",
      occurrenceKey: "2026-11-13",
      scheduleRev: 0,
      dueAt: ops - 60_000,
      closeAt: ops + 86_400_000,
      domain: "relationship",
      subjectIds: ["self"],
      payload: { kind: "cue", noteRef: { type: "memory", id: s.memoryIds[i]!, rev: 1 }, template: null },
      noteRef: null,
      lineage: { rootKeys: [], rootSlices: [], dependsOn: [`m:${s.memoryIds[i]!}`] },
    };
    const row = momentRow(plan, { uid: UID, opsNow: ops, epoch: epoch.epoch, policyRev: epoch.policyRev, clockMode: "fixture" }, hasher);
    const said: Moment = { ...row, status: "delivered", admittedAt: tsFromMs(ops), saidAt: tsFromMs(ops), saidMatch: "idTagged", responseId: "resp_0", rendered: { noteId: hasher.id(["nrs-note", i]), text: `How was the ${s.w.memories[i]!.place}?`, tokens: [], at: tsFromMs(ops), sessionId: SESSION, pendingId: null } };
    await store.transaction(UID, async (tx) => tx.create(paths.moment(UID, id), said));
  }
}

interface Reading {
  reader: string;
  text: string;
}

async function readAll(s: StoredWorld, carry: ID[]): Promise<Reading[]> {
  const { store, clock } = s.rig.deps;
  const reader = storeReader(store, UID);
  const core = await readCoreDocs(reader, UID);
  const epoch = core.epoch.data;
  const pair = clock.read();
  const out: Reading[] = [];
  const memories = await readAllMemories(reader, UID);
  const snapshot = await snapshotFor(reader, UID, memories, epoch, 1);
  const ec = { ...foregroundEC(UID, epoch, pair, 1), stage: "speech" as const };
  const evidence = (await store.query<Evidence>(UID, { collection: paths.collection(UID, "evidence"), where: [], orderBy: { field: "__name__", dir: "asc" }, limit: 100 })).map((d) => ({ id: d.id, data: d.data }));
  for (const m of memories) if (eligible({ ref: docRef("memories", m.id, m.memory.rev), row: m.memory }, ec, snapshot).allow) out.push({ reader: `eligible(memory ${m.id})`, text: stringify(m.memory) });
  for (const e of evidence) if (eligible({ ref: docRef("evidence", e.id, e.data.rev), row: e.data }, ec, snapshot).allow) out.push({ reader: `eligible(evidence ${e.id})`, text: stringify(e.data) });
  out.push({ reader: "recallLines", text: stringify(recallLines(memories, foregroundEC(UID, epoch, pair, 1), snapshot, new Map(evidence.map((e) => [e.id, e.data] as const))).lines) });
  out.push({ reader: "buildHead", text: stringify(await buildHead(reader, UID, { epoch, rules: core.rules.data }, pair, 1)) });
  out.push({ reader: "core/bundle", text: stringify(core.bundle.data.head) });
  if (epoch.barrier === null) {
    const ctx = { uid: UID, deps: s.rig.deps, schedule: s.rig.sched.schedule };
    const session = (await store.get<Session>(UID, paths.session(UID, SESSION)))!.data;
    out.push({ reader: "earlierSafeTurns", text: stringify(await earlierSafeTurns(reader, UID, SESSION, session.nextClientSeq + 1, ctx)) });
    for (const id of carry) out.push({ reader: `carried turn ${id}`, text: stringify((await store.get(UID, paths.turn(UID, SESSION, id)))?.data ?? null) });
    const moments = await store.query<Moment>(UID, { collection: paths.collection(UID, "moments"), where: [], orderBy: { field: "__name__", dir: "asc" }, limit: 100 });
    for (const m of moments) out.push({ reader: `moment ${m.id} rendered`, text: stringify(m.data.rendered) });
    const chosen = await chooseNow(ctx, { kind: "opening" }, { transition: false, crisis: false, turnsSinceCheckInAnswer: null }).catch(() => null);
    out.push({ reader: "chooseNow", text: stringify(chosen?.choice.spoken ?? null) });
    for (const view of ["overview", "lab"] as const) out.push({ reader: `getMemory(${view})`, text: stringify(await getMemory(ctx, { view, id: null, cursor: null } as never)) });
  }
  return out;
}

async function run(w: NrWorld): Promise<void> {
  const s = await storeWorld(w);
  await addSpeech(s);
  const { store, hasher, clock } = s.rig.deps;
  const why = `${describeWorld(w)}\nreplies: ${w.turns.map((t, i) => (t.mail ? null : replyText(w, i))).filter((x) => x !== null).join(" | ")}`;
  const closer = fakeCallClose(() => "closed");
  const gone = new Set<number>();
  const forgotten = new Set<string>();
  const forgetOp = (target: number) => {
    forgotten.add(rootFoodOf(w, target));
    for (const i of oracleDerivatives(w, target)) {
      gone.add(i);
      forgotten.add(w.memories[i]!.place);
    }
  };
  forgetOp(w.target);
  const first = await forgetMemory(s, w.target, "nrs-1");
  expect(first.kind).toBe("fenced");

  const events = [...w.events];
  let forgot2 = false;
  const fire = async (at: number) => {
    while (events.length > 0 && events[0]!.at <= at) {
      const e = events.shift()!.event;
      if (e === "lostLease") {
        for (const j of await forgetJobsOf(store)) {
          if (j.job.payload.kind !== "forget" || j.job.payload.phase === "done") continue;
          await advanceForget({ store: losingStore(store), hasher, resolver: worldResolver(s), closer }, UID, j.id, clock.read().opsClock.now, { maxSteps: 1 }).catch(() => null);
          s.rig.clock.advance(FORGET_LEASE_MS + 1);
          await requeueExpiredForget(store, UID, j.id, clock.read().opsClock.now);
          break;
        }
      } else if (e === "forget2" && !forgot2) {
        forgot2 = true;
        const free = w.memories.map((_, i) => i).filter((i) => !gone.has(i));
        if (free.length > 0) {
          const t2 = free[w.secondPick % free.length]!;
          forgetOp(t2);
          const second = await forgetMemory(s, t2, "nrs-2");
          expect(["fenced", "queued"]).toContain(second.kind);
        }
      }
    }
  };
  const check = async (when: string) => {
    const carry = (await forgetJobsOf(store)).flatMap((j) => ((j.job.payload as { carryTurnIds?: ID[] }).carryTurnIds ?? []) as ID[]);
    for (const r of await readAll(s, carry)) {
      for (const f of forgotten) if (word(f).test(r.text)) expect.fail(`${when}: "${f}" came back through ${r.reader}\n${why}\n--- output ---\n${r.text.slice(0, 600)}`);
    }
  };

  for (let step = 0; step < MAX_STEPS; step++) {
    await fire(step);
    const live = (await forgetJobsOf(store)).filter((j) => j.job.payload.kind === "forget" && j.job.payload.phase !== "done" && j.job.status !== "blocked" && j.job.status !== "failed");
    if (live.length === 0 && events.length === 0) break;
    for (const r of await stepAll(s, closer)) if (r.kind === "blocked") expect.fail(`the forget job blocked (${r.reason})\n${why}`);
    await check(`after step ${step}`);
  }
  await fire(Number.MAX_SAFE_INTEGER);
  while ((await forgetJobsOf(store)).some((j) => j.job.payload.kind === "forget" && j.job.payload.phase !== "done")) await stepAll(s, closer);
  await check("at the end");
  for (const j of await forgetJobsOf(store)) expect(j.job.payload.kind === "forget" && j.job.payload.phase, `job ${j.id}\n${why}`).toBe("done");
  // Survivors stay usable: every Memory the oracle leaves alone is allowed in a fresh context.
  const reader = storeReader(store, UID);
  const epoch = (await store.get<CoreEpoch>(UID, paths.core(UID, "epoch")))!.data;
  const memories = await readAllMemories(reader, UID);
  const snapshot = await snapshotFor(reader, UID, memories, epoch, 1);
  const ec = { ...foregroundEC(UID, epoch, clock.read(), 1), stage: "read" as const };
  for (let i = 0; i < w.memories.length; i++) {
    if (gone.has(i)) continue;
    const m = memories.find((x) => x.id === s.memoryIds[i])!;
    expect(eligible({ ref: docRef("memories", m.id, m.memory.rev), row: m.memory }, ec, snapshot), `survivor memory ${i} ("${memoryText(w, i)}")\n${why}`).toEqual({ allow: true, reason: "ok" });
  }
}

describe("No Resurrection with Franki's replies in the world (brief 048 ruling 1)", () => {
  it("after any interleaving, nothing Franki said about a forgotten root comes back through any reader", async () => {
    await fc.assert(fc.asyncProperty(nrWorldArb, async (w) => run(w)), { numRuns: RUNS });
  }, 1_200_000);
});
