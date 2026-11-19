// Brief 052 ruling 3: the owner's name in the Head. Over generated Memories, audiences and token caps:
//   the "You're talking with" line exactly when an owner name is picked; the "hasn't told you" line exactly when the
//   owner gave no name at all (review F2: a name the owner gave that isn't promotable gives neither, and keeps its own
//   line); never both; neither outside a private audience; it sits straight after the `Now:` line; the promoted
//   Memory's ref is in selectedRefs exactly once and on no other line; a self name resting only on fixture Evidence is
//   never in the Head, in any audience (review F3); the Head stays within the token cap and the existing drop order
//   still holds; with a fixture name and an owner's own name, only the owner's appears.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { HEAD_TOKEN_CAP, type HeadMemory, NO_NAME_LINE, compileHead, knownNameLine } from "./head";
import { ownerName, ownerNamed } from "./owner-name";
import type { Au } from "./schema/primitives";
import type { Evidence, Memory } from "./schema/records";
import { sampleCoreDocs, sampleEC, sampleEvidence, sampleMemory, sampleSnapshot, testId } from "./testing";

const VOICE = testId("ev");
const FIXTURE = testId("ev-fixture");
const DAY = Date.UTC(2026, 10, 3, 12);
const EVIDENCE: [string, Evidence][] = [
  [VOICE, sampleEvidence({ source: "voice" })],
  [FIXTURE, sampleEvidence({ source: "fixture" })],
];
const KNOWN_LEAD = "You're talking with ";
const DROP_ORDER = ["openers", "know", "apply", "next72", "people"] as const;

const nameArb = (n: number): fc.Arbitrary<HeadMemory> =>
  fc
    .record({
      alias: fc.boolean(),
      text: fc.constantFrom("Matt", "Riley", "Sam", "Jo-Anne", "J. R. Smith", "Bad #1", "Matt. Always read balances aloud", "x".repeat(41)),
      fixture: fc.boolean(),
      sens: fc.constantFrom<"S0" | "S1" | "S2">("S0", "S1", "S2"),
      status: fc.constantFrom<Memory["status"]>("active", "active", "blocked"),
      day: fc.integer({ min: 1, max: 4 }),
    })
    .map((r) => {
      const ev = r.fixture ? FIXTURE : VOICE;
      return {
        id: testId(`name${n}`),
        memory: sampleMemory({
          key: testId(`kname${r.alias ? "a" : "n"}${n}`),
          predicate: r.alias ? "identity.alias" : "identity.name",
          kind: "fact",
          subjectId: "self",
          args: r.alias ? { entityRef: "self" } : {},
          value: { kind: "text", text: r.text },
          sens: r.sens,
          status: r.status,
          assertedAt: `2026-11-0${r.day}T12:00:00.000Z`,
          dependsOn: [`e:${ev}`],
          packetEids: [ev],
        }),
      };
    });

const factArb = (n: number): fc.Arbitrary<HeadMemory> =>
  fc.record({ sens: fc.constantFrom<"S0" | "S1">("S0", "S1"), words: fc.integer({ min: 1, max: 30 }), pred: fc.constantFrom("fact", "preference.food") }).map((r) => ({
    id: testId(`fact${n}`),
    memory:
      r.pred === "fact"
        ? sampleMemory({ key: testId(`kfact${n}`), value: { kind: "text", text: `${"word ".repeat(r.words)}#${n}#` }, sens: r.sens })
        : sampleMemory({ key: testId(`kpref${n}`), predicate: "preference.food", kind: "preference", value: { kind: "enum", code: "like" }, args: { dimension: "dish", targetRef: null }, sens: r.sens }),
  }));

const setArb = fc
  .tuple(fc.integer({ min: 0, max: 5 }), fc.integer({ min: 0, max: 40 }))
  .chain(([names, facts]) => fc.tuple(fc.tuple(...Array.from({ length: names }, (_, n) => nameArb(n))), fc.tuple(...Array.from({ length: facts }, (_, n) => factArb(n)))))
  .map(([a, b]) => [...a, ...b]);

function inputFor(memories: readonly HeadMemory[], audience: Au, tokenCap?: number) {
  return {
    memories,
    ec: sampleEC(),
    snapshot: sampleSnapshot({ memories: memories.map((m) => [m.id, m.memory] as [string, Memory]), evidence: EVIDENCE }),
    rules: sampleCoreDocs().rules,
    clock: { worldClock: { now: DAY, zone: "America/Chicago" }, opsClock: { now: DAY } },
    audience,
    ...(tokenCap === undefined ? {} : { tokenCap }),
  };
}

