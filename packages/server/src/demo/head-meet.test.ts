// Kiroween Demo (R7.1, R7.2, R7.3, R7.6; contract question 97): on a demo visit the open greets the persona by name and
// never says the first-meeting line; on any other visit the open is as before (M-1: a sample visit is asked). The
// sample persona stands in for Jeffrey here: what is checked is the wiring from `ctx.anonymous` to the Head and meet,
// not the pairing of fixture and visit (that is the reset's, part C3). The context is built with `anonymous` set, as
// `runRoute` sets it from the verified token.
import { MEET_AGAIN_LINE, MEET_LINE, NO_NAME_LINE, knownNameLine } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { meetRowId } from "../meet";
import { ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { openRoute } from "../routes/open";
import type { RouteContext } from "../routes/runtime";
import { paths } from "../store/paths";
import { type TestRig, settle, testRig } from "../testing/fakes";
import { resetAs } from "../testing/seed";
import { currentVisit } from "../testing/session-fixtures";

const UID = "owner-1";

function rig(): TestRig {
  const r = testRig();
  r.openai.always("responses.create", ok(completed("All right.")));
  r.openai.always("realtime.calls.hangup", ok(null));
  return r;
}

const ctx = (r: TestRig, anonymous: boolean): RouteContext => ({ uid: UID, deps: r.deps, schedule: r.sched.schedule, startedOpsAt: r.clock.read().opsClock.now, origin: "https://frankirocks.com", anonymous });

async function open(r: TestRig, label: string, anonymous: boolean) {
  const req = openRoute.parse({ body: { requestId: testId(label), initiator: "user", previousSessionId: null, clientZone: "UTC", visitId: await currentVisit(r) }, query: new URLSearchParams() });
  return (await settle(openRoute.run(ctx(r, anonymous), req), r.clock, r.timers)).value as { proactive: { whisper: { text: string } } | null; deck: { head: { text: string } } };
}

describe("a demo visit's open (Kiroween Demo)", () => {
  it("greets the persona by name and never offers the first meeting, open after open", async () => {
    const r = rig();
    expect((await resetAs(r, UID, "v1", "r1")).status).toBe(200);
    for (const label of ["o1", "o2", "o3"]) {
      const o = await open(r, label, true);
      expect([MEET_LINE, MEET_AGAIN_LINE]).not.toContain(o.proactive?.whisper.text ?? null);
      expect(o.deck.head.text).toContain(knownNameLine("Riley"));
      expect(o.deck.head.text).not.toContain(NO_NAME_LINE);
    }
    // A known name closes the meeting, as for any account: both rows are `met`, naming no turn.
    for (const n of [1, 2] as const) {
      const row = (await r.store.get<{ kind: string; payload: { acceptedRefs: unknown[] } }>(UID, paths.ledger(UID, meetRowId(n, r.deps.hasher))))?.data;
      expect(row?.kind).toBe("decision");
      expect(row?.payload.acceptedRefs).toEqual([]);
    }
  });

  it("a visit with a verified non-anonymous token is as before: the sample visit is asked, and the persona's name stays out", async () => {
    const r = rig();
    expect((await resetAs(r, UID, "v1", "r1")).status).toBe(200);
    const o = await open(r, "o1", false);
    expect(o.proactive?.whisper.text).toBe(MEET_LINE);
    expect(o.deck.head.text).toContain(NO_NAME_LINE);
    expect(o.deck.head.text).not.toContain("Riley");
  });
});
