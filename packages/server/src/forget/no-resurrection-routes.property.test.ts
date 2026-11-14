// Feature: forget on the wire (brief 048 stage 5), No Resurrection on the routes. The first two properties read the
// store's own readers (`eligible`, `recallLines`, `buildHead`). This one asks for the forget the way the owner does,
// through `/api/turn` (spoken in a call, or typed with no call open), lets the route and the worker tick finish it, and
// then reads everything a person could hear or see through the routes:
//
//   the open's Head and its first line; the state route's idle line; a typed turn's notes, and what its reply model
//   was given; every tool result (`recall`, `suggest`, `answer`, `read_money`) and what any tool's model was given;
//   the "why did you bring that up" read and the item read of every Memory and every turn's Evidence; and the memory
//   views (overview, lab, strip, receipt).
//
// The oracle is the first property's, from the generated lineage alone (`oracleDerivatives`), never the code under
// test: the target's root food and the place of every derivative are forgotten. "Contains" is a whole-word search.
// Survivors stay usable: every Memory the oracle leaves alone is still allowed in a fresh context.
import { type CoreEpoch, type ID, IDLE_SILENCE_MS, docRef, eligible } from "@franki/core";
import { type NrWorld, describeWorld, memoryText, nrWorldArb, testId } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { foregroundEC, readAllMemories, snapshotFor, storeReader } from "../head-build";
import { memoryRoute } from "../routes/memory";
import { openRoute } from "../routes/open";
import { stateRoute } from "../routes/state";
import { toolRoute } from "../routes/tool";
import { paths } from "../store/paths";
import { callRoute, settle } from "../testing/fakes";
import { type RouteWorld, forgetByRoute, nextSeqOf, postTurn, routeWorld, stampOf, turnBody, workUntilForgotten } from "./testing/route-world";
import { WORLD_SESSION, WORLD_UID, oracleDerivatives, rootFoodOf } from "./testing/world";
import { ok } from "../openai/fake";
import { completed } from "../openai/responses";

const UID = WORLD_UID;
const RUNS = Number(process.env.NR_ROUTES_RUNS ?? 200);
const stringify = (v: unknown) => JSON.stringify(v) ?? "";
const word = (w: string) => new RegExp(`\\b${w}\\b`, "i");

interface Reading {
  reader: string;
  text: string;
}

const MEMORY_VIEWS = ["overview", "lab", "strip", "receipt"] as const;

async function memoryRead(s: RouteWorld, view: string, id: string | null) {
  const qs = new URLSearchParams({ view, ...(id === null ? {} : { id }) });
  return callRoute(s.rig, memoryRoute, undefined, { method: "GET", url: `http://localhost:3000/api/memory?${qs}`, origin: null });
}

