import { type Ledger, type Moment, type Stamp } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { paths } from "../store/paths";
import { callRoute, testRig } from "../testing/fakes";
import { resetAs } from "../testing/seed";
import { memoryTick, scanMoments } from "../time/tick";
import { deliveryEntryId } from "../time/said";
import { renderedEntryId } from "../time/reminder";
import { openRoute } from "./open";
import { receiptRoute } from "./receipt";

const UID = "owner-1";
const ZONE = "America/Chicago";
const WISH = "Good luck at 2 PM: Tessellate Labs final interview.";

async function setup() {
  const rig = testRig();
  await resetAs(rig, UID, "v1", "r1", ZONE);
  const ctx = { uid: UID, deps: rig.deps, schedule: () => undefined };
  await memoryTick(ctx);
  const open = await callRoute(rig, openRoute, { requestId: testId("open1"), initiator: "user", previousSessionId: null, clientZone: ZONE, visitId: null }, { token: `token:${UID}` });
  expect(open.status).toBe(200);
  const d = open.body.deck;
  const stamp: Stamp = { sessionId: open.body.sessionId, epoch: d.epoch, policyRev: d.policyRev, bundleRev: d.bundleRev, rulesRev: d.rulesRev, generation: 1, turnId: testId("turn-0") };
  const all = async () => new Map(((await scanMoments({ get: (p) => rig.store.get(UID, p), query: (q) => rig.store.query(UID, q) }, UID)) ?? []).map((d) => [d.id, d.data as Moment]));
  const wishId = [...(await all()).entries()].find(([, m]) => m.kind === "wish")![0];
  let n = 0;
  const receipt = (o: Record<string, unknown>) =>
    callRoute(rig, receiptRoute, { requestId: testId(`rc${++n}`), stamp, responseId: "resp_1", kind: "transcript", momentIds: [], noteIds: [], pendingId: null, permitKind: null, text: null, ...o }, { token: `token:${UID}` });
  return { rig, wishId, all, receipt };
}

describe("POST /api/receipt: moments (brief 030 P1-6)", () => {
  it("an admitted receipt under a proactive Permit admits the moment; only a matching transcript sets saidAt, with one delivery row", async () => {
    const { rig, wishId, all, receipt } = await setup();
    expect((await all()).get(wishId)!.status).toBe("leased");
    const adm = await receipt({ kind: "admitted", momentIds: [wishId], permitKind: "proactive" });
    expect(adm.body).toEqual({ accepted: true, controlCheck: "none" });
    expect((await all()).get(wishId)).toMatchObject({ status: "admitted", responseId: "resp_1" });

    // Another response's words never say this one's moment.
    await receipt({ responseId: "resp_2", momentIds: [wishId], text: WISH });
    expect((await all()).get(wishId)!.saidAt).toBeNull();

    await receipt({ momentIds: [wishId], text: WISH });
    const m = (await all()).get(wishId)!;
    expect(m).toMatchObject({ status: "delivered", saidMatch: "exactTemplate" });
    expect(m.saidAt).not.toBeNull();
    const row = await rig.store.get<Ledger>(UID, paths.ledger(UID, deliveryEntryId(rig.deps.hasher, wishId, "resp_1")));
    expect(row?.data).toMatchObject({ kind: "delivery", payload: { momentId: wishId, permitKind: "proactive" } });
  });

  it("a transcript that doesn't match leaves saidAt null and writes no delivery row", async () => {
    const { rig, wishId, all, receipt } = await setup();
    await receipt({ kind: "admitted", momentIds: [wishId], permitKind: "proactive" });
    expect((await receipt({ momentIds: [wishId], text: "Hi there." })).body.accepted).toBe(true);
    expect((await all()).get(wishId)).toMatchObject({ status: "admitted", saidAt: null });
    expect(await rig.store.get(UID, paths.ledger(UID, deliveryEntryId(rig.deps.hasher, wishId, "resp_1")))).toBeNull();
  });

  it("an admitted receipt under any other Permit admits nothing", async () => {
    const { wishId, all, receipt } = await setup();
    await receipt({ kind: "admitted", momentIds: [wishId], permitKind: "reply" });
    expect((await all()).get(wishId)!.status).toBe("leased");
  });

  it("a pendingRendered receipt records the render once", async () => {
    const { rig, receipt } = await setup();
    const pendingId = testId("pending-1");
    await receipt({ kind: "pendingRendered", pendingId });
    expect(await rig.store.get(UID, paths.ledger(UID, renderedEntryId(rig.deps.hasher, pendingId as never)))).not.toBeNull();
  });
});
