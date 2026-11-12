// Brief 035, new property 1: a narrowing through any door. For any way a company or quiet hit arrives (on the turn,
// by the Parse_Repair, by a Superseding_Post, typed with no call, with crisis, with forget, or on a Session an open
// is replacing), once it commits: the Session's audience is not private, policyRev rose, and no later answer from
// any route for that Owner (turn, state, an open naming it, and the turn and state of the Session that open made)
// carries a Head, a note or a whisper above S0, until an `alone` line commits (no probe says alone).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { PROBE_KINDS, type ProbeRun, doorArb, leaks, narrowedState, probe, runDoor } from "../testing/audience-doors";

describe("brief 035 property 1: a narrowing through any door", () => {
  it("leaves the audience narrow, raises policyRev, and nothing above S0 goes out afterwards", { timeout: 600_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(doorArb, fc.array(fc.constantFrom(...PROBE_KINDS), { minLength: 1, maxLength: 5 }), async (door, probes) => {
        const n = await runDoor(door);
        const what = JSON.stringify(door);
        const after = await narrowedState(n);
        expect(after.audience, `${what}: audience`).not.toBe("private");
        expect(after.policyRose, `${what}: policyRev`).toBe(true);
        const run: ProbeRun = { n, opened: null };
        for (const [i, k] of probes.entries()) await probe(run, k, i);
        const found = n.answers.flatMap(leaks);
        expect(found, `${what} ${JSON.stringify(probes)}`).toEqual([]);
      }),
      { numRuns: 1_000 },
    );
  });
});
