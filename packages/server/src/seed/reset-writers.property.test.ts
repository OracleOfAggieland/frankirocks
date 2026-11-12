/**
 * Brief 038, new property 1: a reset is total under any writer. For any interleaving of a reset with a receipt, a
 * turn, a tool call, a tick, an advance and an extraction drain of the old visit, landed at any point of the reset's
 * own store operations: after the reset answers, the tenant holds exactly the rows a fresh clone holds (the seed's
 * rows, the five core documents and the reset's own request entry), plus at most the request entries of writers that
 * were refused, each closed as refused; and every writer that ran while the barrier was up was answered as refused,
 * never accepted and never dropped mid-way.
 *
 * Runs: RUNS (about 25 s alone; 1,000 would take about 50 s). Each case clones a small fixture, opens a call, types
 * one line, then resets with up to six writers.
 */
import { type CoreEpoch, type Ledger, msFromTs, tsFromMs } from "@franki/core";
import { testId } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { requestKey } from "../ledger/request";
import { receiptRoute } from "../routes/receipt";
import { seedAdvanceRoute } from "../routes/seed-advance";
import { toolRoute } from "../routes/tool";
import { turnRoute } from "../routes/turn";
import { paths } from "../store/paths";
import type { StorePort } from "../store/port";
import { callRoute, testRig } from "../testing/fakes";
import { SMALL_FIXTURE, SMALL_FIXTURE_ID, resetBody, resetFresh, snapshotOf } from "../testing/seed";
import { openTestSession, typedTurn } from "../testing/session-fixtures";
import { memoryTick } from "../time/tick";
import { drainExtractJobs } from "../worker/drain";
import { runDueJobs } from "../worker/tick";
import { buildSeed } from "./build";
import { cloneWorldStart } from "./clock";

const RUNS = 500;
const UID = "owner-1";
const ZONE = "America/Chicago";
const KINDS = ["receipt", "turn", "tool", "tick", "advance", "extract"] as const;
type Kind = (typeof KINDS)[number];
const ARGS = { purpose: "answer", query: "dog name", entityRefs: [], roleTuple: null, predicate: null, asOf: null, anchorId: null, sourceMode: "canonical" };

const writers = fc.array(fc.record({ kind: fc.constantFrom(...KINDS), at: fc.integer({ min: 0, max: 45 }) }), { minLength: 1, maxLength: 6 });

type Answer = { kind: Kind; barrierUp: boolean; requestId: string | null; status: number | null; body: any; threw: string | null };

/** Counts the reset's store operations and runs the writers placed at each one, before it. */
function interleaved(inner: StorePort, at: Map<number, (() => Promise<void>)[]>): StorePort {
  let n = 0;
  let busy = false;
  const before = async () => {
    if (busy) return;
    const due = at.get(n++) ?? [];
    busy = true;
    try {
      for (const w of due) await w();
    } finally {
      busy = false;
    }
  };
  return {
    get: async (uid, path) => {
      await before();
      return inner.get(uid, path);
    },
    query: async (uid, spec) => {
      await before();
      return inner.query(uid, spec);
    },
    transaction: async (uid, fn) => {
      await before();
      return inner.transaction(uid, fn);
    },
  };
}

