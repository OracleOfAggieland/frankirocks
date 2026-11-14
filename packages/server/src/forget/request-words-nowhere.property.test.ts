// Feature: forget on the wire (brief 048 ruling 4, stage 5): the request's words go nowhere. For any order of
// ordinary turns, turns posted `missing` and later superseded, turns whose parse fails and is repaired, and worker
// runs around a forget asked on `/api/turn`, the words of the request are in:
//
//   no model call made after admission chose forget (the forget's own resolve reads them through its own port, the
//   one allowed reader, F-204; the parse and the typed reply that run beside it are before admission, F-208a);
//   no safe turn (`earlierSafeTurns`), no Evidence (the chunk store), no Job (an extraction job included), and no turn
//   a fresh call carries (the job's `carryTurnIds`, and the fresh open's Deck).
//
// The request says one marker word that nothing else in the world says, so the oracle is a plain search for it. Once
// the forget is done, no stored row anywhere holds it.
import { type CoreEpoch, type ID, type Session, type Turn } from "@franki/core";
import { type NrWorld, nrWorldArb, testId } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { storeReader } from "../head-build";
import { fail } from "../openai/fake";
import { openRoute } from "../routes/open";
import { earlierSafeTurns } from "../routes/turn";
import { paths } from "../store/paths";
import { callRoute, runScheduled, settle } from "../testing/fakes";
import { drainExtractJobs } from "../worker/drain";
import { runDueJobs } from "../worker/tick";
import { type RouteWorld, forgetByRoute, nextSeqOf, postTurn, routeWorld, stampOf, turnBody, workUntilForgotten } from "./testing/route-world";
import { WORLD_SESSION, WORLD_UID, dumpStore, forgetJobsOf } from "./testing/world";

const UID = WORLD_UID;
const RUNS = Number(process.env.WORDS_RUNS ?? 100);
/** Said only by the forget request. */
const MARKER = "quokka";
const has = (v: unknown) => new RegExp(`\\b${MARKER}\\b`, "i").test(JSON.stringify(v) ?? "");

type Act = { k: "say" } | { k: "missing" } | { k: "supersede" } | { k: "failParse" } | { k: "work" } | { k: "forget" };
const actArb: fc.Arbitrary<Act> = fc.constantFrom<Act>({ k: "say" }, { k: "missing" }, { k: "supersede" }, { k: "failParse" }, { k: "work" });

interface Run {
  s: RouteWorld;
  session: string;
  n: number;
  /** The last `missing` post: its request and turn, for a later superseding post. */
  missing: { requestId: string; turnId: string; seq: number; session: string; items: unknown[] } | null;
  /** Model calls before this index were made before admission chose forget. */
  admittedAt: number | null;
  why: string;
}

/** A fresh call when the current Session is no longer live and no barrier is up (a forget in a call closes it). */
async function ensureSession(r: Run): Promise<boolean> {
  const { store } = r.s.rig;
  const session = (await store.get<Session>(UID, paths.session(UID, r.session)))!.data;
  if (session.status === "active" || session.status === "minting") return true;
  const res = (await settle(callRoute(r.s.rig, openRoute, { requestId: testId(`words-open-${r.n++}`), initiator: "user", previousSessionId: r.session, clientZone: "America/Chicago", visitId: null }), r.s.rig.clock, r.s.rig.timers)).value;
  if (res.status !== 200 || res.body.deck === null) return false;
  r.session = res.body.sessionId;
  return true;
}

async function act(r: Run, a: Act): Promise<void> {
  const { s } = r;
  const label = `${a.k}-${r.n++}`;
  s.rig.clock.advance(3_000);
  if (a.k === "work") {
    await runScheduled(s.rig);
    await settle(runDueJobs(s.ctx), s.rig.clock, s.rig.timers);
    await settle(drainExtractJobs(UID, s.rig.deps), s.rig.clock, s.rig.timers);
    return;
  }
  if (a.k === "forget") {
    const before = s.rig.openai.requests.length;
    const res = await forgetByRoute(s, s.w.target, "forget", MARKER);
    expect(res.status, `the forget answered ${res.status} ${JSON.stringify(res.body)}\n${r.why}`).toBe(200);
    // Before admission chose forget: the parse, and a typed turn's reply beside it. Nothing else reads the words.
    for (const q of s.rig.openai.requests.slice(before)) {
      if (!has(q.body)) continue;
      const parse = q.endpoint === "decisions.create";
      const reply = q.endpoint === "responses.create" && !s.inCall && (q.body as { model?: string }).model === "test-brain-model";
      if (!parse && !reply) expect.fail(`the request's words reached a ${q.endpoint} call inside the forget's own turn\n${r.why}\n${JSON.stringify(q.body).slice(0, 600)}`);
    }
    r.admittedAt = s.rig.openai.requests.length;
    return;
  }
  if (!(await ensureSession(r))) return;
  const stamp = await stampOf(s, r.session);
  if (a.k === "supersede") {
    const m = r.missing;
    if (m === null || m.session !== r.session) return;
    r.missing = null;
    await postTurn(s, { ...turnBody(stamp, m.seq, `The late words, number ${r.n}.`, label, { supersedes: m.requestId, turnId: m.turnId }), clientSeq: m.seq, items: m.items });
    return;
  }
  const seq = await nextSeqOf(s, r.session);
  const text = `Note number ${r.n}: the weather is mild.`;
  if (a.k === "failParse") s.rig.openai.script("decisions.create", fail(new Error("the parse failed (test)")));
  const body = turnBody(stamp, seq, text, label, { spoken: s.inCall, transcriptState: a.k === "missing" ? "missing" : "final" });
  const res = await postTurn(s, body);
  if (a.k === "missing" && res.status === 200) r.missing = { requestId: body.requestId, turnId: body.turnId, seq, session: r.session, items: body.items };
}

