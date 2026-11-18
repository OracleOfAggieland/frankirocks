import { tsFromMs } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it, vi } from "vitest";
import { cFields } from "../records";
import { paths } from "../store/paths";
import { TEST_ENV, testRig } from "../testing/fakes";
import { phoneCallLine, PHONE_AWARE_LIVE_MS } from "./aware";
import { advanceCarrier, PHONE_CARRIER_RETRY_MS, storedPhoneStatus } from "./lifecycle";
import type { PhoneEntry } from "./outbound";
import { PHONE_RECONCILE_WINDOW_MS, reconcilePhoneCall, schedulePhoneCheck } from "./reconcile";

const uid = "owner-1";
const dialId = testId("dial");
const sid = "CA" + "a".repeat(32);
const path = paths.ledger(uid, dialId);
const env = { ...TEST_ENV, TWILIO_ACCOUNT_SID: "AC" + "a".repeat(32), TWILIO_AUTH_TOKEN: "test", TWILIO_PHONE_NUMBER: "+14155550100",
  OPENAI_PROJECT_ID: "proj_test", OPENAI_WEBHOOK_SECRET: "test", FRANKI_PHONE_REPORT_ORIGIN: "https://frankirocks.com" };

async function setup() {
  const rig = testRig(env);
  const now = () => rig.clock.read().opsClock.now;
  const at = tsFromMs(now());
  const row: PhoneEntry = {
    ...cFields(uid, at, 1, 1), kind: "phoneCall", state: "complete", at, retainUntil: null,
    payload: { sessionId: testId("session"), turnId: testId("turn"), twilioSid: sid, realtimeCallId: null, accepted: true },
  };
  await rig.store.transaction(uid, async (tx) => tx.create(path, row));
  const get = async () => (await rig.store.get<PhoneEntry>(uid, path))!.data;
  return { rig, row, now, get };
}

describe("background carrier reconciliation", () => {
  it("enrolls a legacy dial after the request returns, and lets only one worker check it", async () => {
    const { rig, row, now, get } = await setup();
    const read = vi.fn().mockResolvedValue("ringing");
    rig.deps.callStatus = read;
    const ctx = { uid, deps: rig.deps, schedule: rig.sched.schedule };
    schedulePhoneCheck(ctx, dialId, row);
    expect(read).not.toHaveBeenCalled();
    await Promise.all([rig.sched.runAll(), reconcilePhoneCall(rig.store, uid, dialId, now, (id) => read({}, id))]);
    expect(read).toHaveBeenCalledTimes(1);
    expect((await get()).payload).toMatchObject({ carrier: { status: "ringing" }, nextCarrierCheckAt: tsFromMs(now() + PHONE_CARRIER_RETRY_MS) });
    rig.clock.advance(PHONE_CARRIER_RETRY_MS);
    await reconcilePhoneCall(rig.store, uid, dialId, now, async () => "no-answer");
    expect((await get()).payload).toMatchObject({ carrier: { status: "no-answer" }, nextCarrierCheckAt: null });
    schedulePhoneCheck(ctx, dialId, await get());
    expect(rig.sched.pending).toBe(0);
  });

  it("backs off a failed read and keeps the last observation until a retry succeeds", async () => {
    const { rig, now, get } = await setup();
    await reconcilePhoneCall(rig.store, uid, dialId, now, async () => "in-progress");
    rig.clock.advance(PHONE_CARRIER_RETRY_MS);
    const read = vi.fn().mockRejectedValueOnce(new Error("timeout")).mockResolvedValue("completed");
    expect(await reconcilePhoneCall(rig.store, uid, dialId, now, read)).toBe("unavailable");
    expect((await get()).payload).toMatchObject({ carrier: { status: "in-progress" } });
    rig.clock.advance(PHONE_CARRIER_RETRY_MS);
    expect(await reconcilePhoneCall(rig.store, uid, dialId, now, read)).toBe("skipped");
    rig.clock.advance(4 * PHONE_CARRIER_RETRY_MS);
    expect(await reconcilePhoneCall(rig.store, uid, dialId, now, read)).toBe("checked");
    expect((await get()).payload).toMatchObject({ carrier: { status: "completed" }, nextCarrierCheckAt: null });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("keeps a verified long call visible and ignores earlier phases and replayed callbacks", async () => {
    const { rig, row, now, get } = await setup();
    const poll = (status: string) => reconcilePhoneCall(rig.store, uid, dialId, now, async () => status);
    await poll("in-progress");
    rig.clock.advance(PHONE_AWARE_LIVE_MS + 1);
    await poll("in-progress");
    const checkedAt = tsFromMs(now());
    const active = await get();
    expect(active.payload).toMatchObject({ carrier: { status: "in-progress", observedAt: checkedAt } });
    expect(await phoneCallLine({ uid, deps: rig.deps, schedule: rig.sched.schedule }, row.payload.sessionId)).toContain("connected");
    rig.clock.advance(PHONE_CARRIER_RETRY_MS);
    expect(advanceCarrier(active, "in-progress", now())).toBe(active);
    await poll("ringing");
    expect((await get()).payload).toMatchObject({ carrier: { status: "in-progress", observedAt: checkedAt } });
    rig.clock.advance(PHONE_CARRIER_RETRY_MS);
    await poll("completed");
    const ended = await get();
    rig.clock.advance(PHONE_CARRIER_RETRY_MS);
    expect(advanceCarrier(ended, "completed", now(), "poll")).toBe(ended);
  });

  it("keeps an intervening terminal callback and never polls another owner", async () => {
    const { rig, now, get } = await setup();
    const read = vi.fn(async () => {
      await rig.store.transaction(uid, async (tx) => {
        const doc = (await tx.get<PhoneEntry>(path))!;
        tx.update(path, advanceCarrier(doc.data, "completed", now()));
      });
      return "ringing";
    });
    expect(await reconcilePhoneCall(rig.store, "other", dialId, now, read)).toBe("skipped");
    expect(read).not.toHaveBeenCalled();
    await reconcilePhoneCall(rig.store, uid, dialId, now, read);
    expect((await get()).payload).toMatchObject({ carrier: { status: "completed" }, nextCarrierCheckAt: null });
  });

  it("stops polling a permanently unavailable call, and a later callback can still finish it", async () => {
    const { rig, now, get } = await setup();
    await reconcilePhoneCall(rig.store, uid, dialId, now, async () => "in-progress");
    rig.clock.advance(PHONE_RECONCILE_WINDOW_MS);
    const read = vi.fn().mockRejectedValue(new Error("call record absent"));
    expect(await reconcilePhoneCall(rig.store, uid, dialId, now, read)).toBe("unavailable");
    expect(await reconcilePhoneCall(rig.store, uid, dialId, now, read)).toBe("skipped");
    const row = await get();
    expect(row.payload).toMatchObject({ carrier: { status: "in-progress" }, nextCarrierCheckAt: null });
    expect(storedPhoneStatus(row, now())).toBe("unknown");
    expect(storedPhoneStatus(advanceCarrier(row, "completed", now()), now())).toBe("ended");
  });
});
