// Brief 035, new property 3: nothing said in the swap window is lost. For any turn posted on a narrowed Session (a
// company or quiet hit with a live call, row 8, or with crisis, row 6), before its call is hung up: the answer
// carries no Permit, its Turn and Evidence are stored, a stated allergy ends as a rule or under the `unresolved`
// filter, and a crisis line sets the crisis modifier.
import { type Evidence, type Turn } from "@franki/core";
import { testId } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ok } from "../openai/fake";
import { paths } from "../store/paths";
import { UID, doorRig, postTurn, rulesOf, sessionOf, stampAfter } from "../testing/audience-doors";
import { decisionAnswer } from "../testing/decisions";
import { RULE_ALLERGENS, template } from "../testing/arb-rule-turns";
import { asrTurn, typedTurn } from "../testing/session-fixtures";

const laterArb = fc.record({
  what: fc.constantFrom<"allergy" | "crisis" | "plain">("allergy", "crisis", "plain"),
  a: fc.constantFrom(...RULE_ALLERGENS),
  source: fc.constantFrom<"asr" | "typed">("asr", "typed"),
  stamp: fc.constantFrom<"before" | "after">("before", "after"),
  judge: fc.constantFrom("O", "H", "U", "timeout"),
});

describe("brief 035 property 3: nothing said in the swap window is lost", () => {
  it("every turn on a narrowed Session is stored, its allergy kept and its crisis marked, with no Permit", { timeout: 600_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom<"company" | "quiet" | "crisisCompany">("company", "quiet", "crisisCompany"), fc.array(laterArb, { minLength: 1, maxLength: 4 }), async (kind, later) => {
        const { rig, s } = await doorRig(true);
        const probs = kind === "company" ? { company: 0.9 } : kind === "quiet" ? { quiet: 0.9 } : { crisis: 0.6, company: 0.9 };
        rig.openai.script("decisions.create", ok(decisionAnswer(probs)));
        const first = await postTurn(rig, { ...asrTurn(s.stamp, 1, "My boss just walked in.", [{ itemId: "item_1", commitSeq: 1 }]), judge: "H" });
        expect(first.body.status).toBe("blocked");
        const after = stampAfter(s.stamp, first.body);
        // The hangup Job is scheduled, not run: the call is still up, so this is the swap window.
        for (const [i, t] of later.entries()) {
          const n = i + 2;
          const label = `w${i}`;
          const tpl = template("self", t.a, t.a);
          const text = t.what === "allergy" ? tpl.text : t.what === "crisis" ? "I can't do this anymore." : "What's on for tonight?";
          const stamp = t.stamp === "before" ? s.stamp : after;
          rig.openai.script("decisions.create", ok(decisionAnswer(t.what === "allergy" ? { hardRule: 0.9 } : t.what === "crisis" ? { crisis: 0.6 } : {})));
          if (t.what === "allergy") rig.fastSlots.script((input) => ({ kind: "valid", out: { items: tpl.items(input.turn.eid), need: "none" }, ms: 120 }));
          const body = t.source === "typed" ? typedTurn(stamp, n, text, label) : { ...asrTurn(stamp, n, text, [{ itemId: `item_${label}`, commitSeq: n }], "final", label), judge: t.judge };
          const res = await postTurn(rig, body);
          const what = `${kind} later ${i} ${JSON.stringify(t)}: ${JSON.stringify(res.body)}`;
          expect(res.status, what).toBe(200);
          expect(res.body.status, what).toBe("blocked");
          expect(res.body.permit, what).toBeNull();
          const turn = await rig.store.get<Turn>(UID, paths.turn(UID, s.sessionId, testId(`turn-${label}`)));
          expect(turn?.data.text, `${what}: Turn`).toBe(text);
          const ev = turn?.data.evidenceId ? await rig.store.get<Evidence>(UID, paths.evidence(UID, turn.data.evidenceId)) : null;
          expect(ev, `${what}: Evidence`).not.toBeNull();
          if (t.what === "allergy") {
            const rules = await rulesOf(rig);
            // The gazetteer code is the allergen's singular ("peanut" for "peanuts").
            const kept = rules.allergies.some((r) => (r.subjectId === "self" && t.a.startsWith(r.code)) || r.code === "unresolved");
            expect(kept, `${what}: rules ${JSON.stringify(rules.allergies)}`).toBe(true);
          }
          if (t.what === "crisis") expect((await sessionOf(rig, s.sessionId)).modifiers.crisis, `${what}: crisis`).not.toBeNull();
        }
      }),
      { numRuns: 1_000 },
    );
  });
});
