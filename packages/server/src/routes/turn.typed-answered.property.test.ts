// Brief 043, new property 1: a typed turn is always answered. For any typed turn with no call open, whatever
// Fake_FastSlots returns (a careful item, a wrong one, none, `need`, invalid, a transport failure), the response
// carries exactly one Franki line. Turns are life changes, care-only words, corrections and allergies, over a store
// that holds the owner's dad (ill), sister Maya and own name.
import type { FastItem, Session } from "@franki/core";
import { mentionEid } from "@franki/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { paths } from "../store/paths";
import { seedPrior } from "../testing/arb-corrections";
import { decisionAnswer } from "../testing/decisions";
import type { FakeSlotsAnswer } from "../testing/fake-fast-slots";
import { callRoute, patchRecord, testRig } from "../testing/fakes";
import { UID, at, byId, byMention, correction, seed, transition, whole } from "../testing/review-043";
import { openTestSession, typedTurn } from "../testing/session-fixtures";
import { turnRoute } from "./turn";

type Turn = { text: string; items: (ids: { dad: string; rel: string; self: string }) => ((eid: string) => FastItem)[] };
const DEATH = "My dad passed away last night.";
const ILL = "I just found out my brother was diagnosed with cancer.";
const JOB = "I might leave my job.";
const LEFT = "I left my job yesterday and I start at Brill on Monday.";
const RENAME = "No, that's wrong, her name is Mara, not Maya.";
const VAGUE = "No, that's wrong about Maya.";
const ALLERGY = "I'm allergic to peanuts.";
const TURNS: readonly Turn[] = [
  { text: DEATH, items: ({ dad }) => [transition(DEATH, (eid) => ({ subject: byMention(at(eid, DEATH, "My dad")), whenSpoken: "last night" })), transition(DEATH, { subject: byId(dad) })] },
  { text: ILL, items: () => [transition(ILL, { transition: "illness" })] },
  { text: JOB, items: () => [transition(JOB, { transition: "jobChangeOwn", polarity: "uncertain", act: "uncertain" })] },
  { text: LEFT, items: () => [transition(LEFT, (eid) => ({ transition: "jobChangeOwn", counterpart: byMention(at(eid, LEFT, "Brill")), whenSpoken: "yesterday" }))] },
  { text: RENAME, items: ({ rel }) => [correction(RENAME, { targetIds: [rel], replacementValue: { kind: "text", text: "Mara" } }), correction(RENAME, { targetIds: [rel], replacementValue: { kind: "text", text: "Maya" } })] },
  { text: VAGUE, items: ({ rel, self }) => [correction(VAGUE, { targetIds: [rel], replacementValue: null, predicate: "person.relation" }), correction(VAGUE, { targetIds: [self], replacementValue: { kind: "text", text: "Al" } })] },
  { text: ALLERGY, items: () => [(eid) => ({ kind: "allergy", subject: { entityId: null, mention: null, isSelf: true }, item: "peanuts", severity: "allergy", polarity: "affirmed", act: "direct", span: whole(eid, ALLERGY) })] },
];

type Slots = { kind: "items"; picks: number[]; need: boolean } | { kind: "invalid" } | { kind: "transport" };
const slotsArb: fc.Arbitrary<Slots> = fc.oneof(
  { weight: 5, arbitrary: fc.record({ kind: fc.constant<"items">("items"), picks: fc.array(fc.nat(3), { maxLength: 3 }), need: fc.boolean() }) },
  { weight: 1, arbitrary: fc.constant<Slots>({ kind: "invalid" }) },
  { weight: 1, arbitrary: fc.constant<Slots>({ kind: "transport" }) },
);

describe("Property 1 (brief 043): a typed turn is always answered", () => {
  it("a typed turn with no call carries exactly one Franki line", { timeout: 600_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...TURNS), slotsArb, fc.constantFrom("transition", "correct", "none"), async (turn, slots, decision) => {
        const rig = testRig();
        const seeded = await seedPrior(rig, "Maya");
        const dad = mentionEid("person", "dad", rig.deps.hasher);
        await seed(rig, "My dad has been really sick.", [{ subjectId: dad, predicate: "person.life", value: { kind: "enum", code: "ill" }, args: { detail: null }, line: "The owner's dad is ill." }], "prior2");
        const s = await openTestSession(rig);
        await patchRecord<Session>(rig.store, UID, paths.session(UID, s.sessionId), { status: "active" });
        rig.openai.always("decisions.create", ok(decisionAnswer(decision === "none" ? {} : { [decision]: 0.9 })));
        rig.openai.always("responses.create", ok(completed("I'm listening.")));
        const pool = turn.items({ dad, rel: seeded.relId, self: seeded.selfNameId });
        rig.fastSlots.script((input): FakeSlotsAnswer => {
          if (slots.kind === "invalid") return { kind: "invalid", reason: "shape", path: "$.items", ms: 50 };
          if (slots.kind === "transport") return { kind: "transport", ms: 5 };
          return { kind: "valid", out: { items: slots.picks.filter((p) => p < pool.length).map((p) => pool[p]!(input.turn.eid)), need: slots.need ? "target" : "none" }, ms: 50 };
        });
        const res = await callRoute(rig, turnRoute, typedTurn(s.stamp, 1, turn.text));
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        const notes = (res.body.notes ?? []).map((n: { text: string }) => n.text);
        expect(notes, `"${turn.text}" with ${JSON.stringify(slots)}, decision ${decision}`).toHaveLength(1);
      }),
      { numRuns: 1000 },
    );
  });
});
