import { type CoreEpoch, type Ledger, type Memory, type Moment, Proactive, msFromTs, tsFromMs, validate } from "@franki/core";
import { sampleTurn, testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { seedAdvanceRoute } from "../routes/seed-advance";
import type { RouteContext } from "../routes/runtime";
import { listTenantRows } from "../seed/clear";
import { paths } from "../store/paths";
import { callRoute, patchRecord, type TestRig, testRig } from "../testing/fakes";
import { resetAs, stateOf } from "../testing/seed";
import { chooseNow, proactiveOf } from "./proactive";
import { confirmReminder, offerReminder, recordPendingRendered } from "./reminder";
import { admitMoment, deliveryEntryId, recordSaid } from "./said";
import { memoryTick, scanMoments } from "./tick";
import { momentNoteId } from "./verdict";

const UID = "owner-1";
const ZONE = "America/Chicago";
const HOUR = 3_600_000;

async function clone(): Promise<{ rig: TestRig; ctx: RouteContext; ns: string }> {
  const rig = testRig();
  const reset = await resetAs(rig, UID, "v1", "r1", ZONE);
  return { rig, ctx: { uid: UID, deps: rig.deps, schedule: () => undefined }, ns: reset.body.fixtureNamespace };
}
const moments = async (rig: TestRig) => new Map(((await scanMoments({ get: (p) => rig.store.get(UID, p), query: (q) => rig.store.query(UID, q) }, UID)) ?? []).map((d) => [d.id, d.data]));
const byKind = (all: Map<string, Moment>, kind: Moment["kind"]) => [...all.entries()].filter(([, m]) => m.kind === kind);
const advance = (rig: TestRig, ns: string, to: number, n: string) => callRoute(rig, seedAdvanceRoute, { requestId: testId(`adv-${n}`), fixtureNamespace: ns, to: tsFromMs(to) }, { token: `token:${UID}` });

describe("memoryTick on the seeded clone", () => {
  it("Friday 08:40: the interview's wish and the takeout insight open; a second tick changes nothing", async () => {
    const { rig, ctx } = await clone();
    const first = await memoryTick(ctx);
    expect(first.skipped).toBeNull();
    const all = await moments(rig);
    const [[wishId, wish]] = byKind(all, "wish") as [[string, Moment]];
    expect(wish.status).toBe("leased");
    expect(wish.payload).toMatchObject({ kind: "cue", template: { text: "Good luck at 2 PM: Tessellate Labs final interview." } });
    expect(byKind(all, "insight")[0]![1].status).toBe("leased");
    expect(byKind(all, "checkIn")[0]![1].status).toBe("pending");
    expect(first.opened).toContain(wishId);
    const before = await listTenantRows(rig.store, UID);
    const second = await memoryTick(ctx);
    expect(second).toMatchObject({ derived: 0, opened: [], transitions: [] });
    expect(await listTenantRows(rig.store, UID)).toEqual(before);
  });

  it("writes moments only: every Memory and Evidence row is unchanged", async () => {
    const { rig, ctx } = await clone();
    const facts = async () => (await listTenantRows(rig.store, UID)).filter((r) => r.path.includes("/memories/") || r.path.includes("/evidence/"));
    const before = await facts();
    await memoryTick(ctx);
    expect(await facts()).toEqual(before);
  });

  it("a forgotten source cancels its moment at open; a barrier stops the tick", async () => {
    const { rig, ctx } = await clone();
    await memoryTick(ctx);
    const [[checkInId, checkIn]] = byKind(await moments(rig), "checkIn") as [[string, Moment]];
    const memoryId = checkIn.payload.kind === "cue" ? checkIn.payload.noteRef.id : "";
    await patchRecord<Memory>(rig.store, UID, paths.memory(UID, memoryId), { status: "blocked" });
    const state = await stateOf(rig.store, UID);
    await patchRecord(rig.store, UID, paths.core(UID, "state"), { worldClock: tsFromMs(msFromTs(state.worldClock!) + 10 * HOUR) });
    const now = tsFromMs(rig.clock.read().opsClock.now);
    await patchRecord<CoreEpoch>(rig.store, UID, paths.core(UID, "epoch"), { barrier: { opId: testId("forget"), phase: "fence", startedAt: now, deadline: now, queuedOps: [] } });
    expect((await memoryTick(ctx)).skipped).toBe("barrier");
    await patchRecord<CoreEpoch>(rig.store, UID, paths.core(UID, "epoch"), { barrier: null });
    await memoryTick(ctx);
    expect((await moments(rig)).get(checkInId)).toMatchObject({ status: "cancelled", cancelReason: "forgotten" });
  });
});

describe("POST /api/seed/advance", () => {
  it("jumps to 18:00: the check-in opens and the passed wish is skipped; the derive Job is recorded", async () => {
    const { rig, ctx, ns } = await clone();
    await memoryTick(ctx);
    const world = msFromTs((await stateOf(rig.store, UID)).worldClock!);
    const to = world + (18 * 60 - (8 * 60 + 40)) * 60_000;
    const res = await advance(rig, ns, to, "1");
    expect(res.status).toBe(200);
    expect(res.body.worldClock).toBe(tsFromMs(to));
    const all = await moments(rig);
    expect(byKind(all, "checkIn")[0]![1].status).toBe("leased");
    expect(byKind(all, "wish")[0]![1].status).toBe("skipped");
    const job = await rig.store.get<{ status: string; kind: string }>(UID, paths.job(UID, res.body.jobId));
    expect(job?.data).toMatchObject({ kind: "derive", status: "complete" });
    expect((await advance(rig, ns, to, "1")).body).toEqual(res.body);
  });

  it("answers 423 with a retry under a barrier, 409 for another clone, 400 going back", async () => {
    const { rig, ns } = await clone();
    const world = msFromTs((await stateOf(rig.store, UID)).worldClock!);
    expect((await advance(rig, ns, world - 60_000, "back")).status).toBe(400);
    expect((await advance(rig, testId("other-ns"), world + HOUR, "ns")).status).toBe(409);
    const now = tsFromMs(rig.clock.read().opsClock.now);
    await patchRecord<CoreEpoch>(rig.store, UID, paths.core(UID, "epoch"), { barrier: { opId: testId("forget"), phase: "fence", startedAt: now, deadline: now, queuedOps: [] } });
    const blocked = await advance(rig, ns, world + HOUR, "barrier");
    expect(blocked).toMatchObject({ status: 423, body: { error: "BARRIER", retryAfterMs: 1000 } });
    expect(msFromTs((await stateOf(rig.store, UID)).worldClock!)).toBe(world);
  });
});

describe("delivery, said and the reminder", () => {
  it("chooses the wish for a session opening and puts it on the wire as a Proactive", async () => {
    const { rig, ctx } = await clone();
    await memoryTick(ctx);
    const { choice, moments: open } = await chooseNow(ctx, { kind: "opening" }, { transitionOrCrisis: false, turnsSinceCheckInAnswer: null });
    const wishId = byKind(await moments(rig), "wish")[0]![0];
    expect(choice.spoken).toEqual({ momentId: wishId, channel: "opening" });
    const stamp = { sessionId: testId("s"), epoch: 2, policyRev: 1, bundleRev: 1, rulesRev: 1, generation: 1, turnId: testId("t") };
    const p = await proactiveOf(ctx, wishId as never, open.get(wishId as never)!, stamp);
    expect(p).not.toBeNull();
    expect(validate(Proactive, p).ok).toBe(true);
    expect(p!.permit).toMatchObject({ kind: "proactive", momentIds: [wishId] });
    expect(p!.whisper.text).toBe("Good luck at 2 PM: Tessellate Labs final interview.");
  });

  it("an admitted wish is said only by a matching transcript, with its ledger row", async () => {
    const { rig, ctx } = await clone();
    await memoryTick(ctx);
    const wishId = byKind(await moments(rig), "wish")[0]![0] as never;
    const tx = <T>(fn: (t: Parameters<Parameters<typeof rig.store.transaction>[1]>[0]) => Promise<T>) => rig.store.transaction(UID, fn);
    const noteIds = [momentNoteId(rig.deps.hasher, wishId, (await moments(rig)).get(wishId)!)];
    expect(await tx((t) => admitMoment(t, UID, wishId, { responseId: "resp_1", noteIds }, rig.deps))).toBe(true);
    const counters = await rig.store.get<{ counts: { kind: string; count: number }[] }>(UID, paths.core(UID, "counters"));
    expect(counters?.data.counts).toContainEqual({ kind: "speech", count: 1 });
    const receipt = (text: string) => ({ kind: "transcript" as const, responseId: "resp_1", momentIds: [wishId], noteIds: [], text });
    expect(await tx((t) => recordSaid(t, UID, wishId, receipt("Hi there."), "proactive", rig.clock, rig.deps.hasher))).toBeNull();
    expect(await rig.store.get(UID, paths.ledger(UID, deliveryEntryId(rig.deps.hasher, wishId, "resp_1")))).toBeNull();
    expect(await tx((t) => recordSaid(t, UID, wishId, receipt("Good luck at 2 PM: Tessellate Labs final interview!"), "proactive", rig.clock, rig.deps.hasher))).toBe("exactTemplate");
    const m = (await moments(rig)).get(wishId)!;
    expect(m).toMatchObject({ status: "delivered", saidMatch: "exactTemplate" });
    expect(m.saidAt).not.toBeNull();
    const entry = await rig.store.get<Ledger>(UID, paths.ledger(UID, deliveryEntryId(rig.deps.hasher, wishId, "resp_1")));
    expect(entry?.data).toMatchObject({ kind: "delivery", payload: { momentId: wishId, match: "exactTemplate" } });
  });

  it("\"Want a reminder Thursday?\" then \"yes\": one action and one moment, only after the offer rendered", async () => {
    const { rig, ctx } = await clone();
    const world = msFromTs((await stateOf(rig.store, UID)).worldClock!);
    const offer = offerReminder(rig.deps.hasher, { sourceId: testId("jordan-thread"), note: "Reply to Jordan about the platform role", spoken: "Thursday", worldNow: world, zone: ZONE })!;
    expect(offer.line).toMatch(/^Want a reminder on Thursday/);
    expect(offerReminder(rig.deps.hasher, { sourceId: testId("x"), note: "x", spoken: "sometime soon", worldNow: world, zone: ZONE })).toBeNull();
    const yes = sampleTurn({ text: "Yes.", sourceClass: "U", final: true, role: "user" });
    expect(await confirmReminder(ctx, offer, offer.yesId, yes)).toEqual({ state: "stale" });
    await rig.store.transaction(UID, (tx) => recordPendingRendered(tx, UID, offer.pendingId, rig.clock.read().opsClock.now, rig.deps.hasher));
    expect(await confirmReminder(ctx, offer, offer.yesId, sampleTurn({ text: "Yes, but not Thursday", sourceClass: "U", final: true, role: "user" }))).toEqual({ state: "clarify" });
    expect(await confirmReminder(ctx, offer, offer.noId, yes)).toEqual({ state: "declined" });
    const applied = await confirmReminder(ctx, offer, offer.yesId, yes);
    expect(applied.state).toBe("applied");
    if (applied.state !== "applied") return;
    const action = await rig.store.get<Ledger>(UID, paths.ledger(UID, applied.actionId));
    expect(action?.data).toMatchObject({ kind: "action", state: "complete", payload: { executor: "makeReminder", pendingId: offer.pendingId } });
    const moment = (await moments(rig)).get(applied.momentId)!;
    expect(moment).toMatchObject({ kind: "commitmentDue", actionId: applied.actionId, status: "pending" });
    const rows = (await listTenantRows(rig.store, UID)).length;
    expect(await confirmReminder(ctx, offer, offer.yesId, yes)).toEqual(applied);
    expect((await listTenantRows(rig.store, UID)).length).toBe(rows);
    // The tick keeps it, and opens it on its day at 09:00.
    await memoryTick(ctx);
    expect((await moments(rig)).get(applied.momentId)?.status).toBe("pending");
  });
});
