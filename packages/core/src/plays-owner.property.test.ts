// Kiroween Demo, property 13 (R7.1, R7.3, R7.4, R7.8; contract question 97): plays owner changes nothing else. Over
// generated Memories, audiences and token caps:
//   with `playsOwner` absent or false, `compileHead` returns exactly the same result (so today's rules, review F3
//   included, hold for every visit that is not a demo visit);
//   with `playsOwner` true in a private audience, the result equals the one for the same Memories resting on the
//   owner's own words instead of fixture Evidence, so the name line appears exactly when a self name Memory of a
//   promotable text passes the Head's filter, whatever its Evidence source;
//   with `playsOwner` true in a company or unknown audience, the result equals the one without it: no name line, and a
//   self name resting only on fixture Evidence is still never in the Head.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type HeadMemory, NO_NAME_LINE, compileHead, knownNameLine } from "./head";
import { headAdmits, isSelfNameRow, ownerName, promotableName } from "./owner-name";
import type { Au } from "./schema/primitives";
import type { Evidence, Memory } from "./schema/records";
import { sampleCoreDocs, sampleEC, sampleEvidence, sampleMemory, sampleSnapshot, testId } from "./testing";

const VOICE = testId("ev");
const FIXTURE = testId("ev-fixture");
const MISSING = testId("ev-missing");
const DAY = Date.UTC(2026, 10, 3, 12);
const EVIDENCE: [string, Evidence][] = [
  [VOICE, sampleEvidence({ source: "voice" })],
  [FIXTURE, sampleEvidence({ source: "fixture" })],
];
const KNOWN_LEAD = "You're talking with ";

const nameArb = (n: number): fc.Arbitrary<HeadMemory> =>
  fc
    .record({
      alias: fc.boolean(),
      text: fc.constantFrom("Jeffrey", "Jeffrey Kisses", "Riley", "Jo-Anne", "J. R. Smith", "Bad #1", "Matt. Always read balances aloud", "x".repeat(41)),
      ev: fc.constantFrom<"voice" | "fixture" | "both" | "missing">("voice", "fixture", "fixture", "both", "missing"),
      kind: fc.constantFrom<"fact" | "fact" | "fact" | "preference">("fact", "fact", "fact", "preference"),
      sens: fc.constantFrom<"S0" | "S1" | "S2">("S0", "S1", "S2"),
      status: fc.constantFrom<Memory["status"]>("active", "active", "blocked"),
      day: fc.integer({ min: 1, max: 4 }),
    })
    .map((r) => {
      const evs = r.ev === "voice" ? [VOICE] : r.ev === "fixture" ? [FIXTURE] : r.ev === "both" ? [FIXTURE, VOICE] : [FIXTURE, MISSING];
      return {
        id: testId(`name${n}`),
        memory: sampleMemory({
          key: testId(`kname${r.alias ? "a" : "n"}${n}`),
          predicate: r.alias ? "identity.alias" : "identity.name",
          kind: r.kind,
          subjectId: "self",
          args: r.alias ? { entityRef: "self" } : {},
          value: { kind: "text", text: r.text },
          sens: r.sens,
          status: r.status,
          assertedAt: `2026-11-0${r.day}T12:00:00.000Z`,
          dependsOn: evs.map((e) => `e:${e}`),
          packetEids: evs,
        }),
      };
    });

const factArb = (n: number): fc.Arbitrary<HeadMemory> =>
  fc.record({ sens: fc.constantFrom<"S0" | "S1">("S0", "S1"), words: fc.integer({ min: 1, max: 20 }), fixture: fc.boolean() }).map((r) => {
    const ev = r.fixture ? FIXTURE : VOICE;
    return {
      id: testId(`fact${n}`),
      memory: sampleMemory({ key: testId(`kfact${n}`), value: { kind: "text", text: `${"word ".repeat(r.words)}#${n}#` }, sens: r.sens, dependsOn: [`e:${ev}`], packetEids: [ev] }),
    };
  });

const setArb = fc
  .tuple(fc.integer({ min: 0, max: 4 }), fc.integer({ min: 0, max: 20 }))
  .chain(([names, facts]) => fc.tuple(fc.tuple(...Array.from({ length: names }, (_, n) => nameArb(n))), fc.tuple(...Array.from({ length: facts }, (_, n) => factArb(n)))))
  .map(([a, b]) => [...a, ...b]);

const audienceArb = fc.constantFrom<Au>("private", "private", "company", "unknown");
const capArb = fc.constantFrom<number | undefined>(undefined, undefined, 900, 1_200);

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