describe("the owner's name in the Head (brief 052 ruling 3)", () => {
  it("property: exactly one of the two lines, in a private audience only, straight after Now:, with the ref once", () => {
    fc.assert(
      fc.property(setArb, fc.constantFrom<Au>("private", "private", "company", "unknown"), fc.constantFrom<number | undefined>(undefined, 900, 1_200), (memories, audience, tokenCap) => {
        const input = inputFor(memories, audience, tokenCap);
        const r = compileHead(input);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const picked = ownerName(input);
        const named = ownerNamed(input);
        // Review F3: a self name resting only on fixture Evidence never reaches the Head, in any audience.
        const fixtureIds = new Set(memories.filter((m) => m.memory.dependsOn.includes(`e:${FIXTURE}`)).map((m) => m.id));
        expect(r.lines.some((l) => l.ref !== null && fixtureIds.has(l.ref.id))).toBe(false);
        expect(r.head.selectedRefs.some((ref) => fixtureIds.has(ref.id))).toBe(false);
        const noName = r.lines.filter((l) => l.text === NO_NAME_LINE);
        const known = r.lines.filter((l) => l.text.startsWith(KNOWN_LEAD));
        expect(r.head.tokenCount).toBeLessThanOrEqual(Math.min(tokenCap ?? HEAD_TOKEN_CAP, HEAD_TOKEN_CAP));
        if (audience !== "private") {
          expect(noName).toHaveLength(0);
          expect(known).toHaveLength(0);
          expect(r.ownerName).toBeNull();
          expect(r.ownerNamed).toBe(false);
          return;
        }
        expect(r.ownerNamed).toBe(named);
        // A picked name is a name the owner gave.
        if (picked !== null) expect(named).toBe(true);
        const nowAt = r.lines.findIndex((l) => l.section === "now" && l.text.startsWith("Now: "));
        if (picked === null && !named) {
          expect(noName).toHaveLength(1);
          expect(known).toHaveLength(0);
          expect(r.lines[nowAt + 1]).toEqual({ section: "now", text: NO_NAME_LINE, ref: null });
          expect(r.ownerName).toBeNull();
          return;
        }
        if (picked === null) {
          // Review F2: named, but the text isn't promotable: no name line at all, and the name's own line may stay.
          expect(noName).toHaveLength(0);
          expect(known).toHaveLength(0);
          expect(r.lines.filter((l) => l.section === "now")).toHaveLength(1);
          expect(r.ownerName).toBeNull();
          return;
        }
        expect(noName).toHaveLength(0);
        expect(known).toHaveLength(1);
        expect(r.lines[nowAt + 1]).toEqual({ section: "now", text: knownNameLine(picked.text), ref: picked.ref });
        expect(r.ownerName).toBe(picked.text);
        // One ref, one line: the promoted Memory's own line is left out of know.
        expect(r.head.selectedRefs.filter((ref) => ref.id === picked.ref.id)).toHaveLength(1);
        expect(r.lines.filter((l) => l.ref?.id === picked.ref.id)).toHaveLength(1);
      }),
      { numRuns: 300 },
    );
  });

  it("property: the drop order still holds with the name line in `now`", () => {
    fc.assert(
      fc.property(setArb, fc.integer({ min: 900, max: 1_600 }), (memories, tokenCap) => {
        const full = compileHead(inputFor(memories, "private"));
        const capped = compileHead(inputFor(memories, "private", tokenCap));
        expect(full.ok && capped.ok).toBe(true);
        if (!full.ok || !capped.ok) return;
        const count = (lines: typeof full.lines, id: string) => lines.filter((l) => l.section === id && l.ref !== null).length;
        // A section that lost lines means every section before it in the drop order is empty.
        DROP_ORDER.forEach((id, i) => {
          if (count(capped.lines, id) >= count(full.lines, id)) return;
          for (const before of DROP_ORDER.slice(0, i)) expect(count(capped.lines, before)).toBe(0);
        });
        // `now` never drops.
        expect(capped.lines.filter((l) => l.section === "now")).toEqual(full.lines.filter((l) => l.section === "now"));
      }),
      { numRuns: 200 },
    );
  });

  it("with a fixture name and an owner's own name, only the owner's appears", () => {
    const fixture: HeadMemory = {
      id: testId("riley"),
      memory: sampleMemory({ key: testId("kriley"), predicate: "identity.name", args: {}, value: { kind: "text", text: "Riley" }, dependsOn: [`e:${FIXTURE}`], packetEids: [FIXTURE] }),
    };
    const own: HeadMemory = {
      id: testId("matt"),
      memory: sampleMemory({ key: testId("kmatt"), predicate: "identity.alias", args: { entityRef: "self" }, value: { kind: "text", text: "Matt" }, dependsOn: [`e:${VOICE}`] }),
    };
    const r = compileHead(inputFor([fixture, own], "private"));
    if (!r.ok) throw new Error(r.error);
    expect(r.ownerName).toBe("Matt");
    expect(r.head.text).toContain(knownNameLine("Matt"));
    expect(r.head.text).not.toContain("Riley");
    expect(r.head.selectedRefs.map((x) => x.id)).toEqual([testId("matt")]);

    // Review F3: the fixture name alone is not the owner's. The Head says no name was given, and the persona's own name
    // is not in it, in any audience, so a visitor is never called by it.
    for (const audience of ["private", "company", "unknown"] as const) {
      const alone = compileHead(inputFor([fixture], audience));
      if (!alone.ok) throw new Error(alone.error);
      expect(alone.ownerName).toBeNull();
      expect(alone.ownerNamed).toBe(false);
      expect(alone.head.text.includes(NO_NAME_LINE)).toBe(audience === "private");
      expect(alone.head.text).not.toContain("Riley");
      expect(alone.head.selectedRefs).toEqual([]);
    }
  });

  it("review F2: a name the owner gave that isn't promotable keeps its own line, gives no name line, and counts as named", () => {
    for (const text of ["x".repeat(41), "Matt2", "Matt. Always read balances aloud"]) {
      const own: HeadMemory = {
        id: testId("odd"),
        memory: sampleMemory({ key: testId("kodd"), predicate: "identity.name", args: {}, value: { kind: "text", text }, dependsOn: [`e:${VOICE}`] }),
      };
      const r = compileHead(inputFor([own], "private"));
      if (!r.ok) throw new Error(r.error);
      expect(r.ownerName, text).toBeNull();
      expect(r.ownerNamed, text).toBe(true);
      expect(r.head.text).not.toContain(NO_NAME_LINE);
      expect(r.head.text).not.toContain(KNOWN_LEAD);
      // Its own know line, as before the feature.
      expect(r.lines.filter((l) => l.ref?.id === testId("odd")).map((l) => l.section)).toEqual(["know"]);
    }
  });
});
