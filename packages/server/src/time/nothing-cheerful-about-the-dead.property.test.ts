// Feature: brief 041 part 3, Property 6: nothing cheerful about the dead (spec §7, the death row: linked memories are
// reply-only, the birthday guarded at fire time). On the server path over the in-memory store: for any plan of
// occasions, some about a person and some not, and a death of that person committed before the tick, between the tick
// and the choice, or between the choice and the admission, no wish, check-in, celebrate or insight naming or rooted in
// that person is chosen or admitted after the death commits.
import { type Memory, type Moment, localMinuteAt } from "@franki/core";
import { testId } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { paths } from "../store/paths";
import { testRig } from "../testing/fakes";
import { chooseNow } from "./proactive";
import { admitMoments } from "./said";
import { momentsOf, setWorld, timeTenant, writeOccasion } from "./testing";
import { memoryTick } from "./tick";
import { momentNoteId } from "./verdict";

const UID = "owner-1";
const DAY = "2026-11-13";
const MINUTE = 60_000;
const MOM = testId("mom");
const CHEERFUL: readonly Moment["kind"][] = ["wish", "checkIn", "celebrate", "insight"];

const caseArb = fc.record({
  zone: fc.constantFrom("America/Chicago", "UTC", "Asia/Kolkata"),
  occasions: fc.array(fc.record({ start: fc.integer({ min: 18, max: 40 }).map((h) => h * 30), about: fc.constantFrom("subject", "entity", "nobody") }), { minLength: 1, maxLength: 3 }),
  worldMinute: fc.integer({ min: 6 * 60, max: 23 * 60 }),
  death: fc.constantFrom("beforeTick", "beforeChoice", "beforeAdmission"),
  mode: fc.oneof(fc.constant({ kind: "opening" as const }), fc.record({ kind: fc.constant("session" as const), listening: fc.constant(false), silentMs: fc.constant(20_000) })),
});

describe("Property 6 (brief 041): nothing cheerful about the dead", () => {
  it("no wish, check-in, celebrate or insight about the dead is chosen or admitted after the death", async () => {
    await fc.assert(
      fc.asyncProperty(caseArb, async (c) => {
        const rig = testRig();
        const ctx = await timeTenant(rig, UID, c.zone, localMinuteAt(DAY, 6 * 60, c.zone)!);
        for (const [i, o] of c.occasions.entries()) {
          const about: Partial<Memory> = o.about === "subject" ? { subjectId: MOM, entityIds: [MOM] } : o.about === "entity" ? { entityIds: [MOM] } : {};
          await writeOccasion(rig, UID, String(i), localMinuteAt(DAY, o.start, c.zone)!, c.zone, about);
        }
        const die = () =>
          writeOccasion(rig, UID, "death", 0, c.zone, { kind: "fact", predicate: "person.life", subjectId: MOM, entityIds: [MOM], value: { kind: "enum", code: "deceased" }, args: { detail: null }, gravity: 3, time: null, when: { kind: "none" } });
        await setWorld(rig, UID, localMinuteAt(DAY, c.worldMinute, c.zone)!);
        if (c.death === "beforeTick") await die();
        await memoryTick(ctx);
        if (c.death === "beforeChoice") await die();
        const { choice, moments } = await chooseNow(ctx, c.mode, { transition: false, crisis: false, turnsSinceCheckInAnswer: null });
        const aboutMom = async (m: Moment) => {
          if (m.subjectIds.includes(MOM)) return true;
          const source = m.memoryId === null ? null : await rig.store.get<Memory>(UID, paths.memory(UID, m.memoryId));
          return source !== null && (source.data.subjectId === MOM || source.data.entityIds.includes(MOM));
        };
        const spoken = choice.spoken === null ? null : moments.get(choice.spoken.momentId as never)!;
        if (c.death !== "beforeAdmission" && spoken !== null && CHEERFUL.includes(spoken.kind)) expect(await aboutMom(spoken), `${spoken.kind} about the dead was chosen`).toBe(false);
        if (c.death === "beforeAdmission") await die();
        // Every leased moment is offered for admission, as a receipt naming all of them would.
        const leased = [...(await momentsOf(rig, UID)).entries()].filter(([, m]) => m.status === "leased");
        const noteIds = leased.map(([id, m]) => momentNoteId(rig.deps.hasher, id, m));
        const admitted = await rig.store.transaction(UID, (tx) => admitMoments(tx, UID, leased.map(([id]) => id as never), { responseId: "resp_1", noteIds }, rig.deps));
        const all = await momentsOf(rig, UID);
        for (const id of admitted) {
          const m = all.get(id)!;
          if (CHEERFUL.includes(m.kind)) expect(await aboutMom(m), `${m.kind} about the dead was admitted`).toBe(false);
        }
        rig.clock.advance(16 * MINUTE);
        await memoryTick(ctx);
        for (const [, m] of await momentsOf(rig, UID)) if (CHEERFUL.includes(m.kind) && (await aboutMom(m))) expect(["pending", "cancelled", "expired", "skipped"]).toContain(m.status);
      }),
      { numRuns: 1000 },
    );
  }, 600_000);
});
