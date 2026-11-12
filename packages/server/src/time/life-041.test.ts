// Brief 041 part 3: after a death, delivery is quiet about that person (spec §7, the death and illness rows). On the
// server path: a wish, a check-in or a celebrate about someone recorded deceased is never chosen or admitted, a
// celebration for someone gravely ill waits, a check-in about care recorded resolved is dropped, and each such moment
// is closed with a reason code at the next tick, never left to fire later.
import { type Memory, type Moment, localMinuteAt, msFromTs, tsFromMs } from "@franki/core";
import { sampleTurn, testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import type { RouteContext } from "../routes/runtime";
import { type TestRig, testRig } from "../testing/fakes";
import { chooseNow } from "./proactive";
import { admitMoments } from "./said";
import { setWorld, timeTenant, writeOccasion, momentsOf, ofKind } from "./testing";
import { memoryTick } from "./tick";
import { momentNoteId } from "./verdict";
import { confirmReminder, offerReminder, recordPendingRendered } from "./reminder";

const UID = "owner-1";
const ZONE = "America/Chicago";
const DAY = "2026-11-13";
const MOM = testId("mom");
const MINUTE = 60_000;
const QUIET = { transition: false, crisis: false, turnsSinceCheckInAnswer: null };

/** A fact about `subject` as a transition writes it: person.life or care, with its Evidence. */
export function lifeRow(rig: TestRig, label: string, subject: string, o: Partial<Memory>): Promise<string> {
  return writeOccasion(rig, UID, label, 0, ZONE, { kind: "fact", subjectId: subject, entityIds: [subject], time: null, when: { kind: "none" }, ...o });
}
export const deceased = (rig: TestRig, subject: string, n = 0) => lifeRow(rig, `life-${n}`, subject, { predicate: "person.life", value: { kind: "enum", code: "deceased" }, args: { detail: null }, gravity: 3 });

async function tenant(): Promise<{ rig: TestRig; ctx: RouteContext }> {
  const rig = testRig();
  const ctx = await timeTenant(rig, UID, ZONE, localMinuteAt(DAY, 6 * 60, ZONE)!);
  return { rig, ctx };
}
/** Mom's surgery at 14:00, and the world at `minute`, ticked: the wish is leased by 13:00. */
async function momOccasion(rig: TestRig, ctx: RouteContext, minute: number, o: Partial<Memory> = {}) {
  await writeOccasion(rig, UID, "mom", localMinuteAt(DAY, 14 * 60, ZONE)!, ZONE, { value: { kind: "text", text: "Mom's surgery" }, entityIds: [MOM], ...o });
  await setWorld(rig, UID, localMinuteAt(DAY, minute, ZONE)!);
  await memoryTick(ctx);
}
const leased = async (rig: TestRig, kind: Moment["kind"]) => ofKind(await momentsOf(rig, UID), kind).find(([, m]) => m.status === "leased");
const admit = (rig: TestRig, id: string, m: Moment) => rig.store.transaction(UID, (tx) => admitMoments(tx, UID, [id as never], { responseId: "resp_1", noteIds: [momentNoteId(rig.deps.hasher, id, m)] }, rig.deps));

describe("after a death, nothing cheerful about that person (brief 041 part 3)", () => {
  it("control: before the news, the wish for Mom's surgery is chosen", async () => {
    const { rig, ctx } = await tenant();
    await momOccasion(rig, ctx, 13 * 60);
    const [id] = (await leased(rig, "wish"))!;
    expect((await chooseNow(ctx, { kind: "opening" }, QUIET)).choice.spoken?.momentId).toBe(id);
  });

  it("a wish planned before the death is not chosen after it, and the tick closes it with a reason", async () => {
    const { rig, ctx } = await tenant();
    await momOccasion(rig, ctx, 13 * 60);
    const [id] = (await leased(rig, "wish"))!;
    await deceased(rig, MOM);
    expect((await chooseNow(ctx, { kind: "opening" }, QUIET)).choice.spoken).toBeNull();
    rig.clock.advance(16 * MINUTE);
    await memoryTick(ctx);
    const after = (await momentsOf(rig, UID)).get(id)!;
    expect(after.status).toBe("cancelled");
    expect(after.cancelReason).not.toBeNull();
  });

  it("a wish chosen before the death is not admitted after it", async () => {
    const { rig, ctx } = await tenant();
    await momOccasion(rig, ctx, 13 * 60);
    const [id, m] = (await leased(rig, "wish"))!;
    expect((await chooseNow(ctx, { kind: "opening" }, QUIET)).choice.spoken?.momentId).toBe(id);
    await deceased(rig, MOM);
    expect(await admit(rig, id, m)).toEqual([]);
  });

  it("an occasion whose subject is the person who died is quiet too", async () => {
    const { rig, ctx } = await tenant();
    await momOccasion(rig, ctx, 13 * 60, { subjectId: MOM, entityIds: [] });
    await deceased(rig, MOM);
    expect((await chooseNow(ctx, { kind: "opening" }, QUIET)).choice.spoken).toBeNull();
  });

  it("someone else's occasion still speaks", async () => {
    const { rig, ctx } = await tenant();
    await momOccasion(rig, ctx, 13 * 60);
    await deceased(rig, testId("someone-else"));
    expect((await chooseNow(ctx, { kind: "opening" }, QUIET)).choice.spoken).not.toBeNull();
  });
});

describe("illness and resolved care (brief 041 part 3)", () => {
  it("while Mom is gravely ill, a wish for her occasion waits", async () => {
    const { rig, ctx } = await tenant();
    await momOccasion(rig, ctx, 13 * 60);
    await lifeRow(rig, "care-open", MOM, { kind: "care", predicate: "care", value: { kind: "enum", code: "open" }, args: { careSubjectRef: MOM, topic: "hospital" }, gravity: 3 });
    expect((await chooseNow(ctx, { kind: "opening" }, QUIET)).choice.spoken).toBeNull();
  });

  it("an illness below gravity 3 suspends nothing", async () => {
    const { rig, ctx } = await tenant();
    await momOccasion(rig, ctx, 13 * 60);
    await lifeRow(rig, "care-light", MOM, { kind: "care", predicate: "care", value: { kind: "enum", code: "open" }, args: { careSubjectRef: MOM, topic: "cold" }, gravity: 1 });
    expect((await chooseNow(ctx, { kind: "opening" }, QUIET)).choice.spoken).not.toBeNull();
  });

  it("a check-in about care recorded resolved is dropped", async () => {
    const { rig, ctx } = await tenant();
    await writeOccasion(rig, UID, "mom", localMinuteAt(DAY, 9 * 60, ZONE)!, ZONE, { value: { kind: "text", text: "Mom's surgery" }, entityIds: [MOM] });
    await setWorld(rig, UID, localMinuteAt(DAY, 9 * 60, ZONE)!);
    await memoryTick(ctx);
    await setWorld(rig, UID, localMinuteAt(DAY, 17 * 60, ZONE)!);
    await memoryTick(ctx);
    const check = await leased(rig, "checkIn");
    expect(check).toBeDefined();
    expect((await chooseNow(ctx, { kind: "opening" }, QUIET)).choice.spoken?.momentId).toBe(check![0]);
    await lifeRow(rig, "care-done", MOM, { kind: "care", predicate: "care", value: { kind: "enum", code: "resolved" }, args: { careSubjectRef: MOM, topic: "surgery" }, gravity: 3 });
    expect((await chooseNow(ctx, { kind: "opening" }, QUIET)).choice.spoken).toBeNull();
    expect(msFromTs(check![1].dueAt)).toBeGreaterThan(0);
  });
});

// W-228 (the lead's provisional ruling on W-211): a must-say moment about someone recorded deceased plays only when
// the owner confirmed it strictly after the death was recorded; otherwise it closes as the rest do.
describe("a must-say reminder about someone recorded deceased (W-228)", () => {
  /** "Remind me tomorrow to pick up Mom's ashes": offered, shown and confirmed now; leased tomorrow at 09:00. */
  async function reminderAboutMom(rig: TestRig, ctx: RouteContext) {
    const source = await lifeRow(rig, "ashes", MOM, { subjectId: "self", entityIds: [MOM], predicate: "fact", value: { kind: "text", text: "pick up Mom's ashes" }, args: { topic: "other", label: null }, gravity: 0 });
    const world = localMinuteAt(DAY, 8 * 60, ZONE)!;
    await setWorld(rig, UID, world);
    const offer = offerReminder(rig.deps.hasher, { sourceId: source, note: "Pick up Mom's ashes", spoken: "tomorrow", worldNow: world, zone: ZONE })!;
    await rig.store.transaction(UID, (tx) => recordPendingRendered(tx, UID, offer.pendingId, rig.clock.read().opsClock.now, rig.deps.hasher));
    rig.clock.advance(MINUTE);
    const yes = sampleTurn({ text: "Yes.", sourceClass: "U", final: true, role: "user", committedAt: tsFromMs(rig.clock.read().opsClock.now) });
    const applied = await confirmReminder(ctx, offer, offer.yesId, yes);
    if (applied.state !== "applied") throw new Error(applied.state);
    return applied.momentId as string;
  }
  /** The death, recorded now on the ops clock. */
  const deathNow = (rig: TestRig) => lifeRow(rig, "life-w216", MOM, { predicate: "person.life", value: { kind: "enum", code: "deceased" }, args: { detail: null }, gravity: 3, createdAt: tsFromMs(rig.clock.read().opsClock.now), updatedAt: tsFromMs(rig.clock.read().opsClock.now) });
  async function onTheDay(rig: TestRig, ctx: RouteContext) {
    await setWorld(rig, UID, localMinuteAt("2026-11-14", 9 * 60, ZONE)!);
    await memoryTick(ctx);
  }

  it("confirmed before the death was recorded: never chosen, and closed with its reason", async () => {
    const { rig, ctx } = await tenant();
    const id = await reminderAboutMom(rig, ctx);
    rig.clock.advance(MINUTE);
    await deathNow(rig);
    await onTheDay(rig, ctx);
    expect((await chooseNow(ctx, { kind: "opening" }, QUIET)).choice.spoken?.momentId).not.toBe(id);
    rig.clock.advance(16 * MINUTE);
    await memoryTick(ctx);
    expect((await momentsOf(rig, UID)).get(id)).toMatchObject({ status: "cancelled", cancelReason: "policy" });
  });

  it("confirmed after the death was recorded: chosen, as any must-say is", async () => {
    const { rig, ctx } = await tenant();
    await deathNow(rig);
    rig.clock.advance(MINUTE);
    const id = await reminderAboutMom(rig, ctx);
    await onTheDay(rig, ctx);
    expect((await chooseNow(ctx, { kind: "opening" }, QUIET)).choice.spoken?.momentId).toBe(id);
  });
});
