// Feature: brief 036, property 3 "The caps hold under any interleaving" (spec §5 Delivery "Three proactive a day,
// one heavy"; contracts line 332 "Caps:3 proactive/world day,1 heavy(gravity>=2) ... mustSay skips both"). On the
// server path over the in-memory store, with the ops clock moving: two sessions choose lines, put them on the wire
// and admit them in any order, while ticks run, the world clock moves forward and the owner's zone changes. Counted
// by the world day each admission happened on (in the zone of that moment), no day ever admits more than three
// lines or more than one heavy line, except mustSay.
import { type CoreState, type Moment, civilDateAt, isHeavy, localMinuteAt } from "@franki/core";
import { testId } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { paths } from "../store/paths";
import { patchRecord, testRig } from "../testing/fakes";
import { chooseNow, proactiveOf } from "./proactive";
import { admitMoment } from "./said";
import { momentsOf, setWorld, timeTenant, worldOf, writeOccasion } from "./testing";
import { memoryTick } from "./tick";

const UID = "owner-1";
const DAY = "2026-11-13";
const MINUTE = 60_000;
const STAMP = { sessionId: testId("s"), epoch: 1, policyRev: 1, bundleRev: 1, rulesRev: 1, generation: 1, turnId: testId("t") };
const SIGNALS = { transition: false, crisis: false, turnsSinceCheckInAnswer: null };
const ZONES = ["America/Chicago", "Asia/Tokyo", "Pacific/Honolulu", "UTC"] as const;

const session = fc.constantFrom(0, 1);
const step = fc.oneof(
  fc.constant({ k: "tick" as const }),
  fc.record({ k: fc.constant("choose" as const), s: session, opening: fc.boolean() }),
  // A line rendered for the n-th open moment: a session that chose it while the counts were lower.
  fc.record({ k: fc.constant("render" as const), s: session, n: fc.nat(6) }),
  fc.record({ k: fc.constant("admit" as const), s: session, n: fc.nat(3) }),
  fc.record({ k: fc.constant("world" as const), minutes: fc.integer({ min: 0, max: 8 * 60 }) }),
  fc.record({ k: fc.constant("ops" as const), minutes: fc.integer({ min: 1, max: 20 }) }),
  fc.record({ k: fc.constant("zone" as const), zone: fc.constantFrom(...ZONES) }),
);
const caseArb = fc.record({
  occasions: fc.array(fc.record({ minute: fc.integer({ min: 18, max: 44 }).map((h) => h * 30), gravity: fc.constantFrom(0, 0, 2) }), { minLength: 3, maxLength: 6 }),
  steps: fc.array(step, { minLength: 4, maxLength: 24 }),
});

describe("one-shot time, server path: the caps hold under any interleaving", () => {
  it("never more than three a world day, or more than one heavy, except mustSay", async () => {
    await fc.assert(
      fc.asyncProperty(caseArb, async (c) => {
        const rig = testRig();
        const zone0 = "America/Chicago";
        const ctx = await timeTenant(rig, UID, zone0, localMinuteAt(DAY, 8 * 60 + 40, zone0)!);
        for (const [i, o] of c.occasions.entries()) await writeOccasion(rig, UID, String(i), localMinuteAt(DAY, o.minute, zone0)!, zone0, { gravity: o.gravity });
        await memoryTick(ctx);
        let zone: string = zone0;
        const wire: { momentId: string; noteId: string }[][] = [[], []];
        const days = new Map<string, { all: number; heavy: number }>();
        let n = 0;
        for (const s of c.steps) {
          if (s.k === "tick") await memoryTick(ctx);
          else if (s.k === "world") await setWorld(rig, UID, (await worldOf(rig, UID)) + s.minutes * MINUTE);
          else if (s.k === "ops") rig.clock.advance(s.minutes * MINUTE);
          else if (s.k === "zone") {
            zone = s.zone;
            await patchRecord<CoreState>(rig.store, UID, paths.core(UID, "state"), { currentZone: zone });
          } else if (s.k === "choose") {
            const mode = s.opening ? ({ kind: "opening" } as const) : ({ kind: "session", listening: true, silentMs: 9_000 } as const);
            const { choice, moments } = await chooseNow(ctx, mode, SIGNALS);
            if (choice.spoken === null) continue;
            const p = await proactiveOf(ctx, choice.spoken.momentId as never, moments.get(choice.spoken.momentId as never)!, STAMP);
            if (p !== null) wire[s.s]!.unshift({ momentId: choice.spoken.momentId, noteId: p.whisper.noteId });
          } else if (s.k === "render") {
            const open = [...(await momentsOf(rig, UID)).entries()].filter(([, m]) => m.status === "leased");
            const pick = open[s.n % Math.max(1, open.length)];
            if (pick === undefined) continue;
            const p = await proactiveOf(ctx, pick[0] as never, pick[1], STAMP);
            if (p !== null) wire[s.s]!.unshift({ momentId: pick[0], noteId: p.whisper.noteId });
          } else {
            const line = wire[s.s]![s.n];
            if (line === undefined) continue;
            const before = (await momentsOf(rig, UID)).get(line.momentId) as Moment;
            const ok = await rig.store.transaction(UID, (tx) => admitMoment(tx, UID, line.momentId as never, { responseId: `resp_${n++}`, noteIds: [line.noteId] }, rig.deps));
            if (!ok) continue;
            const label = civilDateAt(await worldOf(rig, UID), zone);
            const memory = before.memoryId === null ? null : await rig.store.get<{ gravity: number }>(UID, paths.memory(UID, before.memoryId));
            const heavy = isHeavy(before.kind, memory?.data.gravity ?? 0);
            const d = days.get(label) ?? { all: 0, heavy: 0 };
            d.all++;
            if (heavy) d.heavy++;
            days.set(label, d);
            expect(d.all).toBeLessThanOrEqual(3);
            expect(d.heavy).toBeLessThanOrEqual(1);
          }
        }
      }),
      { numRuns: 1000 },
    );
  }, 180_000);
});