describe("Property: a reset is total under any writer (brief 038)", () => {
  it("after the reset answers, the tenant holds a fresh clone, and every writer under the barrier was refused", async () => {
    await fc.assert(
      fc.asyncProperty(writers, async (plan) => {
        const rig = testRig();
        const old = await resetFresh(rig, UID, "old", "old", ZONE, SMALL_FIXTURE_ID);
        expect(old.status).toBe(200);
        const oldNs: string = old.body.fixtureNamespace;
        const oldWorld = msFromTs(old.body.worldClock);
        const s = await openTestSession(rig);
        // One typed line of the old visit, so an extraction Job and its Evidence exist for the drain to race.
        expect((await callRoute(rig, turnRoute, typedTurn(s.stamp, 1, "My dog is called Pip."))).status).toBe(200);

        const inner = rig.deps.store;
        const answers: Answer[] = [];
        let seq = 1;
        const ctx = () => ({ uid: UID, deps: { ...rig.deps, store: inner }, schedule: rig.sched.schedule });
        const barrierUp = async () => ((await inner.get<CoreEpoch>(UID, paths.core(UID, "epoch")))?.data.barrier ?? null) !== null;
        const run = (kind: Kind, i: number) => async () => {
          const up = await barrierUp();
          const a: Answer = { kind, barrierUp: up, requestId: null, status: null, body: null, threw: null };
          try {
            const route = async (spec: Parameters<typeof callRoute>[1], body: Record<string, unknown>) => {
              a.requestId = body.requestId as string;
              const r = await callRoute({ ...rig, deps: { ...rig.deps, store: inner } }, spec, body);
              a.status = r.status;
              a.body = r.body;
            };
            if (kind === "receipt")
              await route(receiptRoute, {
                requestId: testId(`w-rcpt-${i}`),
                stamp: { ...s.stamp, turnId: testId("turn-1") },
                responseId: `resp_w${i}`,
                kind: "transcript",
                momentIds: [],
                noteIds: [],
                pendingId: null,
                permitKind: null,
                text: `Old visit words ${i}.`,
              });
            else if (kind === "turn") await route(turnRoute, typedTurn(s.stamp, ++seq, `Old visit line ${i}.`, `w-${i}`));
            else if (kind === "tool") await route(toolRoute, { requestId: testId(`w-tool-${i}`), stamp: { ...s.stamp, turnId: testId("turn-1") }, callId: `call_w${i}`, tool: { name: "recall", args: ARGS } });
            else if (kind === "advance") await route(seedAdvanceRoute, { requestId: testId(`w-adv-${i}`), fixtureNamespace: oldNs, to: tsFromMs(oldWorld + (i + 1) * 3_600_000) });
            else if (kind === "tick") {
              await runDueJobs(ctx());
              a.body = await memoryTick(ctx());
            } else await drainExtractJobs(UID, ctx().deps);
          } catch (error) {
            a.threw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
          }
          answers.push(a);
        };
        const at = new Map<number, (() => Promise<void>)[]>();
        plan.forEach((w, i) => at.set(w.at, [...(at.get(w.at) ?? []), run(w.kind, i)]));
        rig.deps.store = interleaved(inner, at);
        const res = await resetFresh(rig, UID, "new", "new", ZONE, SMALL_FIXTURE_ID);
        rig.deps.store = inner;
        expect(res.status).toBe(200);

        // Every writer that ran while the barrier was up was answered as refused.
        for (const a of answers) {
          expect(a.threw, `${a.kind} threw`).toBeNull();
          if (!a.barrierUp) continue;
          if (a.kind === "tick") expect(a.body.skipped, "tick under the barrier").toBe("barrier");
          if (a.status === null) continue;
          const accepted = a.status === 200 && (a.kind === "receipt" ? a.body.accepted === true : a.kind === "tool" ? a.body.status === "ready" : a.kind === "turn" ? a.body.status !== "stale" : true);
          expect(accepted, `${a.kind} accepted under the barrier: ${a.status} ${JSON.stringify(a.body)}`).toBe(false);
        }

        // The tenant holds exactly a fresh clone, plus closed request entries of refused writers.
        const epoch = (await inner.get<CoreEpoch>(UID, paths.core(UID, "epoch")))!.data;
        expect(epoch.barrier).toBeNull();
        const expected = await buildSeed(SMALL_FIXTURE, {
          uid: UID,
          namespace: res.body.fixtureNamespace,
          zone: ZONE,
          worldStart: cloneWorldStart(rig.clock.read().opsClock.now, ZONE),
          opsNow: rig.clock.read().opsClock.now,
          core: { epoch: epoch.epoch, policyRev: epoch.policyRev },
          hasher: rig.deps.hasher,
        });
        const own = requestKey(UID, "reset", testId("req-new"), resetBody("new", "new", ZONE, SMALL_FIXTURE_ID), rig.deps.hasher).path;
        const want = new Set([...expected.groups.flatMap((g) => g.writes.map((w) => w.path)), ...["epoch", "state", "counters", "rules", "bundle"].map((d) => `users/${UID}/core/${d}`), own]);
        const routeOf: Record<string, "receipt" | "turn" | "tool" | "advance"> = { receipt: "receipt", turn: "turn", tool: "tool", advance: "advance" };
        const refusedKeys = new Set(
          answers.filter((a) => a.requestId !== null && a.barrierUp).map((a) => requestKey(UID, routeOf[a.kind]!, a.requestId!, {}, rig.deps.hasher).path),
        );
        const have = await snapshotOf(inner, UID);
        const extra = have.filter(([p]) => !want.has(p));
        for (const [p, json] of extra) {
          expect(refusedKeys.has(p), `left over: ${p} ${json.slice(0, 200)}`).toBe(true);
          const entry = JSON.parse(json) as Ledger;
          expect(entry.kind).toBe("request");
          expect(entry.state, `left over: ${p}`).toBe("failed");
        }
        const paths_ = new Set(have.map(([p]) => p));
        expect([...want].filter((p) => !paths_.has(p))).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  }, 600_000);
});