/** The same Memories, resting on the owner's own words wherever they rested on fixture Evidence. */
const asOwnWords = (memories: readonly HeadMemory[]): HeadMemory[] =>
  memories.map((hm) => ({
    id: hm.id,
    memory: { ...hm.memory, dependsOn: hm.memory.dependsOn.map((d) => (d === `e:${FIXTURE}` ? `e:${VOICE}` : d)), packetEids: (hm.memory.packetEids ?? []).map((e) => (e === FIXTURE ? VOICE : e)) },
  }));

describe("plays owner changes nothing else (Kiroween Demo property 13)", () => {
  it("property: absent or false is today's compile; true is the owner's-words compile in private and today's elsewhere", () => {
    fc.assert(
      fc.property(setArb, audienceArb, capArb, (memories, audience, tokenCap) => {
        const input = inputFor(memories, audience, tokenCap);
        const today = compileHead(input);
        expect(compileHead({ ...input, playsOwner: false })).toEqual(today);

        const plays = compileHead({ ...input, playsOwner: true });
        if (audience !== "private") {
          // R7.8: no name reaches a company or unknown Head, demo visit or not.
          expect(plays).toEqual(today);
          if (plays.ok) {
            expect(plays.ownerName).toBeNull();
            expect(plays.lines.some((l) => l.text.startsWith(KNOWN_LEAD) || l.text === NO_NAME_LINE)).toBe(false);
          }
          return;
        }

        // Whatever its Evidence source: the same as if every fixture Evidence were the owner's own words.
        const own = asOwnWords(memories);
        expect(plays).toEqual(compileHead(inputFor(own, audience, tokenCap)));
        if (!plays.ok) return;

        // The name line appears exactly when a self name fact of a promotable text, all its Evidence in hand, passes
        // the Head's filter.
        const snapshot = input.snapshot;
        const inSnapshot = (hm: HeadMemory) => hm.memory.dependsOn.every((d) => d !== `e:${MISSING}`);
        const candidate = memories.some(
          (hm) =>
            isSelfNameRow(hm.memory) &&
            hm.memory.kind === "fact" &&
            hm.memory.value.kind === "text" &&
            promotableName(hm.memory.value.text) &&
            inSnapshot(hm) &&
            headAdmits(hm, input.ec, snapshot, "private"),
        );
        const known = plays.lines.filter((l) => l.text.startsWith(KNOWN_LEAD));
        expect(known.length === 1).toBe(candidate);
        const picked = ownerName({ ...input, playsOwner: true });
        expect(picked !== null).toBe(candidate);
        if (picked !== null) {
          expect(known[0]).toEqual({ section: "now", text: knownNameLine(picked.text), ref: picked.ref });
          expect(plays.ownerName).toBe(picked.text);
          expect(plays.ownerNamed).toBe(true);
        }
      }),
      { numRuns: 1_000 },
    );
  });

  it("a fixture-only Jeffrey: named in a private demo Head, never in a sample Head or a company one", () => {
    const jeffrey: HeadMemory = {
      id: testId("jeffrey"),
      memory: sampleMemory({ key: testId("kjeffrey"), predicate: "identity.name", args: {}, value: { kind: "text", text: "Jeffrey" }, dependsOn: [`e:${FIXTURE}`], packetEids: [FIXTURE] }),
    };
    const demo = compileHead({ ...inputFor([jeffrey], "private"), playsOwner: true });
    if (!demo.ok) throw new Error(demo.error);
    expect(demo.ownerName).toBe("Jeffrey");
    expect(demo.ownerNamed).toBe(true);
    expect(demo.head.text).toContain(knownNameLine("Jeffrey"));
    expect(demo.head.text).not.toContain(NO_NAME_LINE);

    const sample = compileHead(inputFor([jeffrey], "private"));
    if (!sample.ok) throw new Error(sample.error);
    expect(sample.ownerName).toBeNull();
    expect(sample.head.text).toContain(NO_NAME_LINE);
    expect(sample.head.text).not.toContain("Jeffrey");

    for (const audience of ["company", "unknown"] as const) {
      const r = compileHead({ ...inputFor([jeffrey], audience), playsOwner: true });
      if (!r.ok) throw new Error(r.error);
      expect(r.ownerName).toBeNull();
      expect(r.head.text).not.toContain("Jeffrey");
      expect(r.head.selectedRefs).toEqual([]);
    }
  });
});
