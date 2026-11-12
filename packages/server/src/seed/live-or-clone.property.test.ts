/**
 * Brief 038, new property 3: a real account is never reset, and a visitor is never locked out. For any sequence of
 * what a browser does in its phases (enter and reload, reset answers delivered, timed out after the server finished,
 * or lost, Try again, Start over, and input: a chip or a typed line, which opens a Session and sends a turn, only
 * when the input gate allows),
 * run against the real reset and open routes:
 *   - a fresh account ends as a clone (the visit settles `ready`, the server holds a fixture clock), and no reset of
 *     it is ever answered LIVE;
 *   - an account holding Evidence from live mode is refused with LIVE on every reset, settles `live` with input
 *     allowed, and loses no row it held. (Brief 038 finding 9 widens "live" to Sessions, ledger rows and hard rules;
 *     that ruling is held on its own branch, so this file covers the Evidence case.)
 *
 * The browser is the real visit machine (`apps/web/src/ui/visit/visit-machine.ts`) with its input gate.
 * Runs: RUNS. Each case resets a small fixture a few times and opens a few Sessions.
 */
import { type CoreState, msFromTs } from "@franki/core";
import { testId } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { INITIAL_VISIT, type StoredVisit, type VisitEvent, type VisitState, inputAllowed, visitStep } from "../../../../apps/web/src/ui/visit/visit-machine";
import { ensureCoreDocs } from "../core-docs";
import { openRoute } from "../routes/open";
import { turnRoute } from "../routes/turn";
import { seedResetRoute } from "../routes/seed-reset";
import { paths } from "../store/paths";
import { commitUserTurnForTest } from "../testing/extract-fixtures";
import { callRoute, testRig } from "../testing/fakes";
import { SMALL_FIXTURE_ID, snapshotOf } from "../testing/seed";
import { typedTurn } from "../testing/session-fixtures";

const RUNS = 1000;
const UID = "visitor-1";
const ZONE = "America/Chicago";
const LIVE_KINDS = ["evidence"] as const;
type LiveKind = (typeof LIVE_KINDS)[number];

type Act =
  | { a: "reload" }
  | { a: "answer"; how: "deliver" | "timeout" | "lost" }
  | { a: "retry" }
  | { a: "startOver" }
  | { a: "input" };

const act: fc.Arbitrary<Act> = fc.oneof(
  fc.constant({ a: "reload" as const }),
  fc.record({ a: fc.constant("answer" as const), how: fc.constantFrom("deliver" as const, "timeout" as const, "lost" as const) }),
  fc.constant({ a: "retry" as const }),
  fc.constant({ a: "startOver" as const }),
  fc.constant({ a: "input" as const }),
);
const account = fc.oneof(fc.constant([] as LiveKind[]), fc.subarray([...LIVE_KINDS], { minLength: 1 }));

async function writeLive(rig: ReturnType<typeof testRig>, kinds: readonly LiveKind[]) {
  await ensureCoreDocs(UID, rig.deps, ZONE);
  for (const k of kinds) {
    if (k === "evidence") await commitUserTurnForTest(rig.store, UID, testId("live-t"), "My dog is called Pip", rig.clock, rig.deps.hasher);
  }
}

