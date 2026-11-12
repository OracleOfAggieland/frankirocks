// Feature: brief 041 part 2, Property 4: a name alone never merges two people. For any two mentions with one name and
// conflicting roles, in either order, in one turn or across two, two entities exist and each keeps its own relation
// current. With a sister renamed to that name (brief 043 finding), a conflicting role is somebody else and the
// sister's relation stays hers.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ROLES, nameArb, peopleRig, relationItem, relations, seedRenamedSister, twoRolesArb } from "../testing/arb-people";

const SISTER = ROLES.find((r) => r.code === "sister")!;
const OTHERS = ROLES.filter((r) => r !== SISTER);

describe("Property 4 (brief 041): a name alone never merges two people", () => {
  it("two conflicting roles under one name are two entities, each current", { timeout: 600_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(nameArb, twoRolesArb, fc.boolean(), async (name, [a, b], oneTurn) => {
        const w = peopleRig();
        if (oneTurn) await w.say(`${a.line(name)} ${b.line(name)}`, (t) => [relationItem(t, name, a, 0), relationItem(t, name, b, 1)]);
        else {
          await w.say(a.line(name), (t) => [relationItem(t, name, a, 0)]);
          await w.say(b.line(name), (t) => [relationItem(t, name, b, 0)]);
        }
        const rels = relations(await w.memories());
        expect(rels.map(([, code, label]) => `${code}:${label}`).sort()).toEqual([`${a.code}:${a.label}`, `${b.code}:${b.label}`].sort());
        expect(new Set(rels.map(([ref]) => ref)).size).toBe(2);
      }),
      { numRuns: 1000 },
    );
  });

  it("a renamed sister's new name with a conflicting role is somebody else", { timeout: 600_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(nameArb, fc.constantFrom(...OTHERS), async (name, role) => {
        const w = peopleRig();
        const sister = await seedRenamedSister(w.rig, name);
        await w.say(role.line(name), (t) => [relationItem(t, name, role, 0)]);
        const rels = relations(await w.memories());
        expect(rels).toContainEqual([sister, "sister", "sister"]);
        const other = rels.filter(([ref]) => ref !== sister);
        expect(other.map(([, code, label]) => `${code}:${label}`)).toEqual([`${role.code}:${role.label}`]);
      }),
      { numRuns: 1000 },
    );
  });
});
