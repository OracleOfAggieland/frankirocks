// Brief 035, new property 4: every hard rule in every Head, through properties 1 to 3. A rule stored before the
// narrowing (shellfish, the Owner's), and an allergy the Owner states in the swap window, are in the rules section
// of every Head issued afterwards: by the narrowing answer, by any probe of property 1, and by the open that
// takes the swap.
import { type CoreRules, allergenLabel, readRulesSection } from "@franki/core";
import { testId } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ok } from "../openai/fake";
import { paths } from "../store/paths";
import { type Answer, PROBE_KINDS, type ProbeRun, UID, doorArb, postTurn, probe, rulesOf, runDoor, stampAfter } from "../testing/audience-doors";
import { decisionAnswer } from "../testing/decisions";
import { RULE_ALLERGENS, template } from "../testing/arb-rule-turns";
import { patchRecord } from "../testing/fakes";
import { asrTurn, typedTurn } from "../testing/session-fixtures";

const SHELLFISH = { id: testId("rule-shellfish"), subjectId: "self", code: "shellfish", state: "active" as const, anonymous: false, proof: null, proofRev: null, rootKeys: [], dependsOn: [] };
const norm = (s: string) => s.normalize("NFKC").toLowerCase().trim();
const hasRule = (text: string, code: string) => readRulesSection(text).some((x) => x.state === "active" && norm(x.code) === norm(allergenLabel(code) ?? code) && norm(x.subject) === "you");
const heads = (a: Answer): string[] => [a.body?.deck?.head?.text, a.body?.result?.deck?.head?.text].filter((t): t is string => typeof t === "string");

describe("brief 035 property 4: every hard rule in every Head", () => {
  it("the stored rule and an allergy said in the swap window are in every later Head", { timeout: 600_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(doorArb, fc.option(fc.constantFrom(...RULE_ALLERGENS), { nil: null }), fc.array(fc.constantFrom(...PROBE_KINDS), { minLength: 1, maxLength: 4 }), async (door, said, probes) => {
        const n = await runDoor(door, (rig) => patchRecord<CoreRules>(rig.store, UID, paths.core(UID, "rules"), { allergies: [SHELLFISH] }));
        const what = `${JSON.stringify(door)} said ${said} ${JSON.stringify(probes)}`;
        const expected = ["shellfish"];
        // An allergy said on the narrowed Session; an answer of 200 means the route took it.
        if (said !== null) {
          const tpl = template("self", said, said);
          n.rig.openai.script("decisions.create", ok(decisionAnswer({ hardRule: 0.9 })));
          n.rig.fastSlots.script((input) => ({ kind: "valid", out: { items: tpl.items(input.turn.eid), need: "none" }, ms: 120 }));
          const body = n.typed ? typedTurn(n.stamp, n.seq, tpl.text, "said") : { ...asrTurn(n.stamp, n.seq, tpl.text, [{ itemId: "item_said", commitSeq: n.seq }], "final", "said"), judge: "H" };
          const res = await postTurn(n.rig, body);
          n.answers.push({ route: "turn", sessionId: n.id, status: res.status, body: res.body });
          if (res.status === 200) {
            n.seq++;
            n.stamp = stampAfter(n.stamp, res.body);
            // The route took it, so the rule is stored, under its gazetteer code ("peanut" for "peanuts").
            const rule = (await rulesOf(n.rig)).allergies.find((r) => r.subjectId === "self" && r.state === "active" && said.startsWith(r.code));
            expect(rule, `${what}: the stated allergy was not stored`).toBeDefined();
            expected.push(rule!.code);
          }
        }
        const run: ProbeRun = { n, opened: null };
        const mark = n.answers.length;
        for (const [i, k] of probes.entries()) await probe(run, k, i);
        for (const [i, a] of n.answers.entries()) {
          // The stated allergy is checked in the Heads issued after it was said.
          const want = i < mark && expected.length > 1 ? expected.slice(0, 1) : expected;
          for (const text of heads(a)) for (const code of want) expect(hasRule(text, code), `${what}: answer ${i} (${a.route}) lacks ${code}:\n${text}`).toBe(true);
        }
      }),
      { numRuns: 1_000 },
    );
  });
});
