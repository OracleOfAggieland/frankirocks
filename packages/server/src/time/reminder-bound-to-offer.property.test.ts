// Feature: brief 036, property 7 "A reminder is bound to its offer" (contracts §6 "pendingRendered binds exact
// pending/options/stamp", "Executors: answer CAS resolves rendered pending+ledger action once"; spec §6 "Side
// effects need explicit confirmation"). On the server path over the in-memory store, with the ops clock moving: for
// any sequence of renders, answers (yes or no, for the offer as rendered or with its time or note swapped under the
// same pending ID), corrections of the source, ticks and time passing, the reminder executes only for the exact
// offer that was rendered, only for a yes after the render, never after a no, and never once its source is
// corrected; a reminder whose source was corrected never opens.
import { type Memory, localMinuteAt, msFromTs, tsFromMs } from "@franki/core";
import { sampleTurn } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { paths } from "../store/paths";
import { patchRecord, testRig } from "../testing/fakes";
import { type ReminderOffer, confirmReminder, offerReminder, recordPendingRendered } from "./reminder";
import { momentsOf, setWorld, timeTenant, writeOccasion } from "./testing";
import { memoryTick } from "./tick";

const UID = "owner-1";
const DAY = "2026-11-13";
const MINUTE = 60_000;
const ZONE = "America/Chicago";

const step = fc.oneof(
  fc.constant({ k: "render" as const }),
  fc.record({ k: fc.constant("answer" as const), yes: fc.boolean(), offer: fc.constantFrom("exact", "otherNote", "otherTime") }),
  fc.constant({ k: "correct" as const }),
  fc.record({ k: fc.constant("ops" as const), minutes: fc.integer({ min: 0, max: 3 }) }),
);
const caseArb = fc.array(step, { minLength: 1, maxLength: 8 });

describe("one-shot time, server path: a reminder is bound to its offer", () => {
  it("executes only for the exact rendered offer, after the render, never after a no or a correction", async () => {
    await fc.assert(
      fc.asyncProperty(caseArb, async (steps) => {
        const rig = testRig();
        const world = localMinuteAt(DAY, 8 * 60 + 40, ZONE)!;
        const ctx = await timeTenant(rig, UID, ZONE, world);
        const sourceId = await writeOccasion(rig, UID, "0", localMinuteAt(DAY, 14 * 60, ZONE)!, ZONE);
        const offer = offerReminder(rig.deps.hasher, { sourceId, note: "Bring the portfolio", spoken: "tomorrow at 9", worldNow: world, zone: ZONE })!;
        const other = offerReminder(rig.deps.hasher, { sourceId, note: "Bring the portfolio", spoken: "tomorrow at 10", worldNow: world, zone: ZONE })!;
        const variants: Record<string, ReminderOffer> = { exact: offer, otherNote: { ...offer, note: "Wire the money" }, otherTime: { ...offer, time: other.time } };
        let renderedAt: number | null = null;
        let declined = false;
        let corrected = false;
        let applied = false;
        for (const s of steps) {
          const ops = rig.clock.read().opsClock.now;
          if (s.k === "render") {
            await rig.store.transaction(UID, (tx) => recordPendingRendered(tx, UID, offer.pendingId, ops, rig.deps.hasher));
            renderedAt ??= ops;
          } else if (s.k === "correct") {
            await patchRecord<Memory>(rig.store, UID, paths.memory(UID, sourceId), { status: "wrong" });
            corrected = true;
          } else if (s.k === "ops") rig.clock.advance(s.minutes * MINUTE);
          else {
            const o = variants[s.offer]!;
            const turn = sampleTurn({ text: s.yes ? "Yes." : "No.", sourceClass: "U", final: true, role: "user", committedAt: tsFromMs(ops) });
            const out = await confirmReminder(ctx, o, s.yes ? o.yesId : o.noId, turn);
            if (!s.yes) {
              if (!applied) declined = true;
              continue;
            }
            if (out.state === "applied") {
              // A retry of an applied yes answers the same; the first apply needs every condition.
              if (!applied) {
                expect(s.offer).toBe("exact");
                expect(renderedAt).not.toBeNull();
                expect(ops).toBeGreaterThan(renderedAt!);
                expect(declined).toBe(false);
                expect(corrected).toBe(false);
              }
              applied = true;
            }
          }
        }
        if (!applied || !corrected) return;
        // A reminder whose source was corrected never opens.
        await setWorld(rig, UID, msFromTs(offer.time.start));
        rig.clock.advance(MINUTE);
        await memoryTick(ctx);
        const due = [...(await momentsOf(rig, UID)).values()].filter((m) => m.kind === "commitmentDue");
        for (const m of due) expect(m.status).not.toBe("leased");
      }),
      { numRuns: 1000 },
    );
  }, 120_000);
});