describe("Property: a real account is never reset, and a visitor is never locked out (brief 038)", () => {
  it("a fresh account always ends as a clone; a live account is always refused LIVE and keeps every row", async () => {
    await fc.assert(
      fc.asyncProperty(account, fc.array(act, { maxLength: 12 }), async (liveKinds, acts) => {
        const rig = testRig();
        const live = liveKinds.length > 0;
        if (live) await writeLive(rig, liveKinds);
        const before = live ? (await snapshotOf(rig.store, UID)).map(([p]) => p).filter((p) => !p.includes("/core/")) : [];

        let stored: StoredVisit | null = null;
        let s: VisitState = INITIAL_VISIT;
        let outstanding: { seq: number; visitId: string } | null = null;
        let ids = 0;
        const answers: number[] = [];
        const errors: string[] = [];

        const feed = (e: VisitEvent) => {
          const out = visitStep(s, e);
          s = out.state;
          for (const c of out.commands) {
            if (c.kind === "store") stored = { ...c.visit };
            if (c.kind === "reset") outstanding = { seq: c.seq, visitId: c.visitId };
          }
        };
        const enter = () => feed({ kind: "entered", stored: stored === null ? null : { ...stored }, newVisitId: testId(`visit-${++ids}`) });
        const answer = async (how: "deliver" | "timeout" | "lost") => {
          if (outstanding === null) return;
          const { seq, visitId } = outstanding;
          outstanding = null;
          if (how === "lost") return feed({ kind: "resetFailed", seq, why: "failed" });
          const res = await callRoute(rig, seedResetRoute, { requestId: testId(`req-${++ids}`), sessionId: null, fixtureId: SMALL_FIXTURE_ID, visitId, clientZone: ZONE }, { token: `token:${UID}` });
          answers.push(res.status);
          if (res.status !== 200) errors.push(res.body.error);
          if (how === "timeout") return feed({ kind: "resetFailed", seq, why: "timeout" });
          if (res.status === 200) return feed({ kind: "resetAnswered", seq, fixtureNamespace: res.body.fixtureNamespace, worldMs: msFromTs(res.body.worldClock) });
          feed({ kind: "resetFailed", seq, why: res.body.error === "LIVE" ? "live" : res.body.error === "BARRIER" ? "barrier" : "failed" });
        };
        const input = async () => {
          // The input gate: a chip, a typed line or a call reaches the server only when the screen takes input.
          if (!inputAllowed(s)) return;
          const res = await callRoute(rig, openRoute, { requestId: testId(`open-${++ids}`), initiator: "user", previousSessionId: null, clientZone: ZONE, visitId: null }, { token: `token:${UID}` });
          expect(res.status).toBe(200);
          // A chip or a typed line: the owner's own words, one Evidence row.
          const d = res.body.deck;
          const stamp = { sessionId: res.body.sessionId, epoch: d.epoch, policyRev: d.policyRev, bundleRev: d.bundleRev, rulesRev: d.rulesRev, generation: 1 };
          const turn = await callRoute(rig, turnRoute, typedTurn(stamp, 1, "What do you know about me?", `in-${++ids}`), { token: `token:${UID}` });
          expect(turn.status).toBe(200);
        };

        enter();
        for (const x of acts) {
          if (x.a === "reload") {
            // A reload drops the request in flight with the page: the server may or may not have run it.
            if (outstanding !== null) await answer("timeout");
            s = INITIAL_VISIT;
            outstanding = null;
            enter();
          } else if (x.a === "answer") await answer(x.how);
          else if (x.a === "retry") feed({ kind: "retry", newVisitId: testId(`visit-${++ids}`) } as VisitEvent);
          else if (x.a === "startOver") {
            feed({ kind: "startOverAsked" });
            feed({ kind: "startOverConfirmed", inCall: false, newVisitId: testId(`visit-${++ids}`) } as VisitEvent);
          } else await input();
        }
        // The visitor keeps going: answers arrive, and a failed visit is tried again.
        for (let i = 0; i < 6 && s.phase !== "ready" && s.phase !== "live"; i++) {
          if (outstanding !== null) await answer("deliver");
          else if (s.phase === "failed") feed({ kind: "retry", newVisitId: testId(`visit-${++ids}`) } as VisitEvent);
          else if (s.phase === "none") enter();
        }

        const state = (await rig.store.get<CoreState>(UID, paths.core(UID, "state")))!.data;
        if (!live) {
          expect(errors.filter((e) => e === "LIVE" || e === "AUTH"), "a fresh account was refused").toEqual([]);
          expect(s.phase).toBe("ready");
          expect(state.clockMode).toBe("fixture");
        } else {
          expect(answers.every((st) => st === 409), `a live account was answered ${answers.join(",")}`).toBe(true);
          expect(errors.every((e) => e === "LIVE")).toBe(true);
          expect(s.phase).toBe("live");
          expect(inputAllowed(s)).toBe(true);
          expect(state.clockMode).toBe("live");
          const now = new Set((await snapshotOf(rig.store, UID)).map(([p]) => p));
          expect(before.filter((p) => !now.has(p))).toEqual([]);
        }
      }),
      { numRuns: RUNS },
    );
  }, 600_000);
});
