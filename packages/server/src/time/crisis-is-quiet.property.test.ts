// Feature: brief 036, property 4 "Crisis is quiet" (spec §5 Delivery: "He didn't make it" isn't followed by a
// wish or "$186 on takeout"; spec §6 Crisis: "no suggesting or celebrating"). On the server path over the in-memory
// store, with the ops clock moving: for any open occasions, world time, session mode, transition flag and check-in
// distance, with crisis set `chooseNow` speaks nothing that is not mustSay. The only mustSay a floor moment can be
// is a confirmed reminder due within 24 hours (brief 036 finding 8).
import { localMinuteAt, msFromTs } from "@franki/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { testRig } from "../testing/fakes";
import { chooseNow } from "./proactive";
import { setWorld, timeTenant, writeOccasion } from "./testing";
import { memoryTick } from "./tick";

const UID = "owner-1";
const DAY = "2026-11-13";
const MINUTE = 60_000;
const DAY_MS = 86_400_000;

const caseArb = fc.record({
  zone: fc.constantFrom("America/Chicago", "UTC", "Asia/Kolkata"),
  starts: fc.array(fc.integer({ min: 18, max: 40 }).map((h) => h * 30), { minLength: 1, maxLength: 3 }),
  worldMinute: fc.integer({ min: 6 * 60, max: 23 * 60 }),
  opsMinutes: fc.integer({ min: 0, max: 14 }),
  mode: fc.oneof(
    fc.constant({ kind: "opening" as const }),
    fc.record({ kind: fc.constant("session" as const), listening: fc.boolean(), silentMs: fc.integer({ min: 0, max: 20_000 }) }),
  ),
  transition: fc.boolean(),
  turnsSinceCheckInAnswer: fc.option(fc.nat(4), { nil: null }),
});

describe("one-shot time, server path: crisis is quiet", () => {
  it("with crisis set, nothing but a mustSay is spoken", async () => {
    await fc.assert(
      fc.asyncProperty(caseArb, async (c) => {
        const rig = testRig();
        const ctx = await timeTenant(rig, UID, c.zone, localMinuteAt(DAY, 6 * 60, c.zone)!);
        for (const [i, minute] of c.starts.entries()) await writeOccasion(rig, UID, String(i), localMinuteAt(DAY, minute, c.zone)!, c.zone);
        const world = localMinuteAt(DAY, c.worldMinute, c.zone)!;
        await setWorld(rig, UID, world);
        await memoryTick(ctx);
        rig.clock.advance(c.opsMinutes * MINUTE);
        const { choice, moments } = await chooseNow(ctx, c.mode, { transition: c.transition, crisis: true, turnsSinceCheckInAnswer: c.turnsSinceCheckInAnswer });
        if (choice.spoken === null) return;
        const m = moments.get(choice.spoken.momentId as never)!;
        expect(m.kind).toBe("commitmentDue");
        expect(msFromTs(m.dueAt) - world).toBeLessThanOrEqual(DAY_MS);
      }),
      { numRuns: 1000 },
    );
  }, 120_000);
});
