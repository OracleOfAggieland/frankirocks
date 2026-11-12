// Brief 043: the review of corrections and life changes. Each block runs the reviewer's own sequence on `/api/turn`.
import { mentionEid } from "@franki/core";
import { describe, expect, it } from "vitest";
import { at, byId, byMention, rowsAbout, seed, setup, post, transition } from "../testing/review-043";

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
