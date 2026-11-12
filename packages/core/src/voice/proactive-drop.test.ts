// Brief 045, finding 3 (follow-up): every state answer's line has a named end. Property 1's counterexample at seed
// 1243384230: after a poll and a lost connection, a state answer carrying a line was ignored without a word.
import { describe, expect, it } from "vitest";
import { ProactiveDriver } from "./testing/arb-proactive";

describe("a state answer's line that can't play is dropped by name", () => {
  it("after a poll and a lost connection: dropped as session, never checked", () => {
    const d = new ProactiveDriver(false).start();
    d.play({ action: { k: "timer", early: false, pick: 0 }, dt: 0 });
    d.play({ action: { k: "connectionLost" }, dt: 0 });
    d.play({ action: { k: "lineState", variant: "ok" }, dt: 0 });
    const x = d.delivered[0]!;
    const at = d.trace.steps[x.step]!;
    expect(at.commands.some((c) => c.kind === "verifyPermit")).toBe(false);
    expect(at.after.proactiveDropped).toEqual({ turnId: x.p.turnId, reason: "session" });
    expect(d.createsFor(x.p)).toEqual([]);
  });

  const ss = { sessionId: "s".repeat(43), epoch: 1, policyRev: 1, bundleRev: 1, rulesRev: 1, generation: 1 };
  const ackAt = (at: number) => ({ stamp: ss, issuedOpsAt: new Date(at).toISOString(), expiresOpsAt: new Date(at + 2_500).toISOString() });

  it("during setup a state answer's line is dropped as phase, and setup goes on", () => {
    const d = new ProactiveDriver(false);
    d.ev({ type: "callPressed", zone: "UTC" });
    const deck = d.serverDeck;
    d.ev({ type: "openOk", response: { sessionId: "s".repeat(43), generation: 1, deck, state: "connecting", ack: ackAt(d.now + 100), proactive: null } }, 100);
    d.ev({ type: "channelOpen" }, 200);
    const p = d.line(deck, d.now, "ok");
    expect(d.st.phase).toBe("CONFIGURING");
    const at = d.ev({ type: "stateOk", response: { stamp: ss, state: "LISTENING", deck, ack: null, barrierReceiptId: null, proactive: p }, sentAt: d.now }, 50);
    expect(at.some((c) => c.kind === "verifyPermit")).toBe(false);
    expect(d.st.proactiveDropped).toEqual({ turnId: p.turnId, reason: "phase" });
  });
});
