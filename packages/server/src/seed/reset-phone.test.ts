// Brief 038 finding 10: a reset is refused with 423 while a phone call of this user is still out, so the call's
// ledger row is never deleted under it. The refusal writes nothing.
import { type CoreEpoch, tsFromMs } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import type { PhoneEntry } from "../phone/outbound";
import type { CallStatus } from "../phone/status";
import { seedResetRouteWith } from "../routes/seed-reset";
import { cFields } from "../records";
import { paths } from "../store/paths";
import { TEST_ENV, type TestRig, callRoute, testRig as plainRig } from "../testing/fakes";
import { SMALL_FIXTURE_ID, resetBody, resetFresh, snapshotOf } from "../testing/seed";
import { PHONE_OUT_MS } from "./phone-out";

const UID = "owner-1";
// Test-only Twilio settings, as phone/status.test.ts uses: the reset asks Twilio about a placed call.
const ENV = {
  ...TEST_ENV,
  TWILIO_ACCOUNT_SID: "AC" + "1".repeat(32),
  TWILIO_AUTH_TOKEN: "test-token",
  TWILIO_PHONE_NUMBER: "+14155550100",
  OPENAI_PROJECT_ID: "proj_test",
  OPENAI_WEBHOOK_SECRET: "test-secret",
};
const testRig = () => plainRig(ENV);
const ZONE = "America/Chicago";

async function phoneRow(rig: TestRig, label: string, state: PhoneEntry["state"], sid: string | null): Promise<void> {
  const epoch = (await rig.store.get<CoreEpoch>(UID, paths.core(UID, "epoch")))!.data;
  const at = tsFromMs(rig.clock.read().opsClock.now);
  const id = testId(label);
  const row: PhoneEntry = {
    ...cFields(UID, at, epoch.epoch, epoch.policyRev),
    kind: "phoneCall",
    state,
    at,
    retainUntil: null,
    payload: { phoneCallId: id, sessionId: testId("s"), turnId: testId("t"), twilioSid: sid, realtimeCallId: null, accepted: true },
  };
  await rig.store.transaction(UID, async (tx) => tx.create(paths.ledger(UID, id), row));
}

const reset = (rig: TestRig, status: CallStatus, visit: string, request: string) =>
  callRoute(rig, seedResetRouteWith(status), resetBody(visit, request, ZONE, SMALL_FIXTURE_ID));

const SID = "CA" + "a".repeat(32);

describe("a reset while a phone call is out (brief 038 finding 10)", () => {
  it("is refused with 423 BARRIER while Twilio says the call is live, writing nothing; allowed once it ended", async () => {
    const rig = testRig();
    await resetFresh(rig, UID, "v1", "r1", ZONE, SMALL_FIXTURE_ID);
    await phoneRow(rig, "call-1", "complete", SID);
    const before = await snapshotOf(rig.store, UID);
    const asked: string[] = [];
    const live: CallStatus = async (_c, sid) => (asked.push(sid), "in-progress");
    const refused = await reset(rig, live, "v2", "r2");
    expect([refused.status, refused.body.error]).toEqual([423, "BARRIER"]);
    expect(asked).toEqual([SID]);
    expect(await snapshotOf(rig.store, UID)).toEqual(before);
    expect((await reset(rig, async () => "completed", "v3", "r3")).status).toBe(200);
  });

  it("fails closed: a call still dialing, a dial never confirmed, or a status that cannot be read refuses the reset", async () => {
    for (const [state, sid, status] of [
      ["pending", null, async () => "completed"],
      ["blocked", null, async () => "completed"],
      ["complete", SID, async () => Promise.reject(new Error("Twilio down"))],
    ] as const) {
      const rig = testRig();
      await resetFresh(rig, UID, "v1", "r1", ZONE, SMALL_FIXTURE_ID);
      await phoneRow(rig, "call-1", state, sid);
      const refused = await reset(rig, status as CallStatus, "v2", "r2");
      expect([state, refused.status, refused.body.error]).toEqual([state, 423, "BARRIER"]);
    }
  });

  it("a failed dial, or a call older than the longest call, does not hold the reset", async () => {
    const never: CallStatus = async () => {
      throw new Error("not asked");
    };
    const rig = testRig();
    await resetFresh(rig, UID, "v1", "r1", ZONE, SMALL_FIXTURE_ID);
    await phoneRow(rig, "call-failed", "failed", null);
    expect((await reset(rig, never, "v2", "r2")).status).toBe(200);
    await phoneRow(rig, "call-old", "complete", SID);
    rig.clock.advance(PHONE_OUT_MS + 1);
    expect((await reset(rig, never, "v3", "r3")).status).toBe(200);
  });

  it("without Twilio's settings the status of a placed call cannot be read, so the reset is refused", async () => {
    const rig = plainRig();
    await resetFresh(rig, UID, "v1", "r1", ZONE, SMALL_FIXTURE_ID);
    await phoneRow(rig, "call-1", "complete", SID);
    expect((await reset(rig, async () => "completed", "v2", "r2")).status).toBe(423);
  });
});
