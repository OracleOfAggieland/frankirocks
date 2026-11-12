// Brief 043, new property 3: an affirmed allergy is never denied away. For any asked pending rule and any answer that
// is not, as a whole, one of the closed denial forms, a `denied` item never removes the rule; and an answer holding an
// affirming cue never removes it, whatever its first word. Answers are built so that by construction they are not
// whole denials: a denial form with something more after it, or pieces that are no denial at all.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { CoreRules } from "../schema/records";
import { planHardRule } from "./hard-rule";
import { TURN_AT, TURN_EID, buildEvidence, emptyRules, hardRuleTurn, spanAt, validateContext } from "./testing/arb-writes";
import type { FastItem, FastSlotsOut, Subject } from "./types";
import { validateItems } from "./validate";

type Rule = CoreRules["allergies"][number];
const rule = (anonymous: boolean, code: string): Rule => ({ id: `p3${anonymous ? "a" : "s"}${code}`.padEnd(43, "x"), subjectId: anonymous ? null : "self", code, state: "pending", anonymous, proof: null, proofRev: null, rootKeys: [], dependsOn: [] });
const RULES = [rule(false, "peanut"), rule(true, "peanut"), rule(false, "shellfish")] as const;
const WORD: Record<string, string> = { peanut: "peanuts", shellfish: "shellfish" };

const LEADS = ["No", "Nope", "No joke", "No way", "Nah", "Not really", "Oh no", ""] as const;
/** Pieces that are no denial on their own; the first group holds an affirming cue. */
const CUES = ["I'm allergic to it", "I'm allergic to that", "I'm allergic to {X}", "I can't eat {X}", "I can't have it", "I'm really allergic", "it's an allergy", "I'm allergic to it, and to shrimp too"] as const;
const OTHER = ["I'd end up in the ER", "it's way worse than a dislike", "I swell up", "but my brother is", "and shrimp", "I think so", "my throat closes", "ask my doctor"] as const;
const WHOLE = ["No", "Nope", "No, I'm not", "No, I'm not allergic", "I'm not allergic to {X}"] as const;

type Answer = { pieces: string[]; cue: boolean };
const answerArb: fc.Arbitrary<Answer> = fc.oneof(
  // A whole denial with anything more after it.
  fc.record({ w: fc.constantFrom(...WHOLE), more: fc.constantFrom(...CUES, ...OTHER) }).map(({ w, more }) => ({ pieces: [w, more], cue: (CUES as readonly string[]).includes(more) })),
  // A lead, then one or two pieces.
  fc.record({ lead: fc.constantFrom(...LEADS), body: fc.array(fc.constantFrom(...CUES, ...OTHER), { minLength: 1, maxLength: 2 }) }).map(({ lead, body }) => ({
    pieces: lead === "" ? body : [lead, ...body],
    cue: body.some((b) => (CUES as readonly string[]).includes(b)),
  })),
);

const SELF: Subject = { entityId: null, mention: null, isSelf: true };
const NOBODY: Subject = { entityId: null, mention: null, isSelf: false };

describe("Property 3 (brief 043): an affirmed allergy is never denied away", () => {
  it("a denied item on an answer that is not a whole denial, or that holds a cue, keeps the asked rule", () => {
    fc.assert(
      fc.property(fc.constantFrom(...RULES), answerArb, fc.constantFrom(".", ". ", ", "), fc.nat(), fc.boolean(), fc.boolean(), (R, ans, joint, cut, named, self) => {
        const x = WORD[R.code]!;
        const parts = ans.pieces.map((p) => p.replace("{X}", x));
        const sep = joint.trim() === "," ? ", " : ". ";
        let text = "";
        const ends: number[] = [];
        parts.forEach((piece, i) => {
          text += (i === 0 ? piece.replace(/^./, (c) => c.toUpperCase()) : piece) + (i < parts.length - 1 ? sep : ".");
          ends.push(text.length - 1);
        });
        // The model's span: the whole answer or the start of it, as far as one of its pieces' ends.
        const end = cut % 2 === 0 ? text.length - 1 : ends[cut % ends.length]!;
        const item: FastItem = { kind: "allergy", subject: self ? SELF : NOBODY, item: named && text.includes(x) ? x : "", severity: "allergy", polarity: "denied", act: "direct", span: spanAt(TURN_EID, text, 0, end) };
        const e = buildEvidence(TURN_EID, text, [], ["U"], TURN_AT);
        const out: FastSlotsOut = { items: [item], need: "none" };
        const answering = { rule: R };
        const verdicts = validateItems(out, validateContext(e, { routes: new Set(["hardRule"]), speakerCertain: true, answering }));
        const p = planHardRule({ ...emptyRules(), allergies: [R] }, verdicts, hardRuleTurn(e, out, { speakerCertain: true, answering, trigger: { regex: true, candidate: false, asked: true } }));
        const gone = !p.rules.allergies.some((r) => r.id === R.id) && !p.rules.allergies.some((r) => r.code === R.code && r.state === "active");
        expect(gone, `"${text}" (span "${item.span.quote}", cue ${ans.cue}) removed ${R.subjectId ?? "anyone"}:${R.code}`).toBe(false);
      }),
      { numRuns: 1000 },
    );
  });
});
