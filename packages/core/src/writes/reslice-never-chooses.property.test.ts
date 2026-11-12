// Brief 043, coordinator item 1 (W-230): the model's span boundaries never choose whose allergy it is. For any stored
// rules (the owner's, the brother's, the sister's and anonymous ones, active or pending), any asked rule or none, any
// owner sentence holding a first person, any subject the item gives, and any reslice of the item's span inside that
// sentence that keeps the words "allergic to <allergen>" whole (a cut inside the cue word changes how sure the line
// is, not whose it is), the rules after the turn are the ones the full-sentence span gives
// (each rule's proof aside, which is its own span).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { CoreRules } from "../schema/records";
import { BROTHER_EID, SELF, emptyRules, planTurn } from "./testing/arb-review";
import { SISTER, TURN_EID, spanAt } from "./testing/arb-writes";
import type { FastItem, Subject } from "./types";

type Rule = CoreRules["allergies"][number];

const CODES = ["peanut", "shellfish", "sesame", "unresolved"] as const;
const OWNERS = ["self", BROTHER_EID, SISTER, null] as const;
const SENTENCES = ["I'm allergic to {w}.", "Yes, I'm allergic to {w}.", "I am allergic to {w} too.", "Me too, I'm allergic to {w}.", "I'm allergic to {w}, it's bad.", "Yes. I'm allergic to {w}."] as const;
const SUBJECTS: readonly Subject[] = [SELF, { entityId: null, mention: null, isSelf: false }, { entityId: BROTHER_EID, mention: null, isSelf: false }, { entityId: SISTER, mention: null, isSelf: false }];

const ruleArb: fc.Arbitrary<Rule> = fc
  .record({ s: fc.constantFrom(...OWNERS), code: fc.constantFrom(...CODES), active: fc.boolean(), n: fc.nat(99) })
  .map(({ s, code, active, n }) => ({
    id: `r${n}${String(s).slice(0, 4)}${code}`.padEnd(43, "x").slice(0, 43),
    subjectId: s,
    code,
    state: active && s !== null && code !== "unresolved" ? "active" : "pending",
    anonymous: s === null,
    proof: null,
    proofRev: null,
    rootKeys: [],
    dependsOn: [],
  }));
const rulesArb = fc.uniqueArray(ruleArb, { maxLength: 6, selector: (r) => `${r.subjectId ?? ""}|${r.code}` });

describe("Property (W-230): a reslice of the span never chooses whose allergy it is", () => {
  it("the rules after the turn are the full-sentence span's", () => {
    fc.assert(
      fc.property(
        rulesArb,
        fc.option(fc.nat(5), { freq: 2 }),
        fc.constantFrom(...SENTENCES),
        fc.constantFrom("peanuts", "shellfish", "sesame"),
        fc.constantFrom(...SUBJECTS),
        fc.boolean(),
        fc.nat(),
        fc.nat(),
        (priors, askedAt, sentence, w, subject, speakerCertain, a, b) => {
          const text = sentence.replace("{w}", w);
          const cue = `allergic to ${w}`;
          const at = text.indexOf(cue);
          const last = text.length - 1; // the full span leaves the closing stop out, as the careful items do
          const start = a % (at + 1);
          const end = at + cue.length + (b % (last - at - cue.length + 1));
          const pendings = priors.filter((r) => r.state === "pending");
          const run = (s: number, e: number) => {
            const rules = { ...emptyRules(), allergies: priors.map((r) => ({ ...r })) };
            const R = askedAt === null || pendings.length === 0 ? null : rules.allergies.find((r) => r.id === pendings[askedAt % pendings.length]!.id)!;
            const item: FastItem = { kind: "allergy", subject, item: w, severity: "allergy", polarity: "affirmed", act: "direct", span: spanAt(TURN_EID, text, s, e) };
            return planTurn(text, { items: [item], need: "none" }, rules, speakerCertain, R === null ? null : { rule: R }).rules.allergies.map(({ proof: _p, ...r }) => r);
          };
          expect(run(start, end), `"${text.slice(start, end)}" in "${text}", subject ${JSON.stringify(subject)}`).toEqual(run(0, last));
        },
      ),
      { numRuns: 1000 },
    );
  });
});