/** Every reader the request's words must not reach, once admission chose forget. */
async function check(r: Run, when: string): Promise<void> {
  const { s } = r;
  if (r.admittedAt === null) return;
  const { store } = s.rig;
  for (const q of s.rig.openai.requests.slice(r.admittedAt)) if (has(q.body)) expect.fail(`${when}: the request's words reached a ${q.endpoint} call\n${r.why}\n${JSON.stringify(q.body).slice(0, 600)}`);
  const rows = await dumpStore(store);
  for (const [path, data] of rows) {
    if ((path.startsWith("evidence/") || path.startsWith("jobs/")) && has(data)) expect.fail(`${when}: the request's words are in ${path}\n${r.why}\n${JSON.stringify(data).slice(0, 600)}`);
  }
  const epoch = (await store.get<CoreEpoch>(UID, paths.core(UID, "epoch")))!.data;
  if (epoch.barrier === null) {
    const ctx = s.ctx;
    for (const id of new Set([WORLD_SESSION, r.session])) {
      const session = (await store.get<Session>(UID, paths.session(UID, id)))!.data;
      const safe = await earlierSafeTurns(storeReader(store, UID), UID, id, session.nextClientSeq + 1, ctx);
      if (has(safe)) expect.fail(`${when}: the request's words are in a safe turn of ${id}\n${r.why}\n${JSON.stringify(safe).slice(0, 600)}`);
    }
  }
  for (const j of await forgetJobsOf(store)) {
    const carry = ((j.job.payload as { carryTurnIds?: ID[] }).carryTurnIds ?? []) as ID[];
    for (const id of carry) {
      const t = (await store.get<Turn>(UID, paths.turn(UID, WORLD_SESSION, id)))?.data ?? null;
      if (has(t)) expect.fail(`${when}: the request's words are in carried turn ${id}\n${r.why}`);
    }
  }
}

async function run(w: NrWorld, inCall: boolean, before: Act[], after: Act[]): Promise<void> {
  const s = await routeWorld(w, inCall);
  const acts: Act[] = [...before, { k: "forget" }, ...after];
  const r: Run = { s, session: WORLD_SESSION, n: 0, missing: null, admittedAt: null, why: `${inCall ? "spoken in a call" : "typed, no call"}; acts: ${acts.map((a) => a.k).join(", ")}` };
  for (const a of acts) {
    await act(r, a);
    await check(r, `after ${a.k}`);
  }
  // The forget really fenced (else the checks above read nothing).
  expect((await forgetJobsOf(s.rig.store)).length, `the forget fenced nothing\n${r.why}`).toBe(1);
  expect(await workUntilForgotten(s), `the forget never finished\n${r.why}`).toBe(true);
  await check(r, "at the end");
  // The fresh call carries nothing of the request.
  const open = (await settle(callRoute(s.rig, openRoute, { requestId: testId("words-open-end"), initiator: "user", previousSessionId: r.session, clientZone: "America/Chicago", visitId: null }), s.rig.clock, s.rig.timers)).value;
  expect(open.status).toBe(200);
  if (has(open.body)) expect.fail(`the fresh open carries the request's words\n${r.why}\n${JSON.stringify(open.body).slice(0, 600)}`);
  // Once the forget is done, no stored row holds the words: the dead request turn was emptied by purge.
  const rows = await dumpStore(s.rig.store);
  for (const id of new Set([WORLD_SESSION, r.session])) {
    const turns = await s.rig.store.query<Turn>(UID, { collection: paths.turns(UID, id), where: [], orderBy: { field: "seq", dir: "asc" }, limit: 100 });
    for (const t of turns) rows.set(`turns/${id}/${t.id}`, t.data as never);
  }
  for (const [path, data] of rows) if (has(data)) expect.fail(`after the forget is done, ${path} still holds the request's words\n${r.why}\n${JSON.stringify(data).slice(0, 600)}`);
}

describe("the request's words go nowhere (brief 048 ruling 4)", () => {
  it("after admission chooses forget, the request's words reach no model call, safe turn, Evidence, Job or carried turn", async () => {
    await fc.assert(
      fc.asyncProperty(nrWorldArb, fc.boolean(), fc.array(actArb, { maxLength: 4 }), fc.array(actArb, { maxLength: 6 }), async (w, inCall, before, after) => run(w, inCall, before, after)),
      { numRuns: RUNS },
    );
  }, 1_200_000);
});
