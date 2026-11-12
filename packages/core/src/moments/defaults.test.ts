// Brief 036 finding 6: moment rows written before `rendered` existed read with it null, and then validate.
import { describe, expect, it } from "vitest";
import { Moment, withMomentDefaults } from "../schema/records";
import { validate } from "../schema/v";
import { deriveOccasion } from "./derive";
import { momentRow } from "./merge";
import { memId, momentHasher, occasionMemory } from "./testing/arb-moments";

describe("withMomentDefaults", () => {
  it("fills rendered with null on a row written before brief 036, and keeps a rendered line", () => {
    const m = occasionMemory(memId(1), { zone: "UTC", startMs: Date.UTC(2026, 10, 13, 14), precision: "instant", endMinutes: null, extraDays: 0 });
    const row = momentRow(deriveOccasion(m, new Map([[m.logicalId, m]]), momentHasher).plans[0]!, { uid: "owner-1", opsNow: Date.UTC(2026, 10, 12), epoch: 1, policyRev: 1, clockMode: "fixture" }, momentHasher);
    const { rendered: _, ...old } = row;
    expect(validate(Moment, old).ok).toBe(false);
    const read = withMomentDefaults(old);
    expect(read.rendered).toBeNull();
    expect(validate(Moment, read).ok).toBe(true);
    const rendered = { noteId: "tnote", text: "Hi.", tokens: ["hi"], at: row.createdAt };
    expect(withMomentDefaults({ ...row, rendered }).rendered).toEqual(rendered);
  });
});
