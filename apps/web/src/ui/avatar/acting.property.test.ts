// Property tests for the acting mapper and the one-shot edge machine (brief 013, design note §2.2, §3.3, §8.1).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { arbInput } from "../test-arbitraries";
import { actingFor, INITIAL_EDGE, oneShotStep } from "./acting";
import type { EdgeState, OneShot } from "./acting";
import { lookFor } from "./look";

const POSES = ["idle", "listening", "thinking", "speaking"];
const OVERLAYS = ["none", "dormant", "recovery", "awaiting"];

describe("actingFor over Look_Mapper outputs", () => {
  it("is total and deterministic: one closed Acting for any look, equal on a deep copy", () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const look = lookFor(input);
        const a = actingFor(look);
        expect(Object.keys(a).sort()).toEqual(["electric", "ghost", "mic", "name", "oneShot", "overlay", "pose", "voice"]);
        expect(POSES).toContain(a.pose);
        expect(OVERLAYS).toContain(a.overlay);
        expect([null, "wake", "celebrate"]).toContain(a.oneShot);
        expect(actingFor(structuredClone(look))).toEqual(a);
      }),
      { numRuns: 400 },
    );
  });

  it("P-A: the pose is speaking exactly when the look follows the output", () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const look = lookFor(input);
        expect(actingFor(look).pose === "speaking").toBe(look.follows === "output");
      }),
      { numRuns: 400 },
    );
  });

  it("P-B: the voice gate opens only when the look follows the output, so a held reply never moves the body", () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const look = lookFor(input);
        const a = actingFor(look);
        if (a.voice) expect(look.follows).toBe("output");
        expect(a.voice).toBe(look.follows === "output");
        // A reply that is not playing (any state but speaking, or speaking with output muted) shuts the gate.
        if (input.state !== "speaking" || input.outputMuted) expect(a.voice).toBe(false);
      }),
      { numRuns: 400 },
    );
  });

  it("the mic gate opens only when the look follows the input", () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const look = lookFor(input);
        const a = actingFor(look);
        if (a.mic) expect(look.follows).toBe("input");
        expect(a.mic).toBe(look.follows === "input");
        expect(a.mic && a.voice).toBe(false);
      }),
      { numRuns: 400 },
    );
  });

  it("ghost, electric and name are the look's own", () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const look = lookFor(input);
        const a = actingFor(look);
        expect(a.ghost).toBe(look.ghost);
        expect(a.ghost).toBe(input.micMuted);
        expect(a.electric).toBe(look.electric);
        expect(a.name).toBe(look.name);
      }),
      { numRuns: 400 },
    );
  });

  it("the one-shot follows the name", () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const look = lookFor(input);
        const expected = look.name === "Waking" ? "wake" : look.name === "Celebrate" ? "celebrate" : null;
        expect(actingFor(look).oneShot).toBe(expected);
      }),
      { numRuns: 400 },
    );
  });

  it("the ghost overlay never changes the pose, the overlay, the one-shot or the gates", () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const plain = actingFor(lookFor({ ...input, micMuted: false }));
        const ghost = actingFor(lookFor({ ...input, micMuted: true }));
        expect(ghost).toEqual({ ...plain, ghost: true });
      }),
      { numRuns: 300 },
    );
  });
});

const arbOneShot: fc.Arbitrary<OneShot | null> = fc.constantFrom(null, "wake", "celebrate");
const arbEdge: fc.Arbitrary<EdgeState> = fc.record({ oneShot: arbOneShot, skipped: fc.boolean() });

describe("oneShotStep", () => {
  it("is total and deterministic, and never mutates its input", () => {
    fc.assert(
      fc.property(arbEdge, arbOneShot, fc.boolean(), (s, next, running) => {
        const copy = { ...s };
        const out = oneShotStep(s, next, running);
        expect(s).toEqual(copy);
        expect(out).toEqual(oneShotStep(copy, next, running));
        expect(out.state.oneShot).toBe(next);
        expect(["none", "start"]).toContain(out.command.wake);
        expect(["none", "start", "cut"]).toContain(out.command.celebrate);
      }),
    );
  });

  it("starts only on entry, only while running, and only the one-shot entered", () => {
    fc.assert(
      fc.property(arbEdge, arbOneShot, fc.boolean(), (s, next, running) => {
        const { command } = oneShotStep(s, next, running);
        expect(command.wake === "start").toBe(running && next === "wake" && s.oneShot !== "wake");
        expect(command.celebrate === "start").toBe(running && next === "celebrate" && s.oneShot !== "celebrate");
      }),
    );
  });

  it("cuts celebrate exactly when the look leaves it, running or not", () => {
    fc.assert(
      fc.property(arbEdge, arbOneShot, fc.boolean(), (s, next, running) => {
        const { command } = oneShotStep(s, next, running);
        expect(command.celebrate === "cut").toBe(s.oneShot === "celebrate" && next !== "celebrate");
      }),
    );
  });

  it("skipped: set on an entry while not running, kept while staying, cleared by any non-one-shot", () => {
    fc.assert(
      fc.property(arbEdge, arbOneShot, fc.boolean(), (s, next, running) => {
        const { state } = oneShotStep(s, next, running);
        if (next === null) expect(state.skipped).toBe(false);
        else if (next === s.oneShot) expect(state.skipped).toBe(s.skipped);
        else expect(state.skipped).toBe(!running);
      }),
    );
  });

  it("over any walk from the start, a one-shot is either started or skipped, never neither", () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(arbOneShot, fc.boolean()), { maxLength: 40 }), (steps) => {
        let s: EdgeState = INITIAL_EDGE;
        for (const [next, running] of steps) {
          const out = oneShotStep(s, next, running);
          if (next !== null && next !== s.oneShot) {
            const started = next === "wake" ? out.command.wake === "start" : out.command.celebrate === "start";
            expect(started !== out.state.skipped).toBe(true);
          }
          s = out.state;
        }
      }),
    );
  });
});
