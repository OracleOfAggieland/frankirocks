import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { WIDE_SITUATIONS, type WideSituation, WideDriver, arbWideCall, reachCounts, runWideCall } from "./arb-call-wide";

/**
 * How many of 1,000 calls (seed 2026) must reach each situation. Set from measured counts with room (about half of
 * the lowest count over seeds 2026, 1 and 99), so a generator edit that stops reaching one fails here.
 */
const FLOORS: Record<WideSituation, number> = {
  "setup: started at callPressed and reached LISTENING through generated steps": 350,
  "reconnect: a later Session with a new sessionId": 190,
  "gap: an event handled in CONFIGURING before its state answer": 210,
  "late answer: a turn or state answer from an earlier Session": 80,
  "late answer in CONFIGURING": 75,
  "mute: the Owner's mutePressed toggled the mic in a call": 70,
  "mute: muted when connection recovery began": 40,
  "higher Deck between admission and the transcript": 25,
  "higher Deck on a stale turn answer": 35,
  "higher Deck on a poll while a fastO reply is admitted": 25,
  "equal-revision Deck with different safe turns": 25,
  "equal-revision Deck with different safe turns while a Permit is being checked": 6,
  "error naming the admitted reply's create": 7,
  "hold with a retry hint": 50,
  "hold with a retry hint for an admitted Turn": 12,
  "stale answer to a Superseding_Post": 30,
  "permit wait ended while a Permit was being checked": 12,
  "retryPressed in connection recovery while only the state-retry flag shows Try again": 25,
};

describe("wide call generator and driver", () => {
  it("300 generated calls replay through step without throwing", () => {
    fc.assert(
      fc.property(arbWideCall, (steps) => {
        expect(runWideCall(steps).trace.steps.length).toBeGreaterThan(0);
      }),
      { numRuns: 300 },
    );
  });

  it("a call starts at callPressed and waits for its open answer", () => {
    const d = new WideDriver().start();
    expect(d.trace.steps.map((x) => x.event.type)).toEqual(["callPressed"]);
    expect(d.st.phase).toBe("CONNECTING");
    expect(d.opensWaiting).toBe(1);
  });

  it("every open answers a new sessionId and a higher bundleRev, at generation 1", () => {
    const d = new WideDriver().start();
    for (const a of [{ k: "openOk" }, { k: "channelOpen" }, { k: "stateOk", variant: "fresh" }, { k: "connectionLost" }, { k: "fire", name: "reconnect" }, { k: "openOk" }] as const) d.play({ action: a, dt: 100 });
    expect(d.sessions).toHaveLength(2);
    expect(new Set(d.sessions).size).toBe(2);
    const opens = d.trace.steps.flatMap((x) => (x.event.type === "openOk" ? [x.event.response] : []));
    expect(opens.map((r) => r.generation)).toEqual([1, 1]);
    expect(opens[1]!.deck!.bundleRev).toBe(opens[0]!.deck!.bundleRev + 1);
    expect(d.st.session?.sessionId).toBe(d.sessions[1]);
  });

  it("reaches each situation at or above its floor over 1,000 samples (seed 2026)", () => {
    const counts = reachCounts(fc.sample(arbWideCall, { seed: 2026, numRuns: 1_000 }).map((s) => runWideCall(s).trace));
    // The counts are printed so a run shows how far above its floor each one is.
    console.log(`wide generator reach over 1,000 calls (seed 2026):\n${WIDE_SITUATIONS.map((x) => `  ${String(counts[x]).padStart(4)}  (floor ${String(FLOORS[x]).padStart(3)})  ${x}`).join("\n")}`);
    for (const x of WIDE_SITUATIONS) expect(counts[x], x).toBeGreaterThanOrEqual(FLOORS[x]);
  });
});
