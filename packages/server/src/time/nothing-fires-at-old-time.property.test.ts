// Feature: brief 036, property 1 "Nothing fires at the old time" (spec §13 time family: "the rendered string changes,
// nothing fires at the old time, a wish fires once per occurrence"). On the server path over the in-memory store,
// with the ops clock moving: for any sequence of ticks, moves of the occasion, ops and world time passing, choices
// and admissions (an admission may use a line put on the wire several steps before), nothing is admitted whose
// rendered time differs from its source's time at that moment, the wish is admitted at most once, and an occurrence
// still ahead after its last move can still be wished.
import { clockLabel, deriveOccasion, localMinuteAt, localMinuteOf, type Memory } from "@franki/core";
import { testId } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { paths } from "../store/paths";
import { testRig } from "../testing/fakes";
import { chooseNow, proactiveOf } from "./proactive";
import { admitMoment } from "./said";
import { momentsOf, moveOccasion, ofKind, setWorld, timeTenant, worldOf, writeOccasion } from "./testing";
import { memoryTick } from "./tick";

const UID = "owner-1";
const DAY = "2026-11-13";
const MINUTE = 60_000;
const STAMP = { sessionId: testId("s"), epoch: 1, policyRev: 1, bundleRev: 1, rulesRev: 1, generation: 1, turnId: testId("t") };
const SIGNALS = { transitionOrCrisis: false, turnsSinceCheckInAnswer: null };

const halfHour = (from: number, to: number) => fc.integer({ min: from * 2, max: to * 2 }).map((h) => h * 30);
const step = fc.oneof(
  fc.constant({ k: "tick" as const }),
  fc.record({ k: fc.constant("move" as const), minute: halfHour(6, 20) }),
  fc.record({ k: fc.constant("ops" as const), minutes: fc.integer({ min: 1, max: 20 }) }),
  fc.record({ k: fc.constant("world" as const), minutes: fc.integer({ min: 0, max: 180 }) }),
  fc.constant({ k: "choose" as const }),
  fc.constant({ k: "admit" as const }),
);
const caseArb = fc.record({
  zone: fc.constantFrom("America/Chicago", "UTC", "Asia/Kolkata"),
  startMinute: halfHour(7, 20),
  steps: fc.array(step, { minLength: 1, maxLength: 8 }),
});

const wishText = (startMs: number, zone: string) => `Good luck at ${clockLabel(localMinuteOf(startMs, zone))}: Tessellate Labs final interview.`;

describe("one-shot time, server path: nothing fires at the old time", () => {
  it("admits only the current time, once, and still wishes an occurrence ahead", async () => {
    await fc.assert(
      fc.asyncProperty(caseArb, async (c) => {
        const rig = testRig();
        const at = (minute: number) => localMinuteAt(DAY, minute, c.zone)!;
        const ctx = await timeTenant(rig, UID, c.zone, at(7 * 60));
        let head = await writeOccasion(rig, UID, "0", at(c.startMinute), c.zone);
        let headStart = at(c.startMinute);
        let moves = 0;
        let onWire: { momentId: string; text: string; noteId: string } | null = null;
        let admitted = 0;
        for (const s of c.steps) {
          if (s.k === "tick") await memoryTick(ctx);
          else if (s.k === "move") {
            moves++;
            headStart = at(s.minute);
            head = await moveOccasion(rig, UID, head, testId(`occasion-move-${moves}`), headStart);
          } else if (s.k === "ops") rig.clock.advance(s.minutes * MINUTE);
          else if (s.k === "world") await setWorld(rig, UID, (await worldOf(rig, UID)) + s.minutes * MINUTE);
          else if (s.k === "choose") {
            const { choice, moments } = await chooseNow(ctx, { kind: "opening" }, SIGNALS);
            const id = choice.spoken?.momentId;
            const m = id === undefined ? undefined : moments.get(id as never);
            if (m?.kind === "wish") {
              const p = await proactiveOf(ctx, id as never, m, STAMP);
              if (p !== null) onWire = { momentId: id!, text: p.whisper.text, noteId: p.whisper.noteId };
            }
          } else if (onWire !== null) {
            const w = onWire;
            const ok = await rig.store.transaction(UID, (tx) => admitMoment(tx, UID, w.momentId as never, { responseId: `resp_${admitted}_${moves}`, noteIds: [w.noteId] }, rig.deps));
            if (ok) {
              admitted++;
              expect(w.text).toBe(wishText(headStart, c.zone));
              expect(admitted).toBe(1);
            }
          }
        }
        // An occurrence still ahead after its last move can still be wished.
        if (admitted > 0) return;
        const current = (await rig.store.get<Memory>(UID, paths.memory(UID, head)))!.data;
        const wish = deriveOccasion(current, new Map([[current.logicalId, current]]), rig.deps.hasher).plans.find((p) => p.kind === "wish");
        const world = await worldOf(rig, UID);
        if (wish === undefined || headStart <= world) return;
        await setWorld(rig, UID, Math.max(world, wish.dueAt));
        rig.clock.advance(16 * MINUTE);
        await memoryTick(ctx);
        const [[, row]] = ofKind(await momentsOf(rig, UID), "wish") as unknown as [[string, { status: string; payload: unknown }]];
        expect(row.status).toBe("leased");
        expect(row.payload).toMatchObject({ template: { text: wishText(headStart, c.zone) } });
      }),
      { numRuns: 1000 },
    );
  }, 120_000);
});
