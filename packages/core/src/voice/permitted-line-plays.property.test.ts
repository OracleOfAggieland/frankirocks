// Feature: the review of what reaches the wire (brief 045, part V), property 1: a permitted line can be played. For
// any call in which a delivery `Proactive` arrives in an open answer or a state answer with its matching ack, the
// machine either asks to verify it with a payload whose hash equals the Permit's (when the line is the server's own,
// for this Session, call and audience), or drops it for a named reason (`proactiveDropped`). It never sends a
// `response.create` for the line without a verified Permit: a `permitChecked` for that Permit whose hash is the
// approved one, before the create.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { payloadHash } from "../admission";
import { testHasher } from "./testing/arb-call";
import { arbProactiveCall, runProactiveCall } from "./testing/arb-proactive";

describe("Property 1 (brief 045): a permitted line can be played", () => {
  it("each line is checked with the Permit's own hash, or dropped by name; none plays unverified", () => {
    fc.assert(
      fc.property(arbProactiveCall, (c) => {
        const d = runProactiveCall(c);
        for (const x of d.delivered) {
          const at = d.trace.steps[x.step];
          if (at === undefined) continue;
          // The open's line waits for setup to reach its ack: find the step where its check was asked for.
          const asked = d.trace.steps.slice(x.step).find((s) => s.commands.some((k) => k.kind === "verifyPermit" && k.permitId === x.p.permit.permitId));
          const dropped = at.after.proactiveDropped?.turnId === x.p.turnId;
          if (x.variant === "ok" || x.variant === "open") {
            if (asked !== undefined) {
              const v = asked.commands.find((k) => k.kind === "verifyPermit" && k.permitId === x.p.permit.permitId)!;
              expect(v.kind === "verifyPermit" && payloadHash(v.payload, testHasher), `line ${x.p.turnId}: the check's payload`).toBe(x.p.permit.approvedPayloadHash);
            } else if (x.variant === "ok") expect(dropped, `line ${x.p.turnId} was neither checked nor dropped by name`).toBe(true);
          }
          for (const cr of d.createsFor(x.p)) {
            const verified = d.trace.steps.slice(0, cr.step + 1).some((s) => s.event.type === "permitChecked" && s.event.permitId === x.p.permit.permitId && s.event.hash === x.p.permit.approvedPayloadHash);
            expect(verified, `line ${x.p.turnId} created at step ${cr.step} without a verified Permit`).toBe(true);
          }
        }
      }),
      { numRuns: 1_000 },
    );
  });

  it("the calls reach a state answer's line that plays, and an opening line that plays", () => {
    let state = 0;
    let open = 0;
    for (const c of fc.sample(arbProactiveCall, { seed: 2026, numRuns: 300 })) {
      const d = runProactiveCall(c);
      for (const x of d.delivered) {
        if (d.createsFor(x.p).length === 0) continue;
        if (x.variant === "open") open += 1;
        else state += 1;
      }
    }
    expect(state).toBeGreaterThanOrEqual(30);
    expect(open).toBeGreaterThanOrEqual(40);
  });
});
