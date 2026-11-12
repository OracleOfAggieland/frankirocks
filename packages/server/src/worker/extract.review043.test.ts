// Brief 043: the extraction half of the review's findings, on `runExtractJob` with a Fake_OpenAI output.
import { mentionEid } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { memoriesOf } from "../testing/arb-corrections";
import { type CommittedTurn, commitUserTurnForTest, extractOutput, factItem } from "../testing/extract-fixtures";
import { settle, testRig } from "../testing/fakes";
import { runExtractJob } from "./extract";

const UID = "owner-1";
const spanOf = (t: CommittedTurn, word: string) => {
  const at = t.text.indexOf(word);
  return { eid: t.eid, fieldPath: "text" as const, start: at, end: at + word.length, quote: word };
};

/** A death item for the mention `word`, said in `t`. */
function deathOut(t: CommittedTurn, word: string) {
  const whole = spanOf(t, t.text.replace(/\.$/, ""));
  const item = {
    ...factItem("transition", "new", "", [whole]),
    predicate: "person.life",
    subject: "m1",
    value: { kind: "enum", code: "deceased" },
    args: { detail: null },
    mentions: [{ localId: "m1", type: "person", observedName: word, span: spanOf(t, word), existingId: null }],
  };
  return ok(completed(JSON.stringify(extractOutput([item]))));
}

describe("finding 1, extraction: a death is never written on words that don't make it the owner's", () => {
  async function run(text: string, word: string) {
    const rig = testRig();
    const t = await commitUserTurnForTest(rig.store, UID, testId("t1"), text, rig.clock, rig.deps.hasher);
    rig.openai.script("responses.create", deathOut(t, word));
    await settle(runExtractJob(UID, t.jobId, rig.deps), rig.clock, rig.timers);
    const mom = mentionEid("person", "mom", rig.deps.hasher);
    return [...(await memoriesOf(rig.store)).values()].filter((m) => m.predicate === "person.life" && m.subjectId === mom).map((m) => [m.value.kind === "enum" ? m.value.code : null, m.status]);
  }

  it("\"My friend's mom passed away last night.\" with the mention \"mom\": nothing for the owner's mom", async () => {
    expect(await run("My friend's mom passed away last night.", "mom")).toEqual([]);
  });

  it("\"My mom passed away last night.\": her death is written", async () => {
    expect(await run("My mom passed away last night.", "mom")).toEqual([["deceased", "active"]]);
  });
});
