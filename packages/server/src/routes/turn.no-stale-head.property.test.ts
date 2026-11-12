// Brief 043, new property 7: no stale Head after a death. The owner's dad is ill, they care for him, and he loves
// fishing. In a call, "My dad passed away last night." commits on the fast path (fastO recorded). For any one to three
// later turns in that session (typed or spoken, with or without route items), no later turn's Head places a line
// about the dad in People or Quietly apply.
import { type CoreBundle, type FastItem, mentionEid } from "@franki/core";
import { testId } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { recordFastO } from "../admission/seam";
import { paths } from "../store/paths";
import { UID, at, byMention, post, seed, setup, transition, whole } from "../testing/review-043";

const DAD_LINES = ["The owner's dad is ill.", "The owner is caring for their dad.", "The owner's dad loves fishing."];
const LATER = [
  { text: "Thanks for listening.", items: () => [] as ((eid: string) => FastItem)[] },
  { text: "What should I cook tonight?", items: () => [] },
  { text: "I'm allergic to peanuts.", items: () => [(eid: string): FastItem => ({ kind: "allergy", subject: { entityId: null, mention: null, isSelf: true }, item: "peanuts", severity: "allergy", polarity: "affirmed", act: "direct", span: whole(eid, "I'm allergic to peanuts.") })] },
  { text: "I moved to York last week.", items: () => [transition("I moved to York last week.", (eid) => ({ transition: "move", counterpart: byMention(at(eid, "I moved to York last week.", "York")), whenSpoken: "last week" }))] },
] as const;

/** The lines under the People and Quietly apply headings. */
function proactive(text: string): string[] {
  const out: string[] = [];
  let inside = false;
  for (const line of text.split("\n")) {
    if (line === "People:" || line === "Quietly apply:") inside = true;
    else if (/^\S.*:$/.test(line) || line.trim() === "") inside = false;
    else if (inside) out.push(line);
  }
  return out;
}

describe("Property 7 (brief 043): no stale Head after a death", () => {
  it("no later turn's Head brings up the dead", { timeout: 600_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.record({ pick: fc.nat(LATER.length - 1), asr: fc.boolean() }), { minLength: 1, maxLength: 3 }), async (later) => {
        let dad = "";
        const a = await setup({
          before: async (rig) => {
            dad = mentionEid("person", "dad", rig.deps.hasher);
            await seed(rig, "My dad has been really sick, he loves fishing.", [
              { subjectId: dad, predicate: "person.life", value: { kind: "enum", code: "ill" }, args: { detail: null }, line: DAD_LINES[0]! },
              { subjectId: "self", predicate: "care", value: { kind: "enum", code: "open" }, args: { careSubjectRef: dad, topic: "sick" }, line: DAD_LINES[1]!, entityIds: [dad] },
              { subjectId: dad, predicate: "fact", value: { kind: "text", text: "loves fishing" }, args: { topic: "other", label: null }, line: DAD_LINES[2]! },
            ]);
          },
        });
        const open = (await a.rig.store.get<CoreBundle>(UID, paths.core(UID, "bundle")))!.data;
        expect(proactive(open.head?.text ?? "").some((l) => DAD_LINES.some((d) => l.includes(d))), "the dad is in People before (not vacuous)").toBe(true);
        await a.rig.store.transaction(UID, (tx) => recordFastO(tx, { uid: UID, stamp: { ...a.s.stamp, turnId: testId("turn-1") }, responseId: "resp_s", opsNow: a.rig.clock.read().opsClock.now, core: { epoch: 1, policyRev: 1 }, audience: "private" }, a.rig.deps));
        const D = "My dad passed away last night.";
        const first = await post(a, D, [transition(D, (eid) => ({ subject: byMention(at(eid, D, "My dad")), whenSpoken: "last night" }))], { asr: true });
        let stamp = first.res.body.stamp;
        for (const [i, l] of later.entries()) {
          const t = LATER[l.pick]!;
          a.rig.clock.advance(1_000);
          const r = await post(a, t.text, [...t.items()], { asr: l.asr, seq: i + 2, stamp });
          if (r.res.body.status !== "ordinary" && r.res.body.status !== "blocked") continue;
          stamp = r.res.body.stamp;
          const lines = proactive(r.bundle.head?.text ?? "");
          for (const d of DAD_LINES) expect(lines.some((x) => x.includes(d)), `after "${t.text}" (turn ${i + 2}): "${d}" is still in People or apply`).toBe(false);
        }
      }),
      { numRuns: 1000 },
    );
  });
});
