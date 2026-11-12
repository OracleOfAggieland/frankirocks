// Feature: brief 041 part 2, Property 5: an ambiguous name writes about nobody. For any two stored people with one
// name and conflicting roles, a later bare mention of that name changes no row about either, and writes nothing new
// about anyone, until the owner says which.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { bareItem, nameArb, peopleRig, relationItem, twoRolesArb } from "../testing/arb-people";

describe("Property 5 (brief 041): an ambiguous name writes about nobody", () => {
  it("a bare mention that fits two people leaves every Memory as it was", { timeout: 600_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(nameArb, twoRolesArb, fc.constantFrom("is coming to dinner", "called me"), async (name, [a, b], news) => {
        const w = peopleRig();
        await w.say(a.line(name), (t) => [relationItem(t, name, a, 0)]);
        await w.say(b.line(name), (t) => [relationItem(t, name, b, 0)]);
        const before = await w.memories();
        await w.say(`${name} ${news}.`, (t) => [bareItem(t, name)]);
        expect(await w.memories()).toEqual(before);
      }),
      { numRuns: 1000 },
    );
  });
});
