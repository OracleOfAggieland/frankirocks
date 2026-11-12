// Brief 042 property 2, "Every verdict that is not say has exactly one row": for any candidates, audience and
// modifiers, the rows written for a delivery choice are one per held, steered or blocked candidate, and none for the
// chosen one until it is said. Seed recorded in brief 042's Outcome.
import { type Ledger, type Session, gateOutcome, tsFromMs } from "@franki/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { gateRowId } from "../ledger/said";
import { paths } from "../store/paths";
import { patchRecord, settle, testRig } from "../testing/fakes";
import { resetAs } from "../testing/seed";
import { openTestSession } from "../testing/session-fixtures";
import { chooseNow } from "../time/proactive";
import { memoryTick } from "../time/tick";
import { deliveryTurnId, idleProactive, openingProactive, signalsOf } from "./delivery-wire";

const UID = "owner-1";

describe("property: every verdict that is not say has exactly one row (brief 042)", () => {
  it("1,000 runs", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 40 }),
        fc.integer({ min: 0, max: 23 }),
        fc.constantFrom<"private" | "company" | "unknown">("private", "company", "unknown"),
        fc.boolean(),
        fc.boolean(),
        fc.array(fc.constantFrom<"opening" | "idle">("opening", "idle"), { minLength: 1, maxLength: 3 }),
        async (days, hour, audience, crisis, rushed, calls) => {
          const rig = testRig();
          await resetAs(rig, UID, "v1", "r1");
          rig.clock.advance((days * 24 + hour) * 60 * 60_000);
          const ctx = { uid: UID, deps: rig.deps, schedule: () => undefined };
          await settle(memoryTick(ctx), rig.clock, rig.timers);
          const s = await openTestSession(rig, "o1", `token:${UID}`);
          const now = tsFromMs(rig.clock.read().opsClock.now);
          await patchRecord<Session>(rig.store, UID, paths.session(UID, s.sessionId), { audience, modifiers: { rushed: rushed ? now : null, crisis: crisis ? now : null }, lastTurnAt: tsFromMs(rig.clock.read().opsClock.now - 60 * 60_000) });
          const turnId = deliveryTurnId(rig.deps.hasher, s.sessionId);
          const rowsOf = async () =>
            (await rig.store.query<Ledger>(UID, { collection: paths.collection(UID, "ledger"), where: [], orderBy: { field: "__name__", dir: "asc" }, limit: 100 })).filter(
              (d) => d.data.kind === "gate" && (d.data.payload as { turnId: string | null }).turnId === turnId,
            );
          for (const c of calls) {
            const before = new Set((await rowsOf()).map((d) => d.id));
            const session = (await rig.store.get<Session>(UID, paths.session(UID, s.sessionId)))!.data;
            const mode = c === "opening" ? ({ kind: "opening" } as const) : ({ kind: "session", listening: true, silentMs: 60 * 60_000 } as const);
            const now2 = (await settle(chooseNow(ctx, mode, signalsOf(session, rig.clock.read().opsClock.now, null)), rig.clock, rig.timers)).value;
            const expected = new Set<string>();
            for (const v of now2.verdicts ?? []) {
              const outcome = gateOutcome(v.result);
              if (outcome !== null) expected.add(gateRowId(rig.deps.hasher, UID, { outcome, candidateId: v.momentId, turnId, momentId: v.momentId, noteIds: [] }));
            }
            await settle(c === "opening" ? openingProactive(ctx, s.stamp, 3_000) : idleProactive(ctx, s.stamp), rig.clock, rig.timers);
            const all = await rowsOf();
            const added = all.filter((d) => !before.has(d.id));
            // Each verdict that was not `say` has its row (written now or by an earlier choice in this Session), and
            // this choice wrote nothing else: one row per candidate, never twice (the IDs are the rows' own).
            for (const id of expected) expect(all.some((d) => d.id === id)).toBe(true);
            expect(added.every((d) => expected.has(d.id))).toBe(true);
            // None for the chosen one.
            const spoken = now2.choice.spoken?.momentId ?? null;
            expect(added.some((d) => (d.data.payload as { candidateId: string }).candidateId === spoken)).toBe(false);
          }
        },
      ),
      { numRuns: 1000, seed: 42_044 },
    );
  }, 1_200_000);
});
