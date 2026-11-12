// Brief 043, new property 4: a rename goes the way the owner said. For any correction whose span asserts "X is the
// name" or says "not Y", validation never renames the sister to Y, whatever replacement the model gives. The sister's
// stored name is one of X and Y, or neither.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Memory } from "../schema/records";
import { mentionName } from "./subject";
import { PRIOR, PRIOR_EID, SISTER, SISTER_REL, TURN_AT, TURN_EID, buildEvidence, row, spanAt, targetsMap, validateContext } from "./testing/arb-writes";
import { testId } from "../testing/samples";
import type { FastItem } from "./types";
import { validateItems } from "./validate";

const NAMES = ["Maya", "Mara", "May", "Mira"] as const;
const SHAPES = [
  "No, her name is {X}, not {Y}.",
  "No, that's wrong, her name is {X}, not {Y}.",
  "Her name's {X}, not {Y}.",
  "It's {X}, not {Y}.",
  "Not {Y}, her name is {X}.",
  "She's called {X}, not {Y}.",
  "No, she isn't {Y}, she's {X}.",
  "Her name is {X} rather than {Y}.",
] as const;

describe("Property 4 (brief 043): a rename goes the way the owner said", () => {
  it("never renames to the name the owner negated", () => {
    fc.assert(
      fc.property(fc.constantFrom(...SHAPES), fc.constantFrom(...NAMES), fc.constantFrom(...NAMES), fc.constantFrom(...NAMES), fc.constantFrom("X", "Y", "stored", "other"), (shape, X, Y, stored, said) => {
        fc.pre(X !== Y);
        const text = shape.replace("{X}", X).replace("{Y}", Y);
        // The sister's relation row, with her current name in its line.
        const rel: Memory = row(testId("p4rel"), { ...SISTER_REL, sayAs: { text: `${stored} is the owner's sister.`, entityRefs: [], timeFields: [] } }, PRIOR, PRIOR_EID, "My sister Maya is coming Friday");
        const known = { entries: [{ id: SISTER, kind: "person" as const, label: stored, aliases: [stored, "sister"], relation: "sister" }] };
        const replacement = said === "X" ? X : said === "Y" ? Y : said === "stored" ? stored : NAMES.find((n) => n !== X && n !== Y)!;
        const item: FastItem = { kind: "correction", targetIds: [rel.logicalId], predicate: "identity.name", replacementValue: { kind: "text", text: replacement }, args: null, act: "direct", span: spanAt(TURN_EID, text, 0, text.length - 1) };
        const e = buildEvidence(TURN_EID, text, [], ["U"], TURN_AT);
        const [v] = validateItems({ items: [item], need: "none" }, validateContext(e, { targets: targetsMap([rel]), known, entities: [{ id: SISTER, label: stored, aliases: ["sister"] }] }));
        if (v?.kind !== "correction" || v.v.kind !== "rename") return;
        expect(mentionName(v.v.to), `"${text}" (stored ${stored}, model said ${replacement}) renamed to ${v.v.to}`).not.toBe(mentionName(Y));
      }),
      { numRuns: 1000 },
    );
  });
});
