// Brief 036: the reviewer's sequences, one block per finding, on the server path.
import { type CoreCounters, type Memory, type Moment, civilDateAt, msFromTs } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import type { RouteContext } from "../routes/runtime";
import { paths } from "../store/paths";
import type { Tx } from "../store/port";
import { type TestRig, patchRecord, testRig } from "../testing/fakes";
import { resetAs, stateOf } from "../testing/seed";
import { chooseNow, proactiveOf } from "./proactive";
import { admitMoment, deliveryEntryId, recordSaid } from "./said";
import { momentsOf, moveOccasion, ofKind } from "./testing";
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
