/**
 * Narrowing never widens, verdict or render (brief 033 property 5; spec §6 "Modifiers only subtract"). 1,000 runs.
 *   FOR ALL candidates and pairs of contexts where the second is stricter on any of audience (private to company or
 *   unknown), crisis, rushed, quiet hours, the day's caps, rule data (`ready` to missing or unreadable) and the
 *   opened topics (fewer), the stricter verdict is never more open, and when both say, the stricter render is never
 *   freer, by `GATE_RENDER_FREEDOM`.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { gate } from "./gate";
import { GATE_RENDER_FREEDOM, GATE_VERDICTS, type GateRender } from "./reasons";
import { tsFromMs } from "../schema/primitives";
import { WORLD_NOW_MS, candidateArb, contextArb } from "./testing/arb";
import type { GateContext } from "./types";

const rank = (v: (typeof GATE_VERDICTS)[number]) => GATE_VERDICTS.length - GATE_VERDICTS.indexOf(v);
const freedom = (r: GateRender | null) => (r === null ? -1 : GATE_RENDER_FREEDOM.length - GATE_RENDER_FREEDOM.indexOf(r));

/** A zone Intl does not know counts as quiet hours at every instant (`inQuietHours`), so it narrows only that. */
const QUIET_ZONE = "Not/AZone";

/**
 * Half the wide contexts are an ordinary unprompted private daytime with nothing used up, so most candidates reach
 * `say` and the narrowing has something to take away.
 */
const pair = fc
  .tuple(contextArb, fc.boolean())
  .map(([x, open]) =>
    open
      ? { ...x, trigger: "unprompted" as const, audience: "private" as const, worldNow: tsFromMs(WORLD_NOW_MS), modifiers: { rushed: false, crisis: false }, counts: { proactive: 0, heavy: 0, senderAsks: 0, notesThisReply: 0 }, rules: "ready" as const }
      : x,
  )
  .chain((wide) =>
    fc
      .record({
        audience: wide.audience === "private" ? fc.constantFrom("private", "company", "unknown" as const) : fc.constant(wide.audience),
        rushed: wide.modifiers.rushed ? fc.constant(true) : fc.boolean(),
        crisis: wide.modifiers.crisis ? fc.constant(true) : fc.boolean(),
        quiet: fc.boolean(),
        extra: fc.record({ proactive: fc.nat(3), heavy: fc.nat(2), senderAsks: fc.nat(2), notesThisReply: fc.nat(2) }),
        rules: wide.rules === "ready" ? fc.constantFrom("ready", "missing", "unreadable" as const) : fc.constant(wide.rules),
        opened: fc.subarray([...wide.openedTopics]),
      })
      .map((n) => {
        const narrow: GateContext = {
          ...wide,
          audience: n.audience,
          modifiers: { rushed: n.rushed, crisis: n.crisis },
          zone: n.quiet ? QUIET_ZONE : wide.zone,
          counts: {
            proactive: wide.counts.proactive + n.extra.proactive,
            heavy: wide.counts.heavy + n.extra.heavy,
            senderAsks: wide.counts.senderAsks + n.extra.senderAsks,
            notesThisReply: wide.counts.notesThisReply + n.extra.notesThisReply,
          },
          rules: n.rules,
          openedTopics: n.opened,
        };
        return { wide, narrow };
      }),
  );

describe("gate: narrowing never widens", () => {
  it("never opens the verdict or frees the render", () => {
    fc.assert(
      fc.property(candidateArb, fc.boolean(), pair, (c0, plain, { wide, narrow }) => {
        // Half the candidates are an eligible, sayable, non-food item on a topic that isn't quiet.
        const c = plain ? { ...c0, eligibility: { allow: true, reason: "ok" }, act: "say" as const, food: false, mustSay: null, topic: c0.topic === null ? null : { ...c0.topic, quiet: null } } : c0;
        const w = gate(c, wide);
        const n = gate(c, narrow);
        expect(rank(n.verdict)).toBeLessThanOrEqual(rank(w.verdict));
        if (w.verdict === "say" && n.verdict === "say") expect(freedom(n.render)).toBeLessThanOrEqual(freedom(w.render));
      }),
      { numRuns: 1000 },
    );
  });
});
