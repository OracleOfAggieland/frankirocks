// Brief 049 property "Whose words" (part A, ruling 2): for any Session's turns, the helper's only assignment is the
// owner's own committed words: every word in its user message is the text of a user turn of that Session that is
// class U, final, committed, alive and whose Evidence is still retained when the run reads it, at or before the turn
// that asked; the asking turn's words are last; at most four, oldest first. Pasted (T), model, unfinished, dead and
// forgotten turns never reach it. Seed and counterexample recorded in brief 049's report.
import { ERRAND_ASSIGNMENT_TURNS, type Evidence, type ID, type Turn } from "@franki/core";
import { sampleEvidence, sampleTurn, testId } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { storeReader } from "../head-build";
import { paths } from "../store/paths";
import { testRig } from "../testing/fakes";
import { assignmentTurnIds, assignmentWords } from "./assignment";
import { assignmentMessage } from "./run";

const UID = "owner-1";
const SESSION = testId("ses-words");

interface TurnSpec {
  role: "user" | "assistant";
  cls: "U" | "T";
  final: boolean;
  parse: Turn["parseState"];
  state: Turn["state"];
  evidence: "retained" | "blocked" | "purged" | "none" | "missing";
  /** Forgotten between the start and the run. */
  forgetLater: boolean;
}

const arbTurn: fc.Arbitrary<TurnSpec> = fc.record({
  role: fc.constantFrom("user", "user", "user", "assistant"),
  cls: fc.constantFrom("U", "U", "T"),
  final: fc.constantFrom(true, true, true, false),
  parse: fc.constantFrom("committed", "committed", "committed", "pending", "failed"),
  state: fc.constantFrom("committed", "committed", "committed", "transcribed", "dead"),
  evidence: fc.constantFrom("retained", "retained", "retained", "blocked", "none", "missing"),
  forgetLater: fc.boolean(),
}) as fc.Arbitrary<TurnSpec>;

const ok = (t: TurnSpec, later: boolean) =>
  t.role === "user" && t.cls === "U" && t.final && t.parse === "committed" && t.state !== "dead" && (t.evidence === "retained" || t.evidence === "none") && !(later && t.forgetLater && t.evidence === "retained");

describe("property: whose words (brief 049)", () => {
  it("500 runs", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(arbTurn, { maxLength: 24 }), arbTurn, async (earlier, askRaw) => {
        const ask: TurnSpec = { ...askRaw, role: "user", cls: "U", final: true, parse: "committed", state: "committed", evidence: askRaw.evidence === "none" ? "none" : "retained" };
        const all = [...earlier, ask];
        const rig = testRig();
        const ids = all.map((_, i) => testId(`t${i}`) as ID);
        await rig.store.transaction(UID, async (tx) => {
          all.forEach((t, i) => {
            const eid = testId(`e${i}`) as ID;
            if (t.evidence !== "none" && t.evidence !== "missing") tx.create(paths.evidence(UID, eid), sampleEvidence({ status: t.evidence, text: { kind: "inline", text: `w${i}` } }));
            tx.create(
              paths.turn(UID, SESSION, ids[i]!),
              sampleTurn({ sessionId: SESSION, seq: i + 1, role: t.role, sourceClass: t.cls, final: t.final, parseState: t.parse, state: t.state, text: `w${i}`, evidenceId: t.evidence === "none" ? null : eid }),
            );
          });
        });
        const askTurn = (await rig.store.get<Turn>(UID, paths.turn(UID, SESSION, ids.at(-1)!)))!.data;
        const turnIds = await assignmentTurnIds(storeReader(rig.store, UID), UID, SESSION, askTurn, ids.at(-1)!);
        expect(turnIds).not.toBeNull();
        // Some of them are forgotten before the run reads the words.
        await rig.store.transaction(UID, async (tx) => {
          const docs = await Promise.all(all.map((t, i) => (t.forgetLater && t.evidence === "retained" ? tx.get<Evidence>(paths.evidence(UID, testId(`e${i}`))) : Promise.resolve(null))));
          for (const d of docs) if (d !== null) tx.update(d.path, { ...d.data, status: "blocked" });
        });
        const words = await assignmentWords(rig.store, UID, SESSION, turnIds!);
        const message = assignmentMessage(words);
        expect(message.role).toBe("user");
        expect(JSON.parse(message.content)).toEqual({ owner_words: words });
        expect(words.length).toBeLessThanOrEqual(ERRAND_ASSIGNMENT_TURNS);
        const index = words.map((w) => Number(w.slice(1)));
        // Every word is an owner's own committed turn, still readable, at or before the ask, oldest first.
        for (const i of index) expect(ok(all[i]!, true)).toBe(true);
        expect([...index].sort((a, b) => a - b)).toEqual(index);
        // The ask's words are last, unless the ask itself was forgotten.
        if (ok(ask, true)) expect(index.at(-1)).toBe(all.length - 1);
        else expect(index).not.toContain(all.length - 1);
        // Nothing the owner said more recently than a word that made it is skipped (no gaps among the last four).
        const eligibleAtStart = all.map((t, i) => (ok(t, false) && i >= all.length - 16 ? i : -1)).filter((i) => i >= 0).slice(-ERRAND_ASSIGNMENT_TURNS);
        expect(index).toEqual(eligibleAtStart.filter((i) => ok(all[i]!, true)));
      }),
      { numRuns: 500 },
    );
  }, 600_000);
});
