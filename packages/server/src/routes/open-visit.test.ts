import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { callRoute, testRig } from "../testing/fakes";
import { resetAs } from "../testing/seed";
import { openRoute } from "./open";

const UID = "owner-1";
const open = (rig: ReturnType<typeof testRig>, label: string, visitId: string | null) =>
  callRoute(rig, openRoute, { requestId: testId(label), initiator: "user", previousSessionId: null, clientZone: "America/Chicago", visitId }, { token: `token:${UID}` });

describe("POST /api/session/open: the visit (brief 030 P1-8)", () => {
  it("opens on the clone its visit names; a tab of another visit is STALE and opens nothing", async () => {
    const rig = testRig();
    await resetAs(rig, UID, "v1", "r1");
    expect((await open(rig, "o1", testId("visit-v1"))).body.state).toBe("connecting");
    const stale = await open(rig, "o2", testId("visit-v0"));
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe("STALE");
    // The voice machine still sends null; a null visit opens on whatever clone the account holds.
    expect((await open(rig, "o3", null)).body.state).toBe("connecting");
  });

  it("an account that is not a clone refuses any named visit", async () => {
    const rig = testRig();
    expect((await open(rig, "o1", testId("visit-v1"))).status).toBe(409);
    expect((await open(rig, "o2", null)).body.state).toBe("connecting");
  });
});
