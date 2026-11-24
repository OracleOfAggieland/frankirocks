// Kiroween Demo, property 14 (R7.2, R7.3, R7.9; contract question 97): no first meeting for Jeffrey. For any
// `MeetConditions`, any two delivery rows (none, said in some Session, or `met`) and any record of which Sessions had a
// call: `meetOffer` is null and `meetSessionsToRead` is empty when `demo` is true; with `demo` absent or false both
// return exactly what they return without the field (owner ruling M-1 holds for every other visit).
import type { ID, Ledger } from "@franki/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type MeetConditions, type MeetRows, meetOffer, meetSessionsToRead } from "../meet";

type Decision = Extract<Ledger, { kind: "decision" }>;

const SESSIONS = ["s-a", "s-b", "s-c"] as const;

/** A delivery row as `recordMeetSaid` and `closeMeet` write it, cut to what the first meeting reads. */
const rowArb: fc.Arbitrary<Decision | null> = fc.oneof(
  fc.constant(null),
  fc.constant({ kind: "decision", createdAt: "2026-11-03T12:00:00.000Z", payload: { acceptedRefs: [] } } as unknown as Decision),
  fc.constantFrom(...SESSIONS).map(
    (s) =>
      ({
        kind: "decision",
        createdAt: "2026-11-03T12:00:00.000Z",
        payload: { acceptedRefs: [{ type: "turn", id: `t-${s}`, parentId: s, rev: 1 }, { type: "ledger", id: `p-${s}`, rev: 1 }] },
      }) as unknown as Decision,
  ),
);
const rowsArb: fc.Arbitrary<MeetRows> = fc.tuple(rowArb, rowArb);

const conditionsArb: fc.Arbitrary<Omit<MeetConditions, "demo">> = fc.record({
  surface: fc.constantFrom<MeetConditions["surface"]>("call", "call", "typed"),
  acked: fc.boolean(),
  inherited: fc.boolean(),
  audience: fc.constantFrom("private", "private", "company", "unknown"),
  crisis: fc.boolean(),
  held: fc.boolean(),
  named: fc.boolean(),
});

const hadCallArb: fc.Arbitrary<ReadonlyMap<string, boolean>> = fc
  .tuple(...SESSIONS.map(() => fc.option(fc.boolean(), { nil: undefined })))
  .map((xs) => new Map(SESSIONS.flatMap((s, i) => (xs[i] === undefined ? [] : [[s, xs[i]!] as [string, boolean]]))));

describe("no first meeting for Jeffrey (Kiroween Demo property 14)", () => {
  it("property: demo true offers nothing and reads nothing; absent or false is today's answer", () => {
    fc.assert(
      fc.property(rowsArb, conditionsArb, hadCallArb, fc.constantFrom<boolean | undefined>(true, false, undefined), (rows, base, hadCall, demo) => {
        const today = { offer: meetOffer(rows, base, hadCall), read: meetSessionsToRead(rows, base) };
        const c: MeetConditions = demo === undefined ? base : { ...base, demo };
        const offer = meetOffer(rows, c, hadCall);
        const read = meetSessionsToRead(rows, c);
        if (demo === true) {
          expect(offer).toBeNull();
          expect(read).toEqual([]);
          return;
        }
        expect(offer).toEqual(today.offer);
        expect(read).toEqual(today.read);
      }),
      { numRuns: 1_000 },
    );
  });

  it("the conditions under which a sample visit is asked offer nothing on a demo visit", () => {
    const sample: MeetConditions = { surface: "call", acked: false, inherited: false, audience: "private", crisis: false, held: false, named: false };
    expect(meetOffer([null, null], sample)).toEqual({ n: 1, replaces: null });
    expect(meetOffer([null, null], { ...sample, demo: true })).toBeNull();
    const unheard = { kind: "decision", createdAt: "x", payload: { acceptedRefs: [{ type: "turn", id: "t", parentId: "s-a" as ID, rev: 1 }] } } as unknown as Decision;
    expect(meetSessionsToRead([unheard, null], sample)).toEqual(["s-a"]);
    expect(meetSessionsToRead([unheard, null], { ...sample, demo: true })).toEqual([]);
  });
});
