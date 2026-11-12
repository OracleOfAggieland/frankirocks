// Feature: voice-writes (brief 012 wave B, task B1), Property 3, pure half: a rule, once in `core/rules`, is in every
// Head compiled from it, for every audience (design 2.8, G25, CQ 116). For rules documents of 1 to 256 active and
// pending rules over many subjects (long labels included), every audience and token caps down to the fixed minimum:
// `compileHead` is ok; `readRulesSection(head.text)` gives back the (subject, allergen, state) triples of the rules
// document, all of them while the section is within its bounds, and otherwise a subset of them with the fail-closed
// tail line present. Pending rules outside a private audience render with no subject ("someone"). An unlabelled
// subject other than the owner renders as "someone else".
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { compileHead } from "./head";
import type { Au } from "./schema/primitives";
import type { CoreRules } from "./schema/records";

type AllergyRule = CoreRules["allergies"][number];
import { sampleCoreDocs, sampleEC, sampleSnapshot, testId } from "./testing";
import { GAZETTEER, allergenLabel } from "./writes/gazetteer";
import { RULES_TAIL_PREFIX, readRulesSection } from "./writes/rules-section";

const DAY = Date.UTC(2026, 10, 3, 12);
const CODES = [...GAZETTEER.filter((e) => e.domain !== "pseudo").map((e) => e.id), "unresolved"];
const SUBJECTS = ["self", null, ...Array.from({ length: 12 }, (_, i) => testId(`subject${i}`))] as const;
const LABEL_WORDS = ["your", "brother", "sister", "best", "friend", "from", "college", "Maya", "Sam", "neighbour's", "little", "boy"];

const rulesArb = fc
  .record({
    picks: fc.uniqueArray(fc.tuple(fc.nat(SUBJECTS.length - 1), fc.nat(CODES.length - 1)), { minLength: 1, maxLength: 256, selector: ([s, c]) => `${s}:${c}` }),
    states: fc.array(fc.boolean(), { minLength: 256, maxLength: 256 }),
    labels: fc.array(fc.option(fc.array(fc.constantFrom(...LABEL_WORDS), { minLength: 1, maxLength: 14 }).map((w) => w.join(" ").slice(0, 80))), { minLength: SUBJECTS.length, maxLength: SUBJECTS.length }),
  })
  .map(({ picks, states, labels }) => {
    const allergies: AllergyRule[] = picks.map(([s, c], n) => {
      const subjectId = SUBJECTS[s]!;
      return { id: testId(`rule${n}`), subjectId, code: CODES[c]!, state: states[n] ? "active" : "pending", anonymous: subjectId === null, proof: null, proofRev: null, rootKeys: [], dependsOn: [] };
    });
    const subjectLabels = SUBJECTS.flatMap((s, i) => (s === null || s === "self" || labels[i] === null ? [] : [{ subjectId: s, label: labels[i]! }]));
    return { ...sampleCoreDocs().rules, allergies, subjectLabels } as unknown as CoreRules;
  });

const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

/** The oracle: what each rule should read back as. */
function expected(rules: CoreRules, audience: Au): string[] {
  const labels = new Map(((rules as unknown as { subjectLabels: { subjectId: string; label: string }[] }).subjectLabels ?? []).map((l) => [l.subjectId, l.label]));
  return rules.allergies.map((r) => {
    const subject = r.subjectId === null || (r.state === "pending" && audience !== "private") ? "someone" : r.subjectId === "self" ? "you" : (labels.get(r.subjectId) ?? "someone else");
    const code = r.code === "unresolved" ? "any food" : allergenLabel(r.code)!;
    return `${norm(subject)}|${norm(code)}|${r.state}`;
  });
}

describe("Property 3 (pure): a rule is in every Head", () => {
  it("reads back from every compiled Head, for every audience and cap", () => {
    fc.assert(
      fc.property(rulesArb, fc.constantFrom<Au>("private", "company", "unknown"), fc.integer({ min: 1_200, max: 3_500 }), (rules, audience, tokenCap) => {
        const input = { memories: [], ec: sampleEC(), snapshot: sampleSnapshot({}), rules, audience, clock: { worldClock: { now: DAY, zone: "America/Chicago" }, opsClock: { now: DAY } }, tokenCap };
        const r = compileHead(input);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const want = expected(rules, audience);
        const got = readRulesSection(r.head.text).map((t) => `${norm(t.subject)}|${norm(t.code)}|${t.state}`);
        const multiset = (xs: string[]) => [...xs].sort();
        const truncated = r.head.text.includes(RULES_TAIL_PREFIX);
        if (!truncated) expect(multiset(got)).toEqual(multiset(want));
        else {
          const left = [...want];
          for (const g of got) {
            const at = left.indexOf(g);
            expect(at, `read back ${g}, which the rules document doesn't hold`).toBeGreaterThanOrEqual(0);
            left.splice(at, 1);
          }
          expect(got.length).toBeLessThan(want.length);
        }
      }),
      { numRuns: 300 },
    );
  });
});
