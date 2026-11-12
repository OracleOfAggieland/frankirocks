// Feature: brief 036, property 6 "Every spoken choice passed the Gate" (spec §6 "a pure function that runs before
// any speaking model sees the text"; brief 036 finding 3: the Gate runs inside chooseNow, for every candidate). On
// the server path over the in-memory store, with the ops clock moving: for any audience, modifiers, transition and
// check-in signals, session mode, world time, and an occasion of any source class, sensitivity and gravity,
// whatever `chooseNow` returns as spoken has a Gate verdict of `say` for that same moment and context, and never one
// that needs a sender's attribution, which a code-worded moment line doesn't carry.
import { type GateCandidate, type GateContext, type Memory, type Moment, civilDateAt, gate, localMinuteAt, todayCounts, tsFromMs } from "@franki/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { paths } from "../store/paths";
import { testRig } from "../testing/fakes";
import { readCoreDocs } from "../core-docs";
import { chooseNow } from "./proactive";
import { timeTenant, writeOccasion } from "./testing";
import { memoryTick } from "./tick";

const UID = "owner-1";
const DAY = "2026-11-13";
const ZONE = "America/Chicago";
const MINUTE = 60_000;

const caseArb = fc.record({
  sourceClass: fc.constantFrom("U", "C", "O", "T", "M"),
  sens: fc.constantFrom("S0", "S1", "S2"),
  gravity: fc.constantFrom(0, 1, 2, 3),
  startMinute: fc.integer({ min: 18, max: 40 }).map((h) => h * 30),
  worldMinute: fc.integer({ min: 7 * 60, max: 23 * 60 }),
  opsMinutes: fc.integer({ min: 0, max: 14 }),
  audience: fc.constantFrom("private", "company", "unknown"),
  rushed: fc.boolean(),
  crisis: fc.boolean(),
  transition: fc.boolean(),
  turnsSinceCheckInAnswer: fc.option(fc.nat(4), { nil: null }),
  opening: fc.boolean(),
});

const PURPOSE: Partial<Record<Moment["kind"], GateCandidate["purpose"]>> = { wish: "wish", checkIn: "item" };

describe("one-shot time, server path: every spoken choice passed the Gate", () => {
  it("chooseNow speaks only what the Gate says, in the same context", async () => {
    await fc.assert(
      fc.asyncProperty(caseArb, async (c) => {
        const rig = testRig();
        const ctx = await timeTenant(rig, UID, ZONE, localMinuteAt(DAY, 6 * 60, ZONE)!);
        const id = await writeOccasion(rig, UID, "0", localMinuteAt(DAY, c.startMinute, ZONE)!, ZONE, { sourceClass: c.sourceClass, sens: c.sens, gravity: c.gravity });
        const world = localMinuteAt(DAY, c.worldMinute, ZONE)!;
        await rig.store.transaction(UID, async (tx) => {
          const s = await tx.get<{ worldClock: string }>(paths.core(UID, "state"));
          tx.update(paths.core(UID, "state"), { ...s!.data, worldClock: tsFromMs(world) });
        });
        await memoryTick(ctx);
        rig.clock.advance(c.opsMinutes * MINUTE);
        const mode = c.opening ? ({ kind: "opening" } as const) : ({ kind: "session", listening: true, silentMs: 9_000 } as const);
        const signals = { transition: c.transition, crisis: c.crisis, turnsSinceCheckInAnswer: c.turnsSinceCheckInAnswer, audience: c.audience, rushed: c.rushed };
        const { choice, moments } = await chooseNow(ctx, mode, signals);
        if (choice.spoken === null) return;
        const m = moments.get(choice.spoken.momentId as never)!;
        const source = (await rig.store.get<Memory>(UID, paths.memory(UID, id)))!.data;
        const core = await readCoreDocs({ get: (p) => rig.store.get(UID, p) }, UID);
        const candidate: GateCandidate = {
          id: choice.spoken.momentId as never,
          kind: "moment",
          subjectId: "self",
          sourceClass: c.sourceClass,
          sens: c.sens,
          allergy: false,
          eligibility: { allow: true, reason: "ok" },
          toldAt: c.sourceClass === "U" || c.sourceClass === "C" ? source.assertedAt : null,
          topic: null,
          queryTerms: [],
          aliases: [],
          purpose: PURPOSE[m.kind] ?? "item",
          gravity: c.gravity as 0 | 1 | 2 | 3,
          food: false,
          mustSay: null,
          dueAt: m.dueAt,
          sender: c.sourceClass === "T" ? { mailedByOwner: false } : null,
          attestedPremises: 0,
          offerUsed: false,
          ownRooted: false,
          checkInUsed: false,
          act: "say",
        };
        const recentTurns = [
          ...(c.transition || c.crisis ? [{ role: "user" as const, checkInAnswer: false, transitionOrCrisis: true }] : []),
          ...(c.turnsSinceCheckInAnswer === null ? [] : [{ role: "user" as const, checkInAnswer: true, transitionOrCrisis: false }, ...Array.from({ length: c.turnsSinceCheckInAnswer }, () => ({ role: "user" as const, checkInAnswer: false, transitionOrCrisis: false }))]),
        ];
        const today = todayCounts(core.counters.data, civilDateAt(world, ZONE));
        const x: GateContext = {
          worldNow: tsFromMs(world),
          zone: ZONE,
          build: "floor",
          audience: c.audience,
          modifiers: { rushed: c.rushed, crisis: c.crisis },
          trigger: "unprompted",
          moment: c.opening ? "opener" : "idle",
          ownerTurn: null,
          openedTopics: [],
          recentTurns,
          counts: { proactive: today.proactive, heavy: today.heavy, senderAsks: 0, notesThisReply: 0 },
          rules: "ready",
          authorization: null,
        };
        const g = gate(candidate, x);
        expect(g.verdict).toBe("say");
        expect(g.render).not.toBe("attributed");
      }),
      { numRuns: 1000 },
    );
  }, 120_000);
});
