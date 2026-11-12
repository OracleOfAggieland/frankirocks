import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Action, CallDriver, arbAction, arbCall, runCall } from "./arb-call";
import { audible, audibleResponse, drainTimers } from "./trace";

describe("call generators and driver", () => {
  it("200 generated calls replay through step without throwing", () => {
    fc.assert(
      fc.property(arbCall, (steps) => {
        const d = runCall(steps);
        expect(d.trace.steps.length).toBeGreaterThan(0);
      }),
      { numRuns: 200 },
    );
  });

  it("every action kind appears across 1,000 samples", () => {
    const kinds = new Set<Action["k"]>();
    for (const a of fc.sample(arbAction, { numRuns: 1_000, seed: 1 })) kinds.add(a.k);
    expect([...kinds].sort()).toEqual(
      ["commit", "connectionLost", "created", "done", "error", "fnCall", "foreign", "hash", "higherDeck", "itemAdded", "judgeDone", "speechStart", "speechStop", "started", "stateFailed", "stateOk", "stopped", "timer", "toolAnswer", "transcript", "turnFailed", "turnOk"].sort(),
    );
  });

  it("the driver brings the call to LISTENING and records each step", () => {
    const d = new CallDriver().start();
    expect(d.st.phase).toBe("LISTENING");
    const s = d.trace.steps.at(-1)!;
    expect(s).toMatchObject({ after: { phase: "LISTENING" } });
    expect(s.before.phase).toBe("CONFIGURING");
  });

  it("audible agrees with a hand-built trace", () => {
    const d = new CallDriver().start();
    const s = d.trace.steps.at(-1)!;
    expect(audible({ ...s, playing: "r1", after: { ...s.after, outputMuted: false } }, "r1")).toBe(true);
    expect(audible({ ...s, playing: "r1", after: { ...s.after, outputMuted: true } }, "r1")).toBe(false);
    expect(audibleResponse({ ...s, playing: null, after: { ...s.after, outputMuted: false } })).toBeNull();
  });

  it("drainTimers settles a listening call at once", () => {
    const d = new CallDriver().start();
    expect(drainTimers(d.st, d.now).settled).toBe(true);
  });

  it("is not vacuous: some calls post turns and some reach SPEAKING", () => {
    const calls = fc.sample(arbCall, { numRuns: 300, seed: 7 }).map((s) => runCall(s));
    const posted = calls.filter((d) => d.trace.steps.some((x) => x.commands.some((c) => c.kind === "turn"))).length;
    const spoke = calls.filter((d) => d.trace.steps.some((x) => x.after.phase === "SPEAKING")).length;
    expect(posted).toBeGreaterThan(60);
    expect(spoke).toBeGreaterThan(10);
  });

  it("reaches the voice-control triggers: fastO, a held judge, a muted speculative start", () => {
    const calls = fc.sample(arbCall, { numRuns: 300, seed: 11 }).map((s) => runCall(s));
    const fastO = calls.filter((d) => d.trace.steps.some((x) => x.after.pending?.permit.kind === "fastO")).length;
    const held = calls.filter((d) => d.trace.steps.some((x) => x.before.judge !== null && x.after.judge === null && x.after.phase === "HELD")).length;
    const muted = calls.filter((d) => d.trace.steps.some((x) => x.after.spec?.mutedStarted === true)).length;
    expect(fastO).toBeGreaterThan(10);
    expect(held).toBeGreaterThan(10);
    expect(muted).toBeGreaterThan(10);
  });
});
