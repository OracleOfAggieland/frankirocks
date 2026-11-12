// Brief 038 finding 1: a real account is never reset, and says so with its own code; a visitor's fresh account
// always clones.
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { openRoute } from "../routes/open";
import { seedResetRoute } from "../routes/seed-reset";
import { turnRoute } from "../routes/turn";
import { callRoute, testRig } from "../testing/fakes";
import { resetFresh, snapshotOf, stateOf } from "../testing/seed";
import { typedTurn } from "../testing/session-fixtures";

const UID = "owner-1";
const ZONE = "America/Chicago";

/** Every row but the reset route's own request entries, which a refused reset closes as failed. */
const kept = async (rig: ReturnType<typeof testRig>) => {
  const rows = await snapshotOf(rig.store, UID);
  return rows.filter(([, json]) => !(json.includes('"kind":"request"') && json.includes('"route":"reset"')));
};

describe("a real account and the reset (brief 038 finding 1)", () => {
  it("the reviewer's sequence: open and a typed line in live mode, then reset answers LIVE, and Try again answers LIVE", async () => {
    const rig = testRig();
    const open = await callRoute(rig, openRoute, { requestId: testId("o1"), initiator: "user", previousSessionId: null, clientZone: ZONE, visitId: null });
    expect(open.status).toBe(200);
    const d = open.body.deck;
    const stamp = { sessionId: open.body.sessionId, epoch: d.epoch, policyRev: d.policyRev, bundleRev: d.bundleRev, rulesRev: d.rulesRev, generation: 1 };
    expect((await callRoute(rig, turnRoute, typedTurn(stamp, 1, "What do you know about me?"))).status).toBe(200);
    const before = await kept(rig);
    for (const label of ["r1", "r2"]) {
      const res = await resetFresh(rig, UID, `v-${label}`, label, ZONE);
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: "LIVE", retryAfterMs: 0 });
    }
    expect(await kept(rig)).toEqual(before);
    expect((await stateOf(rig.store, UID)).clockMode).toBe("live");
  });

  it("a fresh account whose earlier resets were refused or failed still clones", async () => {
    const rig = testRig();
    // A reset the route refused (an unknown fixture) leaves only its own failed request entry.
    expect((await callRoute(rig, seedResetRoute, { requestId: testId("bad"), sessionId: null, fixtureId: testId("nope"), visitId: testId("v0"), clientZone: ZONE })).status).toBe(404);
    const res = await resetFresh(rig, UID, "v1", "r1", ZONE);
    expect(res.status).toBe(200);
    expect((await stateOf(rig.store, UID)).clockMode).toBe("fixture");
  });

  it("a clone with Sessions, Evidence and ledger rows of its own is still reset: it is a clone", async () => {
    const rig = testRig();
    expect((await resetFresh(rig, UID, "v1", "r1", ZONE)).status).toBe(200);
    const open = await callRoute(rig, openRoute, { requestId: testId("o1"), initiator: "user", previousSessionId: null, clientZone: ZONE, visitId: testId("visit-v1") });
    expect(open.status).toBe(200);
    expect((await resetFresh(rig, UID, "v2", "r2", ZONE)).status).toBe(200);
  });
});
