// Feature: voice-writes (brief 012 wave B, task B8), Property 15: a partial first net doesn't switch off the second
// (design section 7, G18, G39). For a triggered voice turn whose Fake_FastSlots answer is a strict subset of the
// allergy items the extraction fake returns, including an allergen in a sentence with no cue word, after the route,
// then extraction, then the next turn's proposal application, every gazetteer-coded item has a slot in `core/rules`.
import { type CoreRules, type FastItem, type Session, scanAliases } from "@franki/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { paths } from "../store/paths";
import { decisionAnswer } from "../testing/decisions";
import { extractOutput, factItem } from "../testing/extract-fixtures";
import { callRoute, patchRecord, settle, testRig } from "../testing/fakes";
import { asrTurn, openTestSession } from "../testing/session-fixtures";
import { turnRoute } from "../routes/turn";

const UID = "owner-1";
const FIRST = ["shellfish", "peanuts", "sesame", "kiwi", "milk"] as const;
const LATER = ["cashews", "walnuts", "almonds", "mustard", "celery"] as const;
const TAILS = (x: string) => [`Oh, and ${x} too.`, `${x[0]!.toUpperCase()}${x.slice(1)} as well.`, `Also ${x}, I think.`];

const caseArb = fc.record({ a: fc.constantFrom(...FIRST), b: fc.constantFrom(...LATER), tail: fc.nat(2), keep: fc.constantFrom<"none" | "first">("none", "first"), self: fc.boolean() });

describe("Property 15: a partial first net doesn't switch off the second", () => {
  it("every coded extraction item has a slot after the next turn", { timeout: 300_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(caseArb, async ({ a, b, tail, keep, self }) => {
        const rig = testRig();
        const s = await openTestSession(rig);
        await patchRecord<Session>(rig.store, UID, paths.session(UID, s.sessionId), { status: "active", registeredCallIds: ["rtc_a"], callId: "rtc_a" });
        const text = `I'm allergic to ${a}. ${TAILS(b)[tail]!}`;
        const cue = `I'm allergic to ${a}`;
        const second = TAILS(b)[tail]!;
        const at2 = text.indexOf(second);
        const route: (eid: string) => FastItem[] = (eid) => [{ kind: "allergy", subject: { entityId: null, mention: null, isSelf: true }, item: a, severity: "allergy", polarity: "affirmed", act: "direct", span: { eid, fieldPath: "text", start: 0, end: cue.length, quote: cue } }];
        rig.openai.script("decisions.create", ok(decisionAnswer({ hardRule: 0.9 })));
        rig.fastSlots.script((input) => ({ kind: "valid", out: { items: keep === "first" ? route(input.turn.eid) : [], need: "none" }, ms: 50 }));
        const codeA = scanAliases(a)[0]!.code;
        const codeB = scanAliases(b)[0]!.code;
        const res = await settle(callRoute(rig, turnRoute, asrTurn(s.stamp, 1, text, [{ itemId: "item_1", commitSeq: 1 }])), rig.clock, rig.timers);
        const eid = res.value.body.stamp ? (await rig.store.get<{ evidenceId: string }>(UID, paths.turn(UID, s.sessionId, res.value.body.stamp.turnId)))!.data.evidenceId : "";
        const allergyItem = (code: string, start: number, end: number) => ({
          ...factItem(self ? "statement" : "statement", "new", "", [{ eid, fieldPath: "text", start, end, quote: text.slice(start, end) }]),
          kind: "rule",
          predicate: "allergy",
          value: { kind: "boolean", bool: true },
          args: { allergenCode: code },
        });
        rig.openai.script("responses.create", ok(completed(JSON.stringify(extractOutput([allergyItem(codeA, 0, cue.length), allergyItem(codeB, at2, at2 + second.length - 1)])))));
        rig.openai.always("responses.create", ok(completed(JSON.stringify(extractOutput([])))));
        await settle(rig.sched.runAll(), rig.clock, rig.timers);
        // The next turn applies the open proposals.
        const st = res.value.body.stamp;
        rig.openai.script("decisions.create", ok(decisionAnswer({})));
        await settle(callRoute(rig, turnRoute, asrTurn({ ...s.stamp, bundleRev: st.bundleRev, rulesRev: st.rulesRev, policyRev: st.policyRev, epoch: st.epoch }, 2, "We watched a film about trains.", [{ itemId: "item_2", commitSeq: 2 }])), rig.clock, rig.timers);
        await settle(rig.sched.runAll(), rig.clock, rig.timers);
        const rules = (await rig.store.get<CoreRules>(UID, paths.core(UID, "rules")))!.data;
        const codes = new Set(rules.allergies.map((r) => r.code));
        for (const c of [codeA, codeB]) expect(codes.has(c), `${c} has no slot: ${JSON.stringify(rules.allergies.map((r) => [r.subjectId, r.code, r.state]))}`).toBe(true);
      }),
      { numRuns: 30 },
    );
  });
});
