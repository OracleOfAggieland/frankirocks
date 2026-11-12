// Brief 042 item 3 (finding 1): a reminder held under crisis is said late at the next line not under crisis, once,
// or, if none comes before its close, closes with a held row naming the reason.
import { type Ledger, type Session, msFromTs, tsFromMs } from "@franki/core";
import { sampleTurn, testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { idleProactive, openingProactive } from "../routes/delivery-wire";
import { openRoute } from "../routes/open";
import { receiptRoute } from "../routes/receipt";
import { paths } from "../store/paths";
import { callRoute, patchRecord, settle, testRig } from "../testing/fakes";
import { resetAs, stateOf } from "../testing/seed";
import { openTestSession } from "../testing/session-fixtures";
import { reminderHeldId } from "./held-reminder";
import { confirmReminder, offerReminder, recordPendingRendered } from "./reminder";
import { momentsOf, ofKind, setWorld } from "./testing";
import { memoryTick } from "./tick";

const UID = "owner-1";
const ZONE = "America/Chicago";
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const LATE = "You asked me to remind you about Call the vet at 10 PM. I held it.";

async function heldReminder() {
  const rig = testRig();
  await resetAs(rig, UID, "v1", "r1", ZONE);
  const ctx = { uid: UID, deps: rig.deps, schedule: () => undefined };
  const world = msFromTs((await stateOf(rig.store, UID)).worldClock!);
  await memoryTick(ctx);
  const wish = ofKind(await momentsOf(rig, UID), "wish")[0]![1];
  const sourceId = wish.payload.kind === "cue" ? wish.payload.noteRef.id : "";
  const offer = offerReminder(rig.deps.hasher, { sourceId, note: "Call the vet", spoken: "tonight at 10 PM", worldNow: world, zone: ZONE })!;
  await rig.store.transaction(UID, (t) => recordPendingRendered(t, UID, offer.pendingId, rig.clock.read().opsClock.now, rig.deps.hasher));
  rig.clock.advance(MINUTE);
  const yes = sampleTurn({ text: "Yes.", sourceClass: "U", final: true, role: "user", committedAt: tsFromMs(rig.clock.read().opsClock.now) });
  const applied = await confirmReminder(ctx, offer, offer.yesId, yes);
  if (applied.state !== "applied") throw new Error("no reminder");
  // A session opened earlier, then a crisis in it; the reminder comes due while it holds.
  const s1 = await openTestSession(rig, "o1", `token:${UID}`);
  await setWorld(rig, UID, msFromTs(offer.time.start) + MINUTE);
  await memoryTick(ctx);
  await patchRecord<Session>(rig.store, UID, paths.session(UID, s1.sessionId), { modifiers: { rushed: null, crisis: tsFromMs(rig.clock.read().opsClock.now) } });
  const held = await settle(openingProactive(ctx, s1.stamp, 3_000), rig.clock, rig.timers);
  return { rig, ctx, s1, held: held.value, momentId: applied.momentId, actionId: applied.actionId };
}

const gateRows = async (rig: ReturnType<typeof testRig>) =>
  (await rig.store.query<Ledger>(UID, { collection: paths.collection(UID, "ledger"), where: [], orderBy: { field: "__name__", dir: "asc" }, limit: 100 }))
    .filter((d) => d.data.kind === "gate")
    .map((d) => d.data.payload as { outcome: string; momentId: string | null; sessionId: string | null; turnId: string | null; reasonCodes: string[] });

describe("a reminder held under crisis (brief 042 item 3)", () => {
  it("held at its due time under crisis: nothing said, and the hold is recorded", async () => {
    const t = await heldReminder();
    expect(t.held).toBeNull();
    expect(await t.rig.store.get(UID, paths.ledger(UID, reminderHeldId(t.rig.deps.hasher, t.actionId)))).not.toBeNull();
  });

  it("the next opening not under crisis says it late, by template, once", async () => {
    const t = await heldReminder();
    t.rig.clock.advance(60 * MINUTE);
    const open = await callRoute(t.rig, openRoute, { requestId: testId("open2"), initiator: "user", previousSessionId: null, clientZone: ZONE, visitId: null }, { token: `token:${UID}` });
    const p = open.body.proactive;
    expect(p?.whisper.text).toBe(LATE);
    expect(p?.permit.momentIds).toEqual([t.momentId]);
    // Played and heard: said once, and not offered again.
    const base = { stamp: p.permit.stamp, responseId: "resp_late", momentIds: p.permit.momentIds, noteIds: p.permit.noteIds, pendingId: null, permitKind: null, text: null };
    let n = 0;
    const send = (o: Record<string, unknown>) => callRoute(t.rig, receiptRoute, { ...base, requestId: testId(`rc${++n}`), ...o }, { token: `token:${UID}` });
    await send({ kind: "admitted", permitKind: "proactive" });
    await send({ kind: "playbackStarted" });
    await send({ kind: "transcript", text: LATE });
    expect((await momentsOf(t.rig, UID)).get(t.momentId)!.saidAt).not.toBeNull();
    t.rig.clock.advance(60 * MINUTE);
    await memoryTick(t.ctx);
    const again = await callRoute(t.rig, openRoute, { requestId: testId("open3"), initiator: "user", previousSessionId: null, clientZone: ZONE, visitId: null }, { token: `token:${UID}` });
    expect(again.body.proactive?.permit.momentIds ?? []).not.toContain(t.momentId);
  });

  it("no line comes before its close: it closes with a held row naming crisis", async () => {
    const t = await heldReminder();
    for (let d = 0; d < 32; d++) {
      t.rig.clock.advance(DAY);
      await setWorld(t.rig, UID, (await stateOf(t.rig.store, UID)).worldClock === null ? 0 : msFromTs((await stateOf(t.rig.store, UID)).worldClock!) + DAY);
      await memoryTick(t.ctx);
      // Still under crisis at each idle poll.
      await settle(idleProactive(t.ctx, t.s1.stamp), t.rig.clock, t.rig.timers);
    }
    expect((await momentsOf(t.rig, UID)).get(t.momentId)!.status).toBe("expired");
    const atClose = (await gateRows(t.rig)).filter((r) => r.momentId === t.momentId && r.turnId === null);
    expect(atClose).toHaveLength(1);
    expect(atClose[0]!.outcome).toBe("held");
    expect(atClose[0]!.reasonCodes).toContain("crisis");
  });
});
