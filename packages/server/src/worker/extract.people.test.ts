// Brief 041 part 2 (G-FT16): two people with one name stay two people, and the rename index answers only for a
// person whose stated role fits (the brief 043 review finding on `resolveMention`).
import { describe, expect, it } from "vitest";
import { ROLES, bareItem, peopleRig, relationItem, relations, seedRenamedSister } from "../testing/arb-people";

const [WORK, NEIGHBOR, SISTER] = [ROLES[0]!, ROLES[1]!, ROLES[2]!];

describe("two people with one name (FT16)", () => {
  it("a colleague and a neighbor named Alex are two entities, each with its relation current", async () => {
    const w = peopleRig();
    await w.say(WORK.line("Alex"), (t) => [relationItem(t, "Alex", WORK, 0)]);
    await w.say(NEIGHBOR.line("Alex"), (t) => [relationItem(t, "Alex", NEIGHBOR, 0)]);
    const rels = relations(await w.memories());
    expect(rels.map(([, code, label]) => `${code}:${label}`).sort()).toEqual(["colleague:colleague", "other:neighbor"]);
    expect(new Set(rels.map(([ref]) => ref)).size).toBe(2);
  });

  it("the same role said again joins the stored entity, whose ID does not change", async () => {
    const w = peopleRig();
    await w.say(WORK.line("Alex"), (t) => [relationItem(t, "Alex", WORK, 0)]);
    const [first] = relations(await w.memories());
    await w.say(`Alex from work is out today.`, (t) => [relationItem(t, "Alex", WORK, 0)]);
    const rels = relations(await w.memories());
    expect(rels).toHaveLength(1);
    expect(rels[0]![0]).toBe(first![0]);
  });

  it("a bare name that fits two stored people writes about neither", async () => {
    const w = peopleRig();
    await w.say(WORK.line("Alex"), (t) => [relationItem(t, "Alex", WORK, 0)]);
    await w.say(NEIGHBOR.line("Alex"), (t) => [relationItem(t, "Alex", NEIGHBOR, 0)]);
    const before = await w.memories();
    await w.say("Alex is coming to dinner.", (t) => [bareItem(t, "Alex")]);
    expect(await w.memories()).toEqual(before);
  });

  it("a bare name that fits one stored person attaches to that person", async () => {
    const w = peopleRig();
    await w.say(WORK.line("Alex"), (t) => [relationItem(t, "Alex", WORK, 0)]);
    const [[ref]] = relations(await w.memories()) as [readonly [string, string | null, string | null]];
    await w.say("Alex is coming to dinner.", (t) => [bareItem(t, "Alex")]);
    const facts = [...(await w.memories()).values()].filter((m) => m.predicate === "fact");
    expect(facts.map((m) => m.subjectId)).toEqual([ref]);
  });
});

describe("the rename index answers only for a person whose role fits (brief 043 finding)", () => {
  it("after the sister is renamed Mara, 'my coworker Mara' is somebody else", async () => {
    const w = peopleRig();
    const sister = await seedRenamedSister(w.rig, "Mara");
    await w.say(WORK.line("Mara"), (t) => [relationItem(t, "Mara", WORK, 0)]);
    const rels = relations(await w.memories());
    expect(rels).toContainEqual([sister, "sister", "sister"]);
    const work = rels.find(([, code]) => code === "colleague");
    expect(work).toBeDefined();
    expect(work![0]).not.toBe(sister);
  });

  it("'my sister Mara' is still the renamed sister", async () => {
    const w = peopleRig();
    const sister = await seedRenamedSister(w.rig, "Mara");
    await w.say(SISTER.line("Mara"), (t) => [relationItem(t, "Mara", SISTER, 0)]);
    const rels = relations(await w.memories());
    expect(rels.map(([ref]) => ref)).toEqual([sister]);
  });
});
