/**
 * The tool's S0 limit leaks nothing above it (review 028, finding 2; brief 020 `limitSnapshot`). 1,000 runs.
 *   FOR ALL stores of shown rows (S0 and S1) read by a private caller, and each ceiling, the first snapshot page
 *   after `limitSnapshot(view, ceiling)` holds no card, told line, topic count or cursor derived from a row above
 *   the ceiling: every card and told line is at or under it, every topic count is at most the number of shown
 *   rows at or under it with that predicate, and the cursor is null or names a row at or under it.
 * `heldPrivate` is left out on purpose: it is the designed count of what is held back, with no content.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { limitSnapshot, shown, snapshot } from "./memory-views";
import { buildStore } from "./testing/memory-store-arb";

const RANK = { S0: 0, S1: 1, S2: 2 } as const;

/** Array indices 7, 8 and 9 sort last of up to 70 rows (keys are compared as strings). */
const LAST_SORTED = new Set([7, 8, 9]);

const caseArb = fc
  .tuple(fc.integer({ min: 1, max: 70 }), fc.boolean(), fc.array(fc.constantFrom("S0", "S0", "S0", "S0", "S1"), { minLength: 70, maxLength: 70 }), fc.array(fc.integer({ min: 1, max: 28 }), { minLength: 70, maxLength: 70 }))
  .map(([n, s1Last, sens, days]) => ({
    audience: "private" as const,
    evidence: [{ kind: "turn", status: "retained", sens: "S0" }] as { kind: "turn"; status: "retained"; sens: "S0" }[],
    decisions: [],
    memories: Array.from({ length: n }, (_, i) => ({
      status: "active" as const,
      sourceClass: "U" as const,
      sens: (s1Last ? (LAST_SORTED.has(i) ? "S1" : "S0") : sens[i]!) as "S0" | "S1",
      flow: "open" as const,
      forgotten: false,
      dirty: false,
      dep: 0,
      text: "I like spicy food" as const,
      assertedDay: days[i]!,
    })),
  }));

describe("memory views: the S0 limit leaks nothing above it", () => {
  it("the fixed case: page 1 is 50 S0 cards and three S1 rows sort later; no topic counts them", () => {
    const k = fc.sample(caseArb, { numRuns: 1, seed: 1 })[0]!;
    const memories = Array.from({ length: 60 }, (_, i) => ({ ...k.memories[0]!, sens: (LAST_SORTED.has(i) ? "S1" : "S0") as "S0" | "S1" }));
    const s = buildStore({ ...k, memories } as never);
    const out = limitSnapshot(snapshot(s.rows, s.ctx, null)!, "S0");
    expect(out.cards).toHaveLength(50);
    expect(out.overview.topics.reduce((n, t) => n + t.count, 0)).toBeLessThanOrEqual(57);
  });

  it("cards, told lines, topic counts and the cursor come only from rows at or under the ceiling", () => {
    fc.assert(
      fc.property(caseArb, fc.constantFrom("S0" as const, "S1" as const), (k, ceiling) => {
        const s = buildStore(k as never);
        const view = snapshot(s.rows, s.ctx, null);
        expect(view).not.toBeNull();
        const out = limitSnapshot(view!, ceiling);
        const under = s.rows.filter((r) => shown(r, s.ctx) && RANK[r.memory.sens] <= RANK[ceiling]);
        const underIds = new Set(under.map((r) => r.id as string));
        for (const c of out.cards) expect(underIds.has(c.id), `card ${c.id} is above ${ceiling}`).toBe(true);
        for (const w of out.overview.recentTold) expect(underIds.has(w.noteId), `told line ${w.noteId} is above ${ceiling}`).toBe(true);
        for (const t of out.overview.topics) {
          const most = under.filter((r) => r.memory.predicate === t.predicate).length;
          expect(t.count, `topic ${t.predicate} counts rows above ${ceiling}`).toBeLessThanOrEqual(most);
        }
        if (out.cursor !== null) expect(underIds.has(out.cursor), `cursor ${out.cursor} names a row above ${ceiling}`).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });
});
