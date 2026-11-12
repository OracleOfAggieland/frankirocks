// Brief 043, coordinator follow-up to item 1 (W-231): a model's entityId or mention never chooses a person the
// owner's sentence doesn't name. For any stored rules (the owner's, the brother's, the sister's, the dad's and
// anonymous ones), any owner sentence, an optional earlier sentence that may name someone, an asked rule or none, and
// an item whose subject is the entityId of a stored person the allergy sentence doesn't name, or a mention over that
// person's name in the earlier sentence, no rule of that person is written, changed or removed. Left out: an
// answering turn whose asked rule is that person's (the existing lend rule may give the answer to the asked rule's
// subject).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { CoreRules } from "../schema/records";
import { planHardRule } from "./hard-rule";
import { BROTHER_EID } from "./testing/arb-review";
import { DAD, ENTITIES, KNOWN, SISTER, TURN_AT, TURN_EID, buildEvidence, emptyRules, hardRuleTurn, spanAt, validateContext } from "./testing/arb-writes";
import type { FastItem, Subject } from "./types";
import { validateItems } from "./validate";

type Rule = CoreRules["allergies"][number];
const known = { entries: [...KNOWN.entries, { id: BROTHER_EID, kind: "person" as const, label: "Sam", aliases: ["brother"], relation: "brother" }] };
const entities = [...ENTITIES, { id: BROTHER_EID, label: "Sam", aliases: ["brother"] }];

const PEOPLE = [
  { id: BROTHER_EID, name: "Sam" },
  { id: SISTER, name: "Maya" },
  { id: DAD, name: "Dad" },
] as const;
/** Allergy sentences, with the people each names. */
const SENTENCES: readonly { s: string; names: readonly string[] }[] = [
  { s: "I'm allergic to {w}.", names: [] },
  { s: "Yes, I'm allergic to {w}.", names: [] },
  { s: "Allergic to {w}.", names: [] },
  { s: "I am allergic to {w} too.", names: [] },
  { s: "My brother is allergic to {w}.", names: [BROTHER_EID] },
  { s: "Maya is allergic to {w}.", names: [SISTER] },
  { s: "My dad and I are allergic to {w}.", names: [DAD] },
  { s: "My friend's brother is allergic to {w}.", names: [] },
];
const PREFIXES = ["", "Sam called. ", "Maya is fine. ", "Dad is here. "] as const;
const OWNERS = ["self", BROTHER_EID, SISTER, DAD, null] as const;
const CODES = ["peanut", "shellfish", "sesame", "unresolved"] as const;

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

describe("Property (W-231): an entityId or mention the owner's sentence doesn't name chooses no one", () => {
  it("no rule of that person is written, changed or removed", () => {
    fc.assert(
      fc.property(
        rulesArb,
        fc.option(fc.nat(5), { freq: 2 }),
        fc.constantFrom(...SENTENCES),
        fc.constantFrom(...PREFIXES),
        fc.constantFrom("peanuts", "shellfish", "sesame"),
        fc.nat(2),
        fc.boolean(),
        fc.boolean(),
        fc.constantFrom<"affirmed" | "uncertain">("affirmed", "uncertain"),
        (priors, askedAt, sentence, prefix, w, who, byMention, speakerCertain, polarity) => {
          const target = PEOPLE[who]!;
          if (sentence.names.includes(target.id)) return;
          const text = prefix + sentence.s.replace("{w}", w);
          const named = prefix.includes(target.name);
          const subject: Subject = byMention && named ? { entityId: null, mention: spanAt(TURN_EID, text, text.indexOf(target.name), text.indexOf(target.name) + target.name.length), isSelf: false } : { entityId: target.id, mention: null, isSelf: false };
          const rules = { ...emptyRules(), allergies: priors.map((r) => ({ ...r })) };
          const pendings = rules.allergies.filter((r) => r.state === "pending");
          const R = askedAt === null || pendings.length === 0 ? null : pendings[askedAt % pendings.length]!;
          if (R !== null && R.subjectId === target.id) return;
          const e = buildEvidence(TURN_EID, text, [], ["U"], TURN_AT);
          const start = prefix.length;
          const end = text.indexOf(w) + w.length;
          const item: FastItem = { kind: "allergy", subject, item: w, severity: "allergy", polarity, act: "direct", span: spanAt(TURN_EID, text, start, end) };
          const out = { items: [item], need: "none" as const };
          const answering = R === null ? null : { rule: R };
          const verdicts = validateItems(out, validateContext(e, { routes: new Set(["hardRule"]), known, entities, speakerCertain, answering }));
          const after = planHardRule(rules, verdicts, hardRuleTurn(e, out, { speakerCertain, answering, trigger: { regex: true, candidate: false, asked: answering !== null } })).rules;
          const of = (rs: readonly Rule[]) => rs.filter((r) => r.subjectId === target.id);
          expect(of(after.allergies), `"${text}" (span "${text.slice(start, end)}"), subject ${byMention && named ? "mention" : "entityId"} ${target.name}, asked ${R?.id ?? "nothing"}`).toEqual(of(priors));
        },
      ),
      { numRuns: 1000 },
    );
  });
});
