// Brief 043: the review of corrections and life changes. Each block runs the reviewer's own sequence on `/api/turn`.
import { mentionEid } from "@franki/core";
import { describe, expect, it } from "vitest";
import { seedPrior } from "../testing/arb-corrections";
import { at, byId, byMention, correction, rowsAbout, seed, setup, post, transition } from "../testing/review-043";

describe("finding 1: the owner's words choose who died, never the model's subject", () => {
  const T = "My friend's mom passed away last night.";
  async function momSeeded() {
    const a = await setup();
    const mom = mentionEid("person", "mom", a.rig.deps.hasher);
    await seed(a.rig, "My mom lives in Leeds.", [
      { subjectId: "self", predicate: "person.relation", value: { kind: "enum", code: "parent" }, args: { otherRef: mom, label: "mom", employerRef: null }, line: "The owner's mom.", entityIds: [mom] },
    ]);
    return { a, mom };
  }

  it("(a) subject.entityId = the owner's mom: nothing about her changes, and the change is deferred", async () => {
    const { a, mom } = await momSeeded();
    const r = await post(a, T, [transition(T, { subject: byId(mom), whenSpoken: "last night" })]);
    expect(rowsAbout(r.after, mom)).toEqual(rowsAbout(r.before, mom));
    expect(r.changed).toEqual([]);
    expect(r.entries.map((e) => [e.route, e.outcome, e.refs.length])).toEqual([["transition", "deferred", 0]]);
  });

  it("(b) a mention span over just \"mom\" inside \"My friend's mom\": nothing about her changes", async () => {
    const { a, mom } = await momSeeded();
    const r = await post(a, T, [transition(T, (eid) => ({ subject: byMention(at(eid, T, "mom")), whenSpoken: "last night" }))]);
    expect(rowsAbout(r.after, mom)).toEqual(rowsAbout(r.before, mom));
    expect(r.changed).toEqual([]);
    expect(r.entries.map((e) => [e.route, e.outcome])).toEqual([["transition", "deferred"]]);
  });

  it("the owner's own mom, said so, still changes on the turn", async () => {
    const { a, mom } = await momSeeded();
    const t = "My mom passed away last night.";
    const r = await post(a, t, [transition(t, (eid) => ({ subject: byMention(at(eid, t, "My mom")), whenSpoken: "last night" }))]);
    expect(rowsAbout(r.after, mom)).toContainEqual(["person.life", "deceased", "active"]);
  });
});

describe("finding 2: a typed turn with no call always gets exactly one line from Franki", () => {
  const DEATH = "My dad passed away last night.";
  async function dadSeeded() {
    const a = await setup({ call: false });
    const dad = mentionEid("person", "dad", a.rig.deps.hasher);
    await seed(a.rig, "My dad has been really sick.", [
      { subjectId: dad, predicate: "person.life", value: { kind: "enum", code: "ill" }, args: { detail: null }, line: "The owner's dad is ill." },
    ]);
    return { a, dad };
  }

  it("a death with a valid item: written, and the reply is the one line", async () => {
    const { a, dad } = await dadSeeded();
    const r = await post(a, DEATH, [transition(DEATH, (eid) => ({ subject: byMention(at(eid, DEATH, "My dad")), whenSpoken: "last night" }))]);
    expect(rowsAbout(r.after, dad)).toContainEqual(["person.life", "deceased", "active"]);
    expect(r.notes).toEqual(["I'm so sorry."]);
  });

  it("\"I might leave my job.\" (care only): one line", async () => {
    const a = await setup({ call: false });
    const t = "I might leave my job.";
    const r = await post(a, t, [transition(t, { transition: "jobChangeOwn", polarity: "uncertain", act: "uncertain" })]);
    expect(r.notes).toHaveLength(1);
  });

  it("the same death with no items: one line", async () => {
    const { a } = await dadSeeded();
    const r = await post(a, DEATH, []);
    expect(r.notes).toEqual(["I'm so sorry."]);
  });

  it("a deferred correction: one line, the ordinary reply", async () => {
    const a = await setup({ call: false, reply: "All right.", decision: { correct: 0.9 } });
    const seeded = await seedPrior(a.rig, "Maya");
    // The new name isn't in the span, so R1 defers ("value").
    const t = "No, that's wrong about Maya, her name is different.";
    const r = await post(a, t, [correction(t, { targetIds: [seeded.relId], replacementValue: { kind: "text", text: "Mara" } })]);
    expect(r.changed).toEqual([]);
    expect(r.entries.map((e) => [e.route, e.outcome])).toEqual([["correct", "deferred"]]);
    expect(r.notes).toEqual(["All right."]);
  });
});
