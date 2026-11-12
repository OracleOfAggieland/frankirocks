import { describe, expect, it } from "vitest";
import { rootKey } from "../ids";
import { buildSlice } from "../slices";
import { testId } from "../testing/samples";
import { reanchorRule } from "./reanchor";
import { sanitizeText } from "./sanitize";
import { BROTHER, ROSTER, evidenceOf, forgetHasher as hasher } from "./testing/arb-forget";

const OLD = testId("old");
const NEW = testId("new");

function setup(text: string, proof: string, removed: string, subjectId: string | null, code: string) {
  const ps = text.indexOf(proof);
  const rs = text.indexOf(removed);
  const out = sanitizeText(text, [{ start: rs, end: rs + removed.length }], [{ start: ps, end: ps + proof.length }]);
  const map = out.pieces.map((p) => ({ oldField: "text" as const, oldStart: p.oldStart, oldEnd: p.oldEnd, newField: "text" as const, newStart: p.newStart, newEnd: p.newEnd }));
  const slice = buildSlice({ eid: OLD, fieldPath: "text", fieldText: text, start: ps, end: ps + proof.length, class: "U", sens: "S0" }, hasher);
  const rule = {
    id: testId("rule"),
    subjectId,
    code,
    state: "active" as const,
    anonymous: subjectId === null,
    proof: { eid: OLD, fieldPath: "text" as const, start: ps, end: ps + proof.length, quote: proof },
    proofRev: 1,
    rootKeys: [rootKey(slice, hasher)],
    dependsOn: [`e:${OLD}`],
  };
  return { rule, map, survivor: { eid: NEW, evidence: evidenceOf(NEW, out.text, hasher) } };
}

describe("reanchorRule (contracts §7; spec §8 'What survives')", () => {
  it("re-anchors the shellfish rule onto the sanitized text and swaps its roots", () => {
    const { rule, map, survivor } = setup("I'm allergic to shellfish. Danny relapsed.", "I'm allergic to shellfish.", "Danny relapsed", "self", "shellfish");
    const r = reanchorRule(rule, map, survivor, ROSTER, hasher);
    expect(r.kind).toBe("reanchored");
    expect(r.rule.state).toBe("active");
    expect(r.rule.proof).toEqual({ eid: NEW, fieldPath: "text", start: 0, end: 26, quote: "I'm allergic to shellfish." });
    expect(r.rule.dependsOn).toEqual([`e:${NEW}`]);
    expect(r.rule.rootKeys).not.toEqual(rule.rootKeys);
  });

  it("goes pending when the span overlapped the removed range", () => {
    const { rule, map, survivor } = setup("I'm allergic to shellfish, like Danny.", "I'm allergic to shellfish", "shellfish, like Danny", "self", "shellfish");
    const r = reanchorRule(rule, map, survivor, ROSTER, hasher);
    expect(r).toMatchObject({ kind: "pending", why: "noDisjointSpan" });
    expect(r.rule).toMatchObject({ state: "pending", anonymous: true, subjectId: null, proof: null, rootKeys: [], dependsOn: [] });
  });

  it("goes pending when the subject is not literal in the span", () => {
    const { rule, map, survivor } = setup("She is allergic to soy. Danny relapsed.", "She is allergic to soy.", "Danny", BROTHER, "soy");
    expect(reanchorRule(rule, map, survivor, ROSTER, hasher)).toMatchObject({ kind: "pending", why: "subject" });
  });

  it("keeps a roster subject named in the span", () => {
    const { rule, map, survivor } = setup("My brother is allergic to eggs. Danny relapsed.", "My brother is allergic to eggs.", "Danny", BROTHER, "egg");
    expect(reanchorRule(rule, map, survivor, ROSTER, hasher).kind).toBe("reanchored");
  });

  it("goes pending on a gazetteer miss, with no survivor, or with no proof", () => {
    const { rule, map, survivor } = setup("I'm allergic to shellfish. Danny relapsed.", "I'm allergic to shellfish.", "Danny", "self", "peanut");
    expect(reanchorRule(rule, map, survivor, ROSTER, hasher)).toMatchObject({ kind: "pending", why: "gazetteer" });
    expect(reanchorRule({ ...rule, code: "shellfish" }, map, null, ROSTER, hasher)).toMatchObject({ kind: "pending", why: "noSurvivor" });
    expect(reanchorRule({ ...rule, proof: null }, map, survivor, ROSTER, hasher)).toMatchObject({ kind: "pending", why: "noProof" });
  });
});
