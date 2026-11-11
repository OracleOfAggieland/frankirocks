// Feature: voice-writes (brief 012), Property 6: A past fact never demotes the present, pure (design section 7 and
// 6.6; spec §4; contracts §7 "past never demotes current"). An interval entirely in the past inserts as history and
// leaves the current value alone:
//   - `place` gives `history` for any known end at or before now, whatever the start, and `closesCurrent` is false
//     for it unless the change is a correction (which closes its own targets, design 6.6);
//   - `applyCorrection` of a `history` row (G24: the successor keeps the corrected row's interval) plans a
//     successor placed in history and leaves the current row's status and `validTo` unchanged.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Class, msFromTs, tsFromMs } from "../schema/primitives";
import type { Memory } from "../schema/records";
import { testId } from "../testing/samples";
import { closesCurrent, place } from "./bitemporal";
import { applyCorrection } from "./correction";
import { DAD, NOW, PRIOR, PRIOR_EID, TURN_AT, TURN_EID, buildEvidence, planEnv, row, spanAt } from "./testing/arb-writes";
import type { PlacementChange } from "./types";

const DAY = 86_400_000;
const now = msFromTs(NOW);

/** A past interval: `to` at or before now (now itself weighted), `from` unknown, equal to `to`, or earlier. */
const pastArb = fc
  .record({
    back: fc.oneof({ weight: 2, arbitrary: fc.constant(0) }, { weight: 1, arbitrary: fc.constant(1) }, { weight: 5, arbitrary: fc.integer({ min: 0, max: 3_650 * DAY }) }),
    from: fc.oneof(fc.constant<"unknown">("unknown"), fc.constant<"same">("same"), fc.integer({ min: 1, max: 3_650 * DAY })),
  })
  .map(({ back, from }) => {
    const to = now - back;
    return { to, from: from === "unknown" ? null : from === "same" ? to : to - from };
  });

const SHAPES = [
  { predicate: "person.life" as const, subject: DAD, old: "ill", current: "recovered", fixes: ["hospitalized", "recovering", "alive"], text: "No, he was in hospital then, not ill." },
  { predicate: "employment.status" as const, subject: "self", old: "working", current: "retired", fixes: ["seeking", "studying", "between_jobs"], text: "No, I was studying back then, not working." },
];

describe("Property 6: a past fact never demotes the present (pure)", () => {
  it("place gives history for a known end at or before now, and it closes nothing", () => {
    fc.assert(
      fc.property(pastArb, fc.constantFrom<Class>("U", "C"), fc.constantFrom<PlacementChange>("none", "transition"), (iv, cls, change) => {
        const p = place({ from: iv.from, to: iv.to, cls, change }, now);
        expect(p).toBe("history");
        expect(closesCurrent(p, change)).toBe(false);
      }),
      { numRuns: 500 },
    );
  });

  it("correcting a past row writes its successor in history and leaves the current row alone", () => {
    fc.assert(
      fc.property(pastArb, fc.nat(2), fc.nat(2), fc.integer({ min: 0, max: 30 * DAY }), (iv, si, fi, gap) => {
        const shape = SHAPES[si % SHAPES.length]!;
        const fix = shape.fixes[fi % shape.fixes.length]!;
        const args = shape.predicate === "person.life" ? { detail: null } : {};
        const phrase = "My dad lives in Leeds";
        const past: Memory = {
          ...row(testId(`past${si}`), { subjectId: shape.subject, predicate: shape.predicate, value: { kind: "enum", code: shape.old }, args }, PRIOR, PRIOR_EID, phrase),
          status: "history",
          validFrom: iv.from === null ? null : tsFromMs(iv.from),
          validFromKnown: iv.from !== null,
          validTo: tsFromMs(iv.to),
          closeReason: "lapsed",
        };
        // The current row starts at or after the past row's end, and covers now.
        const currentFrom = Math.min(now, iv.to + gap);
        const current: Memory = {
          ...row(testId(`current${si}`), { subjectId: shape.subject, predicate: shape.predicate, value: { kind: "enum", code: shape.current }, args }, PRIOR, PRIOR_EID, phrase),
          validFrom: tsFromMs(currentFrom),
          validFromKey: tsFromMs(currentFrom),
        };
        const turn = buildEvidence(TURN_EID, shape.text, [], ["U"], TURN_AT);
        const proof = spanAt(TURN_EID, shape.text, 0, shape.text.length - 1);
        const rows = new Map<string, Memory>([
          [past.logicalId, past],
          [current.logicalId, current],
        ]);
        const plan = applyCorrection({ kind: "correct", targets: [past.logicalId], value: { kind: "enum", code: fix }, args }, rows, planEnv(turn, TURN_EID, proof, [past]));
        expect(plan.ok, JSON.stringify(plan)).toBe(true);
        if (!plan.ok) return;
        const puts = plan.commands.flatMap((c) => (c.op === "putMemory" ? [c] : []));
        for (const c of puts.filter((c) => c.id === current.logicalId)) {
          expect(c.row.status, "the current row's status").toBe(current.status);
          expect(c.row.validTo, "the current row's validTo").toBe(current.validTo);
        }
        const successors = puts.filter((c) => c.id !== past.logicalId && c.id !== current.logicalId && c.row.subjectId === shape.subject && c.row.predicate === shape.predicate);
        expect(successors.length, "one successor").toBe(1);
        const s = successors[0]!.row;
        expect(s.status, "the successor of a past row").toBe("history");
        expect(s.value).toEqual({ kind: "enum", code: fix });
        expect(s.validTo).not.toBeNull();
        expect(msFromTs(s.validTo!)).toBeLessThanOrEqual(now);
      }),
      { numRuns: 300 },
    );
  });
});
