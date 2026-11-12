// Feature: brief 041 follow-up W-216, the lead's provisional ruling on W-211. A must-say moment about a person
// recorded deceased is chosen only when the owner confirmed it strictly after the death was recorded (both times on
// the ops clock: the action's `createdAt`, the life fact's `createdAt`). Equal times, or a death recorded later,
// mean the reminder is never chosen. On the server path over the in-memory store, for any order of the confirmation
// and the death, any gap between them, any world time on the reminder's day and either session mode.
import { type Memory, type Moment, localMinuteAt, tsFromMs } from "@franki/core";
import { sampleTurn, testId } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { testRig } from "../testing/fakes";
import { chooseNow } from "./proactive";
import { confirmReminder, offerReminder, recordPendingRendered } from "./reminder";
import { momentsOf, setWorld, timeTenant, writeOccasion } from "./testing";
import { memoryTick } from "./tick";

const UID = "owner-1";
const DAY = "2026-11-13";
const MINUTE = 60_000;
const MOM = testId("mom");

const caseArb = fc.record({
  zone: fc.constantFrom("America/Chicago", "UTC", "Asia/Kolkata"),
  // Minutes from the confirmation to the death: negative is a death recorded first, 0 the same instant.
  gap: fc.integer({ min: -30, max: 30 }),
  worldMinute: fc.integer({ min: 9 * 60, max: 20 * 60 }),
  mode: fc.oneof(fc.constant({ kind: "opening" as const }), fc.record({ kind: fc.constant("session" as const), listening: fc.constant(false), silentMs: fc.constant(20_000) })),
});

describe("Property W-216: a must-say about the dead plays only when confirmed after the death", () => {
  it("never chosen unless its confirmation is strictly after the death's recording", async () => {
    await fc.assert(
      fc.asyncProperty(caseArb, async (c) => {
        const rig = testRig();
        const ctx = await timeTenant(rig, UID, c.zone, localMinuteAt(DAY, 8 * 60, c.zone)!);
        const ops = () => tsFromMs(rig.clock.read().opsClock.now);
        const die = () =>
          writeOccasion(rig, UID, "death", 0, c.zone, { kind: "fact", predicate: "person.life", subjectId: MOM, entityIds: [MOM], value: { kind: "enum", code: "deceased" }, args: { detail: null }, gravity: 3, time: null, when: { kind: "none" }, createdAt: ops(), updatedAt: ops() } as Partial<Memory>);
        const source = await writeOccasion(rig, UID, "ashes", 0, c.zone, { kind: "fact", predicate: "fact", subjectId: "self", entityIds: [MOM], value: { kind: "text", text: "pick up Mom's ashes" }, args: { topic: "other", label: null }, time: null, when: { kind: "none" } });
        const offer = offerReminder(rig.deps.hasher, { sourceId: source, note: "Pick up Mom's ashes", spoken: "tomorrow", worldNow: localMinuteAt(DAY, 8 * 60, c.zone)!, zone: c.zone })!;
        await rig.store.transaction(UID, (tx) => recordPendingRendered(tx, UID, offer.pendingId, rig.clock.read().opsClock.now, rig.deps.hasher));
        rig.clock.advance(MINUTE);
        if (c.gap < 0) {
          await die();
          rig.clock.advance(-c.gap * MINUTE);
        }
        const yes = sampleTurn({ text: "Yes.", sourceClass: "U", final: true, role: "user", committedAt: ops() });
        const applied = await confirmReminder(ctx, offer, offer.yesId, yes);
        expect(applied.state).toBe("applied");
        if (applied.state !== "applied") return;
        const confirmedAt = rig.clock.read().opsClock.now;
        if (c.gap >= 0) {
          rig.clock.advance(c.gap * MINUTE);
          await die();
        }
        const diedAt = c.gap < 0 ? confirmedAt + c.gap * MINUTE : confirmedAt + c.gap * MINUTE;
        await setWorld(rig, UID, localMinuteAt("2026-11-14", c.worldMinute, c.zone)!);
        await memoryTick(ctx);
        const { choice } = await chooseNow(ctx, c.mode, { transition: false, crisis: false, turnsSinceCheckInAnswer: null });
        if (choice.spoken?.momentId === applied.momentId) expect(confirmedAt, `chosen with the death ${c.gap} min after`).toBeGreaterThan(diedAt);
        // Closed, never left to fire: before the ruling's line, the reminder is never leased for speech again.
        if (confirmedAt <= diedAt) {
          rig.clock.advance(16 * MINUTE);
          await memoryTick(ctx);
          const m: Moment | undefined = (await momentsOf(rig, UID)).get(applied.momentId);
          expect(["pending", "cancelled"]).toContain(m?.status);
        }
      }),
      { numRuns: 1000 },
    );
  }, 600_000);
});
