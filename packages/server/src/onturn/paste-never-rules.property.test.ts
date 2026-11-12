// Feature: brief 041 part 1, Property 1: a paste never writes a rule. For any pasted text, on any prior rules, no
// active rule exists afterward that did not exist before, no rule moves from pending to active, and no Memory about the
// owner changes (spec §4: third-party text never writes a rule, a preference, identity or `life`).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { testId } from "@franki/core/testing";
import { pasteArb, pasteRig } from "../testing/arb-paste";

const prior = fc.constantFrom<"none" | "selfPeanut" | "pendingSesame">("none", "selfPeanut", "pendingSesame");

describe("Property 1 (brief 041): a paste never writes a rule", () => {
  it("leaves the active rules and the owner's Memories as they were", { timeout: 600_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(prior, fc.array(pasteArb, { minLength: 1, maxLength: 2 }), async (p, pastes) => {
        const w = await pasteRig({
          priorRules: (r) =>
            p === "none"
              ? r
              : { ...r, rulesRev: r.rulesRev + 1, allergies: [{ id: testId("r0"), subjectId: "self", code: p === "selfPeanut" ? "peanut" : "sesame", state: p === "selfPeanut" ? "active" : "pending", anonymous: false, proof: null, proofRev: null, rootKeys: [], dependsOn: [] }] },
        });
        const before = await w.rules();
        const mems = await w.memories();
        for (const t of pastes) expect((await w.paste(t)).status).toBe(200);
        const after = await w.rules();
        const was = new Map(before.allergies.map((r) => [r.id, r.state]));
        for (const r of after.allergies) if (r.state === "active") expect(was.get(r.id), `${JSON.stringify(pastes)}: ${r.code} became an active rule`).toBe("active");
        expect(await w.memories()).toEqual(mems);
      }),
      { numRuns: 1000 },
    );
  });
});
