// Feature: the review of what reaches the wire (brief 045, part V), property 3: the sensitivity on the wire is the
// Gate's. For any opened moment chosen for delivery (the interview's wish, or a confirmed reminder whose source
// row is S0 or S1), the `Proactive` that `proactiveOf` puts out carries `whisper.sens` equal to the sensitivity of
// the Gate candidate `chooseNow` judged it by. A reminder is as sensitive as the rows it came from, never S0 by
// default because its cue points at the action and not at a memory.
import { type CoreCounters, type Memory, civilDateAt, msFromTs, tsFromMs } from "@franki/core";
import { sampleTurn, testId } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { storeReader } from "../head-build";
import type { RouteContext } from "../routes/runtime";
import { paths } from "../store/paths";
import { patchRecord, testRig } from "../testing/fakes";
import { resetAs, stateOf } from "../testing/seed";
import { gateCandidateOf } from "./gate-candidate";
import { chooseNow, proactiveOf } from "./proactive";
import { confirmReminder, offerReminder, recordPendingRendered } from "./reminder";
import { momentsOf, ofKind, setWorld } from "./testing";
import { memoryTick } from "./tick";

const UID = "owner-1";
const ZONE = "America/Chicago";
const MINUTE = 60_000;
const STAMP = { sessionId: testId("s"), epoch: 2, policyRev: 1, bundleRev: 1, rulesRev: 1, generation: 1, turnId: testId("t") };
const QUIET = { transitionOrCrisis: false, turnsSinceCheckInAnswer: null };
const NOTES = ["Call the vet", "Bring the portfolio", "Pick up the dry cleaning"] as const;

const caseArb = fc.record({
  kind: fc.constantFrom("wish", "reminder"),
  sens: fc.constantFrom("S0", "S1"),
  note: fc.constantFrom(...NOTES),
  hour: fc.constantFrom("tonight at 10 PM", "tonight at 9 PM", "tonight at 11 PM"),
});

describe("Property 3 (brief 045): the sensitivity on the wire is the Gate's", () => {
  it("whisper.sens equals the Gate candidate's sensitivity", async () => {
    let reached = 0;
    await fc.assert(
      fc.asyncProperty(caseArb, async (c) => {
        const rig = testRig();
        await resetAs(rig, UID, "v1", "r1", ZONE);
        const ctx: RouteContext = { uid: UID, deps: rig.deps, schedule: () => undefined };
        await memoryTick(ctx);
        const wish = ofKind(await momentsOf(rig, UID), "wish")[0]![1];
        const sourceId = wish.payload.kind === "cue" ? wish.payload.noteRef.id : "";
        await patchRecord<Memory>(rig.store, UID, paths.memory(UID, sourceId), { sens: c.sens });
        let momentId: string;
        if (c.kind === "wish") {
          await memoryTick(ctx);
          momentId = ofKind(await momentsOf(rig, UID), "wish")[0]![0];
        } else {
          const world = msFromTs((await stateOf(rig.store, UID)).worldClock!);
          const offer = offerReminder(rig.deps.hasher, { sourceId, note: c.note, spoken: c.hour, worldNow: world, zone: ZONE });
          if (offer === null) return;
          await rig.store.transaction(UID, (t) => recordPendingRendered(t, UID, offer.pendingId, rig.clock.read().opsClock.now, rig.deps.hasher));
          rig.clock.advance(MINUTE);
          const yes = sampleTurn({ text: "Yes.", sourceClass: "U", final: true, role: "user", committedAt: tsFromMs(rig.clock.read().opsClock.now) });
          const applied = await confirmReminder(ctx, offer, offer.yesId, yes);
          if (applied.state !== "applied") return;
          momentId = applied.momentId;
          await setWorld(rig, UID, msFromTs(offer.time.start));
          const counters = await rig.store.get<CoreCounters>(UID, paths.core(UID, "counters"));
          await patchRecord<CoreCounters>(rig.store, UID, paths.core(UID, "counters"), { day: civilDateAt(msFromTs(offer.time.start), ZONE), heavy: 0, counts: counters!.data.counts.filter((k) => k.kind !== "speech") });
          await memoryTick(ctx);
        }
        const { choice, moments } = await chooseNow(ctx, { kind: "opening" }, QUIET);
        if (choice.spoken?.momentId !== momentId) return;
        const m = moments.get(momentId as never)!;
        const world = msFromTs((await stateOf(rig.store, UID)).worldClock!);
        const candidate = (await gateCandidateOf(storeReader(rig.store, UID), UID, momentId as never, m, world))!;
        const p = await proactiveOf(ctx, momentId as never, m, STAMP);
        if (p === null) return;
        reached += 1;
        expect(p.whisper.sens, `${c.kind} from an ${c.sens} source`).toBe(candidate.sens);
      }),
      { numRuns: 1_000 },
    );
    expect(reached).toBeGreaterThanOrEqual(200);
  }, 600_000);
});
