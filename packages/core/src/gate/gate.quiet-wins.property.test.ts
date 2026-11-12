/**
 * Quiet wins (brief 024; spec §6 "An explicit 'don't bring it up' still wins"). 1,000 runs.
 *   FOR ALL candidates whose topic is marked "don't bring it up", and every context, including one holding an exact,
 *   unused, unexpired authorization for this very candidate: an unprompted verdict is never say or card, and with
 *   `all_output` no trigger gives say or card.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { tsFromMs } from "../schema/primitives";
import { gate } from "./gate";
import { WORLD_NOW_MS, candidateArb, contextArb, topicArb } from "./testing/arb";

describe("gate: quiet wins", () => {
  it("never brings up a quiet topic, whatever authorization exists", () => {
    fc.assert(
      fc.property(candidateArb, topicArb, contextArb, fc.constantFrom("unsolicited", "all_output" as const), fc.boolean(), (c0, t, x0, quiet, exactAuth) => {
        const c = { ...c0, topic: { ...t, quiet } };
        const x = exactAuth
          ? {
              ...x0,
              audience: "private" as const,
              authorization: {
                subjectId: c.subjectId,
                topicId: t.topicId,
                momentId: c.id,
                audience: "private" as const,
                expiresAt: tsFromMs(WORLD_NOW_MS + 48 * 3_600_000),
                used: false,
                sourceClass: "U" as const,
              },
            }
          : x0;
        const r = gate(c, x);
        if (x.trigger === "unprompted" || quiet === "all_output") expect(["hold", "silent"]).toContain(r.verdict);
      }),
      { numRuns: 1000 },
    );
  });
});