/** Everything the routes give once the forget is done, from a fresh call. */
async function readRoutes(s: RouteWorld, person: string): Promise<Reading[]> {
  const { rig } = s;
  const out: Reading[] = [];
  const models = (label: string, from: number) => {
    for (const r of rig.openai.requests.slice(from)) out.push({ reader: `${label}: model call ${r.endpoint}`, text: stringify(r.body) });
  };

  // The fresh call: its Head and its first line.
  let from = rig.openai.requests.length;
  const open = (await settle(callRoute(rig, openRoute, { requestId: testId("rw-open"), initiator: "user", previousSessionId: WORLD_SESSION, clientZone: "America/Chicago", visitId: null }), rig.clock, rig.timers)).value;
  if (open.status !== 200 || open.body.deck === null) throw new Error(`the fresh open answered ${open.status} ${stringify(open.body)}`);
  out.push({ reader: "open", text: stringify(open.body) });
  models("open", from);
  const sessionId = open.body.sessionId as string;

  // The state route's idle line.
  rig.clock.advance(IDLE_SILENCE_MS);
  const st = await stampOf(s, sessionId);
  from = rig.openai.requests.length;
  const state = (await settle(callRoute(rig, stateRoute, { sessionId, generation: st.generation, seen: { epoch: st.epoch, policyRev: st.policyRev, bundleRev: st.bundleRev, rulesRev: st.rulesRev }, ackStamp: null, speechStartedOpsAt: null }), rig.clock, rig.timers)).value;
  out.push({ reader: "state (idle)", text: stringify(state.body) });
  models("state", from);

  // A typed question about a person: its notes, and what its reply model was given.
  rig.openai.script("responses.create", ok(completed("Let me think.")));
  from = rig.openai.requests.length;
  const ask = await postTurn(s, turnBody(await stampOf(s, sessionId), await nextSeqOf(s, sessionId), `What do you remember about ${person}?`, "rw-ask"));
  out.push({ reader: "typed turn", text: stringify(ask.body) });
  models("typed turn", from);
  const turnId = testId("rw-turn-rw-ask");

  // Every tool on that turn.
  const tools = [
    { name: "recall", args: { purpose: "answer", query: person, entityRefs: [], roleTuple: null, predicate: null, asOf: null, anchorId: null, sourceMode: "both" } },
    { name: "recall", args: { purpose: "why", query: person, entityRefs: [], roleTuple: null, predicate: null, asOf: null, anchorId: null, sourceMode: "both" } },
    { name: "suggest", args: { domain: "food", query: "quick dinner tonight", attendeeIds: [], when: null, contextId: null } },
    { name: "suggest", args: { domain: "connection", query: person, attendeeIds: [], when: null, contextId: null } },
    { name: "answer", args: { pendingId: null, choiceId: null } },
    { name: "read_money", args: { period: "this_month", group: null, merchant: null } },
  ];
  for (let i = 0; i < tools.length; i++) {
    from = rig.openai.requests.length;
    const stamp = { ...(await stampOf(s, sessionId)), turnId };
    const res = (await settle(callRoute(rig, toolRoute, { requestId: testId(`rw-tool-${i}`), stamp, callId: `call_${i}`, tool: tools[i] }), rig.clock, rig.timers)).value;
    out.push({ reader: `tool ${tools[i]!.name} (${i})`, text: stringify(res.body) });
    models(`tool ${tools[i]!.name}`, from);
  }

  // The memory views, and the item and "why" reads of every Memory and every turn's Evidence.
  for (const view of MEMORY_VIEWS) out.push({ reader: `memory ${view}`, text: stringify((await memoryRead(s, view, null)).body) });
  for (const id of [...s.memoryIds, ...s.turnEids]) {
    for (const view of ["item", "why"] as const) out.push({ reader: `memory ${view} ${id}`, text: stringify((await memoryRead(s, view, id)).body) });
  }
  return out;
}

async function run(w: NrWorld, inCall: boolean): Promise<void> {
  const s = await routeWorld(w, inCall);
  const why = `${inCall ? "spoken in a call" : "typed, no call"}\n${describeWorld(w)}`;
  const gone = oracleDerivatives(w, w.target);
  const forgotten = new Set<string>([rootFoodOf(w, w.target), ...[...gone].map((i) => w.memories[i]!.place)]);

  const res = await forgetByRoute(s, w.target, "forget");
  expect(res.status, `the forget's turn answered ${res.status} ${stringify(res.body)}\n${why}`).toBe(200);
  expect(await workUntilForgotten(s), `the forget never finished\n${why}`).toBe(true);
  const epoch = (await s.rig.store.get<CoreEpoch>(UID, paths.core(UID, "epoch")))!.data;
  expect(epoch.barrier, `the barrier is still up\n${why}`).toBeNull();

  const person = w.sentences[w.memories[w.target]!.sentence]!.person;
  const readings = await readRoutes(s, person);
  if (process.env.NR_ROUTES_DEBUG) console.log(readings.map((r) => `${r.reader}: ${r.text.slice(0, 300)}`).join("\n"));
  for (const r of readings) {
    for (const f of forgotten) if (word(f).test(r.text)) expect.fail(`"${f}" came back through ${r.reader}\n${why}\n--- output ---\n${r.text.slice(0, 600)}`);
  }

  // Survivors stay usable.
  const { store, clock } = s.rig.deps;
  const reader = storeReader(store, UID);
  const now = (await store.get<CoreEpoch>(UID, paths.core(UID, "epoch")))!.data;
  const memories = await readAllMemories(reader, UID);
  const snapshot = await snapshotFor(reader, UID, memories, now, 1);
  const ec = { ...foregroundEC(UID, now, clock.read(), 1), stage: "read" as const };
  for (let i = 0; i < w.memories.length; i++) {
    if (gone.has(i)) continue;
    const m = memories.find((x) => x.id === (s.memoryIds[i] as ID))!;
    expect(eligible({ ref: docRef("memories", m.id, m.memory.rev), row: m.memory }, ec, snapshot), `survivor memory ${i} ("${memoryText(w, i)}")\n${why}`).toEqual({ allow: true, reason: "ok" });
  }
}

describe("No Resurrection on the routes (brief 048 stage 5)", () => {
  it("after a forget asked on /api/turn, nothing forgotten comes back through any route, and survivors stay usable", async () => {
    await fc.assert(fc.asyncProperty(nrWorldArb, fc.boolean(), async (w, inCall) => run(w, inCall)), { numRuns: RUNS });
  }, 1_200_000);
});
