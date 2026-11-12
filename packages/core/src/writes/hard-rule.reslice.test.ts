// Brief 043, coordinator item 1 (W-230): the model's span boundaries never choose whose allergy it is. Found by
// others-words-never-clear (brief 032) with { seed: 190244370, path: "658:3:5:5:8:7:7:7:9" }: the asked rule is
// another person's pending peanut rule, the owner says "I'm allergic to peanuts.", and the item's span is resliced one
// character in ("'m allergic to peanuts."), so it lost its "I".
import { describe, expect, it } from "vitest";
import type { CoreRules } from "../schema/records";
import { SELF, emptyRules, planTurn } from "./testing/arb-review";
import { TURN_EID, spanAt } from "./testing/arb-writes";
import type { FastItem } from "./types";

type Rule = CoreRules["allergies"][number];
const OTHER = "Dleg8daxAbXTUE7JarG6kYzfahww4sVjnPCRD4_j0z8";
const rule = (id: string, code: string): Rule => ({ id, subjectId: OTHER, code, state: "pending", anonymous: false, proof: null, proofRev: null, rootKeys: [], dependsOn: [] });

describe("a resliced span never lends the asked rule's subject (W-230)", () => {
  const text = "I'm allergic to peanuts.";
  const priors = [rule("r0Dlegpeanutxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", "peanut"), rule("r0Dlegunresolvedxxxxxxxxxxxxxxxxxxxxxxxxxxx", "unresolved")];
  const run = (start: number) => {
    const rules = { ...emptyRules(), allergies: priors.map((r) => ({ ...r })) };
    const item: FastItem = { kind: "allergy", subject: SELF, item: "peanuts", severity: "allergy", polarity: "affirmed", act: "direct", span: spanAt(TURN_EID, text, start, text.length - 1) };
    return planTurn(text, { items: [item], need: "none" }, rules, true, { rule: rules.allergies[0]! });
  };

  it("\"'m allergic to peanuts.\": the other person's two rules stay as they were, and the owner has a peanut rule", () => {
    const plan = run(1);
    for (const r of priors) expect(plan.rules.allergies.find((x) => x.id === r.id), r.code).toEqual(r);
    expect(plan.rules.allergies.some((x) => x.subjectId === "self" && x.code === "peanut" && (x.state === "active" || x.state === "pending"))).toBe(true);
  });

  it("the full span gives the same rules (each rule's proof is its own span)", () => {
    const shape = (start: number) => run(start).rules.allergies.map(({ proof: _p, ...r }) => r);
    expect(shape(1)).toEqual(shape(0));
  });
});
