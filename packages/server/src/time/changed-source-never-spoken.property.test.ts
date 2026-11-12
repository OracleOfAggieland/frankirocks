// Feature: brief 036, property 2 "A changed source is never spoken" (spec §5 "rereading state, blocks, life";
// contracts "Commit checks epoch/policy/source/lease/generation/eligibility"). On the server path over the in-memory
// store, with the ops clock moving: a wish is opened and put on the wire, then its source changes (marked wrong,
// set to history, retracted, blocked, superseded by a successor, or forgotten by a root block), with or without a
// tick after. `chooseNow` never chooses a moment from the changed row, and `admitMoment` refuses the line put out
// before the change.
import { type Memory, type Moment, localMinuteAt } from "@franki/core";
import { sampleBlock, testId } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { paths } from "../store/paths";
import { patchRecord, testRig } from "../testing/fakes";
import { chooseNow, proactiveOf } from "./proactive";
import { admitMoment } from "./said";
import { momentsOf, moveOccasion, ofKind, timeTenant, writeOccasion } from "./testing";
import { memoryTick } from "./tick";

const UID = "owner-1";
const DAY = "2026-11-13";
const MINUTE = 60_000;
const STAMP = { sessionId: testId("s"), epoch: 1, policyRev: 1, bundleRev: 1, rulesRev: 1, generation: 1, turnId: testId("t") };
const SIGNALS = { transitionOrCrisis: false, turnsSinceCheckInAnswer: null };
const CHANGES = ["wrong", "history", "retracted", "blocked", "superseded", "rootBlock"] as const;

const caseArb = fc.record({
  zone: fc.constantFrom("America/Chicago", "UTC", "Asia/Kolkata"),
  startMinute: fc.integer({ min: 20, max: 40 }).map((h) => h * 30),
  change: fc.constantFrom(...CHANGES),
  tickAfter: fc.boolean(),
  opsMinutes: fc.integer({ min: 0, max: 14 }),
});

describe("one-shot time, server path: a changed source is never spoken", () => {
  it("chooseNow skips it and admitMoment refuses it", async () => {
    await fc.assert(
      fc.asyncProperty(caseArb, async (c) => {
        const rig = testRig();
        const ctx = await timeTenant(rig, UID, c.zone, localMinuteAt(DAY, 8 * 60 + 40, c.zone)!);
        const start = localMinuteAt(DAY, c.startMinute, c.zone)!;
        const id = await writeOccasion(rig, UID, "0", start, c.zone);
        await memoryTick(ctx);
        const [[wishId, wish]] = ofKind(await momentsOf(rig, UID), "wish") as [[string, Moment]];
        expect(wish.status).toBe("leased");
        const p = (await proactiveOf(ctx, wishId as never, wish, STAMP))!;

        const path = paths.memory(UID, id);
        const source = (await rig.store.get<Memory>(UID, path))!.data;
        if (c.change === "superseded") await moveOccasion(rig, UID, id, testId("occasion-next"), start);
        else if (c.change === "rootBlock") await rig.store.transaction(UID, async (tx) => tx.create(paths.block(UID, testId("block")), { ...sampleBlock({ rootKey: source.rootKeys[0]! }), uid: UID }));
        else await patchRecord<Memory>(rig.store, UID, path, { status: c.change });
        rig.clock.advance(c.opsMinutes * MINUTE);
        if (c.tickAfter) await memoryTick(ctx);

        const { choice, moments } = await chooseNow(ctx, { kind: "opening" }, SIGNALS);
        if (choice.spoken !== null) {
          const m = moments.get(choice.spoken.momentId as never)!;
          // Only a moment re-planned from a live successor may be chosen; never one from the changed row.
          const ref = m.payload.kind === "cue" ? m.payload.noteRef.id : null;
          expect(ref).not.toBe(id);
          const head = ref === null ? null : (await rig.store.get<Memory>(UID, paths.memory(UID, ref)))?.data;
          expect(head?.status).toBe("active");
        }
        const admitted = await rig.store.transaction(UID, (tx) => admitMoment(tx, UID, wishId as never, { responseId: "resp_1", noteIds: [p.whisper.noteId] }, rig.deps));
        expect(admitted).toBe(false);
      }),
      { numRuns: 1000 },
    );
  }, 120_000);
});
