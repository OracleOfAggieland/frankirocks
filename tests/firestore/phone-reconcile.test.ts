import { randomUUID } from "node:crypto";
import { tsFromMs } from "@franki/core";
import { testId } from "@franki/core/testing";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, expect, it, vi } from "vitest";
import { type PhoneEntry } from "../../packages/server/src/phone/outbound";
import { reconcileDuePhoneCalls } from "../../packages/server/src/phone/reconcile-live";
import { cFields } from "../../packages/server/src/records";
import { paths } from "../../packages/server/src/store/paths";

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Run with the Firestore emulator");
const app = initializeApp({ projectId: "demo-franki" }, "phone-reconciliation");
const db = getFirestore(app);
afterAll(() => deleteApp(app));

it("recovers missed carrier callbacks across tenants without a browser, and leaves future and settled calls alone", async () => {
  const now = () => 60_000;
  const at = tsFromMs(0);
  const uids = [randomUUID(), randomUUID()];
  const seed = async (i: number, nextCarrierCheckAt: string | null) => {
    const uid = uids[i % 2]!;
    const dialId = testId(`scheduled-call-${i}`);
    const ref = db.doc(paths.ledger(uid, dialId));
    const sid = "CA" + String(i).repeat(32);
    await ref.set({
      ...cFields(uid, at, 0, 0), kind: "phoneCall", at, state: "complete", retainUntil: null,
      payload: { sessionId: testId("session"), turnId: testId("turn"), phoneCallId: dialId,
        twilioSid: sid, realtimeCallId: null, accepted: true, nextCarrierCheckAt,
        carrier: { status: nextCarrierCheckAt === null ? "completed" : "in-progress", observedAt: at } },
    } satisfies PhoneEntry);
    return { ref, sid };
  };
  const [first, second, future, ended] = await Promise.all([seed(0, at), seed(1, at), seed(2, tsFromMs(now() + 1)), seed(3, null)]);
  const config = { account: "account", token: "test", hmacKey: "test" };
  const read = vi.fn(async (_credentials: { account: string; token: string }, id: string) => id === first.sid ? "completed" : "busy");
  try {
    await reconcileDuePhoneCalls(db, config, now, read);
    await reconcileDuePhoneCalls(db, config, now, read);
    expect(read.mock.calls.map(([, id]) => id).sort()).toEqual([first.sid, second.sid].sort());
    expect((await first.ref.get()).data()?.payload).toMatchObject({ carrier: { status: "completed" }, nextCarrierCheckAt: null });
    expect((await second.ref.get()).data()?.payload).toMatchObject({ carrier: { status: "busy" }, nextCarrierCheckAt: null });
    expect((await future.ref.get()).data()?.rev).toBe(1);
    expect((await ended.ref.get()).data()?.rev).toBe(1);
  } finally {
    await Promise.all([first, second, future, ended].map(({ ref }) => ref.delete()));
  }
});
