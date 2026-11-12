// Brief 038 finding 4: a tab of an old visit cannot talk to the new clone.
import { msFromTs, tsFromMs } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { openRoute } from "../routes/open";
import { seedAdvanceRoute } from "../routes/seed-advance";
import { turnRoute } from "../routes/turn";
import { callRoute, testRig } from "../testing/fakes";
import { resetFresh } from "../testing/seed";
import { typedTurn } from "../testing/session-fixtures";

const UID = "owner-1";
const ZONE = "America/Chicago";
const open = (rig: ReturnType<typeof testRig>, label: string, visitId: string | null) =>
  callRoute(rig, openRoute, { requestId: testId(label), initiator: "user", previousSessionId: null, clientZone: ZONE, visitId });

describe("an old visit and the new clone (brief 038 finding 4)", () => {
  it("after tab B starts over, tab A's open, typed turn and bolt are each answered STALE", async () => {
    const rig = testRig();
    const first = await resetFresh(rig, UID, "v1", "r1", ZONE);
    const a = await open(rig, "a-open", testId("visit-v1"));
    expect(a.status).toBe(200);
    const d = a.body.deck;
    const stamp = { sessionId: a.body.sessionId, epoch: d.epoch, policyRev: d.policyRev, bundleRev: d.bundleRev, rulesRev: d.rulesRev, generation: 1 };
    // Tab B: start over, with a new visit ID.
    expect((await resetFresh(rig, UID, "v2", "r2", ZONE)).status).toBe(200);
    const reopen = await open(rig, "a-open-2", testId("visit-v1"));
    expect([reopen.status, reopen.body.error]).toEqual([409, "STALE"]);
    const turn = await callRoute(rig, turnRoute, typedTurn(stamp, 1, "Hello from the old tab."));
    expect([turn.status, turn.body.error]).toEqual([409, "STALE"]);
    const bolt = await callRoute(rig, seedAdvanceRoute, { requestId: testId("a-bolt"), fixtureNamespace: first.body.fixtureNamespace, to: tsFromMs(msFromTs(first.body.worldClock) + 3_600_000) });
    expect([bolt.status, bolt.body.error]).toEqual([409, "STALE"]);
    // The new visit's own tab opens.
    expect((await open(rig, "b-open", testId("visit-v2"))).status).toBe(200);
  });
});
