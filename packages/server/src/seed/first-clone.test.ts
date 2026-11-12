// Brief 038 finding 3: a visitor's first clone, sent before any open, is laid out in the visitor's zone.
import { msFromTs } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { seedResetRoute } from "../routes/seed-reset";
import { callRoute, testRig } from "../testing/fakes";
import { resetFresh, stateOf } from "../testing/seed";
import { PERSONA_FIXTURE_ID } from "./persona";

const UID = "visitor-1";
const ZONE = "America/Chicago";
const local = (ms: number, zone: string) => new Date(ms).toLocaleString("en-US", { timeZone: zone, weekday: "long", hour: "2-digit", minute: "2-digit", hour12: false });

describe("the first clone (brief 038 finding 3)", () => {
  it("a fresh user's first reset, with no open before it, starts on Friday 08:40 in the browser's zone", async () => {
    const rig = testRig();
    const res = await resetFresh(rig, UID, "v1", "r1", ZONE);
    expect(res.status).toBe(200);
    expect(local(msFromTs(res.body.worldClock), ZONE)).toBe("Friday 08:40");
    const state = await stateOf(rig.store, UID);
    expect(state).toMatchObject({ currentZone: ZONE, homeZone: ZONE, clockMode: "fixture" });
  });

  it("a later reset follows the zone the browser sends now", async () => {
    const rig = testRig();
    expect((await resetFresh(rig, UID, "v1", "r1", ZONE)).status).toBe(200);
    const res = await resetFresh(rig, UID, "v2", "r2", "Asia/Tokyo");
    expect(local(msFromTs(res.body.worldClock), "Asia/Tokyo")).toBe("Friday 08:40");
    expect((await stateOf(rig.store, UID)).currentZone).toBe("Asia/Tokyo");
  });

  it("refuses a missing or unknown zone, and writes no core documents", async () => {
    const rig = testRig();
    const base = { requestId: testId("r1"), sessionId: null, fixtureId: PERSONA_FIXTURE_ID, visitId: testId("v1") };
    for (const body of [base, { ...base, clientZone: "Mars/Olympus" }, { ...base, clientZone: "" }]) {
      const res = await callRoute(rig, seedResetRoute, body, { token: `token:${UID}` });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("PARSE");
    }
    expect(await rig.store.get(UID, `users/${UID}/core/state`)).toBeNull();
  });
});
