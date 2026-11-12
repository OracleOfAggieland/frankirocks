// Brief 036: the reviewer's sequences, one block per finding, on the server path.
import { type CoreCounters, type Memory, type Moment, civilDateAt, msFromTs, tsFromMs } from "@franki/core";
import { sampleTurn, testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import type { RouteContext } from "../routes/runtime";
import { paths } from "../store/paths";
import type { Tx } from "../store/port";
import { type TestRig, patchRecord, testRig } from "../testing/fakes";
import { resetAs, stateOf } from "../testing/seed";
import { chooseNow, proactiveOf } from "./proactive";
import { admitMoment, admitMoments, deliveryEntryId, recordSaid } from "./said";
import { momentNoteId } from "./verdict";
import { confirmReminder, offerReminder, recordPendingRendered } from "./reminder";
import { momentsOf, moveOccasion, ofKind, setWorld } from "./testing";
import { memoryTick } from "./tick";

const UID = "owner-1";
const ZONE = "America/Chicago";
const HOUR = 3_600_000;
const MINUTE = 60_000;
const STAMP = { sessionId: testId("s"), epoch: 2, policyRev: 1, bundleRev: 1, rulesRev: 1, generation: 1, turnId: testId("t") };
const QUIET = { transitionOrCrisis: false, turnsSinceCheckInAnswer: null };

async function clone(): Promise<{ rig: TestRig; ctx: RouteContext }> {
  const rig = testRig();
  await resetAs(rig, UID, "v1", "r1", ZONE);
  return { rig, ctx: { uid: UID, deps: rig.deps, schedule: () => undefined } };
}
const tx = <T>(rig: TestRig, fn: (t: Tx) => Promise<T>) => rig.store.transaction(UID, fn);

/** The wish now chosen for a session opening, on the wire. */
async function wishOnWire(ctx: RouteContext, rig: TestRig) {
  const { choice, moments } = await chooseNow(ctx, { kind: "opening" }, QUIET);
  const wishId = ofKind(await momentsOf(rig, UID), "wish")[0]![0];
  if (choice.spoken?.momentId !== wishId) return null;
  return proactiveOf(ctx, wishId as never, moments.get(wishId as never)!, STAMP);
}
const interviewId = async (rig: TestRig) => {
  const wish = ofKind(await momentsOf(rig, UID), "wish")[0]![1];
  return wish.payload.kind === "cue" ? wish.payload.noteRef.id : "";
};
/** A playback start for the moment's response, once that seam exists (finding 14); a no-op before. */
async function playback(_rig: TestRig, _momentId: string, _responseId: string): Promise<void> {}
const admit = (rig: TestRig, momentId: string, responseId: string, noteIds: string[]) =>
  tx(rig, (t) => admitMoment(t, UID, momentId as never, { responseId, noteIds }, rig.deps));

describe("finding 1: a moved occasion speaks its new time and keeps its wish", () => {
  it("a wish leased at 08:40 for 2 PM, then the interview moves to 16:00: the next tick re-plans it for 4 PM", async () => {
    const { rig, ctx } = await clone();
    await memoryTick(ctx);
    const before = await wishOnWire(ctx, rig);
    expect(before?.whisper.text).toBe("Good luck at 2 PM: Tessellate Labs final interview.");
    const old = await interviewId(rig);
    const start = msFromTs((await rig.store.get<Memory>(UID, paths.memory(UID, old)))!.data.time!.start);
    const moved = await moveOccasion(rig, UID, old, testId("interview-moved"), start + 2 * HOUR);
    await memoryTick(ctx);
    const [[wishId, wish]] = ofKind(await momentsOf(rig, UID), "wish") as [[string, Moment]];
    expect(wish.payload).toMatchObject({ kind: "cue", noteRef: { id: moved }, template: { text: "Good luck at 4 PM: Tessellate Labs final interview." } });
    const after = await wishOnWire(ctx, rig);
    expect(after?.whisper.text).toBe("Good luck at 4 PM: Tessellate Labs final interview.");
    // The permit issued for the old lease no longer admits; the new one does, once.
    expect(await admit(rig, wishId, "resp_old", [before!.whisper.noteId])).toBe(false);
    expect(await admit(rig, wishId, "resp_new", [after!.whisper.noteId])).toBe(true);
    expect(await admit(rig, wishId, "resp_again", [after!.whisper.noteId])).toBe(false);
  });

  it("a lease that expires after the move reopens the wish at its new time; it is never cancelled", async () => {
    const { rig, ctx } = await clone();
    await memoryTick(ctx);
    const old = await interviewId(rig);
    const start = msFromTs((await rig.store.get<Memory>(UID, paths.memory(UID, old)))!.data.time!.start);
    await moveOccasion(rig, UID, old, testId("interview-moved"), start + 2 * HOUR);
    rig.clock.advance(16 * MINUTE);
    await memoryTick(ctx);
    const [[, wish]] = ofKind(await momentsOf(rig, UID), "wish") as [[string, Moment]];
    expect(wish.status).toBe("leased");
    expect(wish.payload).toMatchObject({ template: { text: "Good luck at 4 PM: Tessellate Labs final interview." } });
  });

  it("admission rereads the source: a wish whose occasion moved since it was put on the wire is refused", async () => {
    const { rig, ctx } = await clone();
    await memoryTick(ctx);
    const p = await wishOnWire(ctx, rig);
    const old = await interviewId(rig);
    const start = msFromTs((await rig.store.get<Memory>(UID, paths.memory(UID, old)))!.data.time!.start);
    await moveOccasion(rig, UID, old, testId("interview-moved"), start + 2 * HOUR);
    const wishId = ofKind(await momentsOf(rig, UID), "wish")[0]![0];
    expect(await admit(rig, wishId, "resp_1", [p!.whisper.noteId])).toBe(false);
    expect((await momentsOf(rig, UID)).get(wishId)?.status).toBe("leased");
    expect((await stateOf(rig.store, UID)).worldClock).not.toBeNull();
  });
});

describe("finding 5: the day's caps hold at admission", () => {
  it("with speech 3 and heavy 1 already today, admitting a wish is refused and the count stays 3", async () => {
    const { rig, ctx } = await clone();
    await memoryTick(ctx);
    const p = await wishOnWire(ctx, rig);
    const counters = await rig.store.get<CoreCounters>(UID, paths.core(UID, "counters"));
    const world = (await stateOf(rig.store, UID)).worldClock!;
    const day = civilDateAt(msFromTs(world), ZONE);
    await patchRecord<CoreCounters>(rig.store, UID, paths.core(UID, "counters"), { day, heavy: 1, counts: [...counters!.data.counts.filter((c) => c.kind !== "speech"), { kind: "speech", count: 3 }] });
    const wishId = ofKind(await momentsOf(rig, UID), "wish")[0]![0];
    expect(await admit(rig, wishId, "resp_1", [p!.whisper.noteId])).toBe(false);
    const after = await rig.store.get<CoreCounters>(UID, paths.core(UID, "counters"));
    expect(after?.data.counts).toContainEqual({ kind: "speech", count: 3 });
    expect((await momentsOf(rig, UID)).get(wishId)?.status).toBe("leased");
  });
});

describe("finding 6: the hero insight can be marked said", () => {
  it("an insight admitted on a response whose transcript is the exact offer line is said, with its ledger row", async () => {
    const { rig, ctx } = await clone();
    await memoryTick(ctx);
    const [[insightId, insight]] = ofKind(await momentsOf(rig, UID), "insight") as [[string, Moment]];
    const p = (await proactiveOf(ctx, insightId as never, insight, STAMP))!;
    expect(p.whisper.text).toMatch(/takeout/);
    expect(await admit(rig, insightId, "resp_hero", [p.whisper.noteId])).toBe(true);
    const receipt = { kind: "transcript" as const, responseId: "resp_hero", momentIds: [insightId], noteIds: [p.whisper.noteId], text: p.whisper.text };
    await playback(rig, insightId, "resp_hero");
    const match = await tx(rig, (t) => recordSaid(t, UID, insightId as never, receipt, "proactive", rig.clock, rig.deps.hasher));
    expect(match).not.toBeNull();
    expect(await rig.store.get(UID, paths.ledger(UID, deliveryEntryId(rig.deps.hasher, insightId, "resp_hero")))).not.toBeNull();
  });
});

describe("finding 8: a confirmed reminder due within 24 hours is mustSay", () => {
  it("\"Remind me at 22:00\" plays at 22:00, in quiet hours and past the day's cap", async () => {
    const { rig, ctx } = await clone();
    const world = msFromTs((await stateOf(rig.store, UID)).worldClock!);
    await memoryTick(ctx);
    const sourceId = await interviewId(rig);
    const offer = offerReminder(rig.deps.hasher, { sourceId, note: "Call the vet", spoken: "tonight at 10 PM", worldNow: world, zone: ZONE })!;
    expect(offer).not.toBeNull();
    await tx(rig, (t) => recordPendingRendered(t, UID, offer.pendingId, rig.clock.read().opsClock.now, rig.deps.hasher));
    rig.clock.advance(MINUTE);
    const yes = sampleTurn({ text: "Yes.", sourceClass: "U", final: true, role: "user", committedAt: tsFromMs(rig.clock.read().opsClock.now) });
    const applied = await confirmReminder(ctx, offer, offer.yesId, yes);
    expect(applied.state).toBe("applied");
    if (applied.state !== "applied") return;
    await setWorld(rig, UID, msFromTs(offer.time.start));
    const counters = await rig.store.get<CoreCounters>(UID, paths.core(UID, "counters"));
    await patchRecord<CoreCounters>(rig.store, UID, paths.core(UID, "counters"), { day: civilDateAt(msFromTs(offer.time.start), ZONE), heavy: 1, counts: [...counters!.data.counts.filter((c) => c.kind !== "speech"), { kind: "speech", count: 3 }] });
    await memoryTick(ctx);
    const { choice, moments } = await chooseNow(ctx, { kind: "opening" }, QUIET);
    expect(choice.spoken?.momentId).toBe(applied.momentId);
    const p = (await proactiveOf(ctx, applied.momentId, moments.get(applied.momentId)!, STAMP))!;
    expect(await admit(rig, applied.momentId, "resp_rem", [p.whisper.noteId])).toBe(true);
  });
});

describe("finding 9: a reminder's confirmation is bound to its rendered offer", () => {
  it("a swapped note or time under the same pending ID, a yes at the render's instant, and a yes after a no are all refused", async () => {
    const { rig, ctx } = await clone();
    await memoryTick(ctx);
    const world = msFromTs((await stateOf(rig.store, UID)).worldClock!);
    const offer = offerReminder(rig.deps.hasher, { sourceId: await interviewId(rig), note: "Bring the portfolio", spoken: "tomorrow at 9", worldNow: world, zone: ZONE })!;
    const later = offerReminder(rig.deps.hasher, { sourceId: offer.sourceId, note: "Bring the portfolio", spoken: "tomorrow at 10", worldNow: world, zone: ZONE })!;
    const ops = rig.clock.read().opsClock.now;
    await tx(rig, (t) => recordPendingRendered(t, UID, offer.pendingId, ops, rig.deps.hasher));
    const yesAt = (ms: number) => sampleTurn({ text: "Yes.", sourceClass: "U", final: true, role: "user", committedAt: tsFromMs(ms) });
    expect(await confirmReminder(ctx, offer, offer.yesId, yesAt(ops))).toEqual({ state: "stale" });
    expect(await confirmReminder(ctx, { ...offer, note: "Wire the money" }, offer.yesId, yesAt(ops + MINUTE))).toEqual({ state: "stale" });
    expect(await confirmReminder(ctx, { ...offer, time: later.time }, offer.yesId, yesAt(ops + MINUTE))).toEqual({ state: "stale" });
    expect(await confirmReminder(ctx, offer, offer.noId, yesAt(ops + MINUTE))).toEqual({ state: "declined" });
    expect(await confirmReminder(ctx, offer, offer.yesId, yesAt(ops + 2 * MINUTE))).toEqual({ state: "stale" });
  });
});

describe("finding 10: a reminder never fires after its source is corrected", () => {
  it("the action keeps its source's lineage; corrected before it is due, the reminder is cancelled at open", async () => {
    const { rig, ctx } = await clone();
    await memoryTick(ctx);
    const world = msFromTs((await stateOf(rig.store, UID)).worldClock!);
    const sourceId = await interviewId(rig);
    const offer = offerReminder(rig.deps.hasher, { sourceId, note: "Bring the portfolio", spoken: "tomorrow at 9", worldNow: world, zone: ZONE })!;
    await tx(rig, (t) => recordPendingRendered(t, UID, offer.pendingId, rig.clock.read().opsClock.now, rig.deps.hasher));
    rig.clock.advance(MINUTE);
    const applied = await confirmReminder(ctx, offer, offer.yesId, sampleTurn({ text: "Yes.", sourceClass: "U", final: true, role: "user", committedAt: tsFromMs(rig.clock.read().opsClock.now) }));
    if (applied.state !== "applied") throw new Error(applied.state);
    const action = await rig.store.get<{ dependsOn: string[] }>(UID, paths.ledger(UID, applied.actionId));
    expect(action?.data.dependsOn).toEqual([`m:${sourceId}@1`]);
    await patchRecord<Memory>(rig.store, UID, paths.memory(UID, sourceId), { status: "wrong" });
    await setWorld(rig, UID, msFromTs(offer.time.start));
    await memoryTick(ctx);
    expect((await momentsOf(rig, UID)).get(applied.momentId)).toMatchObject({ status: "cancelled" });
  });
});

describe("admitMoments shares admitMoment's checks (brief 030's receipt seam)", () => {
  it("one receipt naming two open moments with room for one admits one; a stale note admits none", async () => {
    const { rig, ctx } = await clone();
    await memoryTick(ctx);
    const all = await momentsOf(rig, UID);
    const open = [...all.entries()].filter(([, m]) => m.status === "leased");
    expect(open.length).toBeGreaterThanOrEqual(2);
    const ids = open.map(([id]) => id as never);
    const noteIds = open.map(([id, m]) => momentNoteId(rig.deps.hasher, id, m));
    expect(await tx(rig, (t) => admitMoments(t, UID, ids, { responseId: "resp_x", noteIds: ["stale"] }, rig.deps))).toEqual([]);
    const counters = await rig.store.get<CoreCounters>(UID, paths.core(UID, "counters"));
    const day = civilDateAt(msFromTs((await stateOf(rig.store, UID)).worldClock!), ZONE);
    await patchRecord<CoreCounters>(rig.store, UID, paths.core(UID, "counters"), { day, heavy: 0, counts: [...counters!.data.counts.filter((c) => c.kind !== "speech"), { kind: "speech", count: 2 }] });
    expect(await tx(rig, (t) => admitMoments(t, UID, ids, { responseId: "resp_y", noteIds }, rig.deps))).toHaveLength(1);
  });
});

describe("finding 12: a wish retired by a move is revived when the occasion moves back ahead", () => {
  it("interview moved to 07:00 (wish skipped), then back to 14:00: the wish opens again for 2 PM", async () => {
    const { rig, ctx } = await clone();
    await memoryTick(ctx);
    const first = await interviewId(rig);
    const start = msFromTs((await rig.store.get<Memory>(UID, paths.memory(UID, first)))!.data.time!.start);
    const early = await moveOccasion(rig, UID, first, testId("interview-early"), start - 7 * HOUR);
    await memoryTick(ctx);
    expect(ofKind(await momentsOf(rig, UID), "wish")[0]![1].status).toBe("skipped");
    await moveOccasion(rig, UID, early, testId("interview-back"), start);
    await memoryTick(ctx);
    const [[, wish]] = ofKind(await momentsOf(rig, UID), "wish") as [[string, Moment]];
    expect(wish.status).toBe("leased");
    expect(wish.payload).toMatchObject({ template: { text: "Good luck at 2 PM: Tessellate Labs final interview." } });
  });
});
