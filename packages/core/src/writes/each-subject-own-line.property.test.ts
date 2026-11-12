// Brief 032, property "Each subject is its own line" (finding M2). For any rules (the owner's, named subjects with
// or without a stored label, two subjects sharing a label, and anonymous rules, active or pending) and every
// audience, no line of the rules section holds the rules of two subjects. Each anonymous rule counts as a subject of
// its own, since nobody knows whose it is. Each rule's allergen is unique here, so a line's labels name its rules.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Au } from "../schema/primitives";
import type { CoreRules } from "../schema/records";
import { GAZETTEER, allergenLabel } from "./gazetteer";
import { PENDING_PREFIX, RULES_TAIL_PREFIX, renderRulesSection } from "./rules-section";
import { emptyRules } from "./testing/arb-writes";

type Rule = CoreRules["allergies"][number];

const CODES = GAZETTEER.filter((e) => e.domain !== "pseudo").map((e) => e.id);
const SUBJECTS = ["self", null, ...Array.from({ length: 6 }, (_, i) => `subject${i}`.padEnd(43, "x"))] as const;
const LABELS = ["Sam", "Maya", "your brother", "Sam"] as const;

const caseArb = fc.record({
  picks: fc.uniqueArray(fc.tuple(fc.nat(SUBJECTS.length - 1), fc.nat(CODES.length - 1), fc.boolean()), { minLength: 1, maxLength: 24, selector: ([, c]) => c }),
  labels: fc.array(fc.option(fc.nat(LABELS.length - 1), { freq: 2 }), { minLength: SUBJECTS.length, maxLength: SUBJECTS.length }),
  audience: fc.constantFrom<Au>("private", "company", "unknown"),
});

describe("Each subject is its own line (brief 032)", () => {
  it("no line of the rules section holds two subjects' rules, for every audience", () => {
    fc.assert(
      fc.property(caseArb, ({ picks, labels, audience }) => {
        const allergies: Rule[] = picks.map(([s, c, active], n) => {
          const subjectId = SUBJECTS[s]!;
          return { id: `rule${n}`.padEnd(43, "x"), subjectId, code: CODES[c]!, state: active && subjectId !== null ? "active" : "pending", anonymous: subjectId === null, proof: null, proofRev: null, rootKeys: [], dependsOn: [] };
        });
        const subjectLabels = SUBJECTS.flatMap((s, i) => (s === null || s === "self" || labels[i] === null ? [] : [{ subjectId: s, label: LABELS[labels[i]!]! }]));
        const rules: CoreRules = { ...emptyRules(), allergies, subjectLabels };
        const byLabel = new Map(allergies.map((r) => [allergenLabel(r.code)!, r]));
        for (const line of renderRulesSection(rules, audience)) {
          if (!line.startsWith("- ") || line.startsWith(RULES_TAIL_PREFIX)) continue;
          const body = (line.startsWith(PENDING_PREFIX) ? line.slice(PENDING_PREFIX.length) : line.slice(2)).replace(/\.$/, "");
          const labelsOnLine = body.slice(body.indexOf(": ") + 2).split(", ");
          const subjects = new Set(labelsOnLine.map((l) => byLabel.get(l)).map((r) => (r === undefined ? "?" : r.anonymous ? `anon:${r.id}` : r.subjectId)));
          expect(subjects.size, `${audience}: "${line}"`).toBe(1);
        }
      }),
      { numRuns: 1000 },
    );
  });
});
