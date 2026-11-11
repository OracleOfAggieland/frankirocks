// Transitions of call setup (brief 014, A3): CLOSED, CONNECTING, CONFIGURING and the way into LISTENING. Titles
// read `<FROM> + <event> -> <TO> (<why>)`, so `vitest -t "CONFIGURING +"` lists every exit from a state. A case
// written `it.fails` is today's behaviour against the rule in its title; its fix removes `.fails`.
import { describe, expect, it } from "vitest";
import { ACK_LIMIT_MS, CONNECT_LIMIT_MS, OPEN_LIMIT_MS, type VoiceCommand } from "./machine";
import { type WideAction, WideDriver } from "./testing/arb-call-wide";

const play = (d: WideDriver, action: WideAction, dt = 0) => {
  const before = d.trace.steps.length;
  d.play({ action, dt });
  return d.trace.steps.slice(before).flatMap((x) => x.commands);
};
const kinds = (cmds: VoiceCommand[]) => cmds.map((c) => c.kind);

/** A call brought to LISTENING through its own setup steps. */
function live(d = new WideDriver().start()): WideDriver {
  play(d, { k: "openOk" }, 300);
  play(d, { k: "channelOpen" }, 300);
  play(d, { k: "stateOk", variant: "fresh" }, 100);
  expect(d.st.phase).toBe("LISTENING");
  return d;
}

describe("call setup transitions", () => {
  it("CLOSED + callPressed -> CONNECTING (one open request, the open wait armed)", () => {
    const d = new WideDriver();
    const cmds = d.ev({ type: "callPressed", zone: "UTC" });
    expect(d.st.phase).toBe("CONNECTING");
    expect(kinds(cmds)).toEqual(["open", "armTimer"]);
    expect(d.st.deadlines.openWait).toBe(d.now + OPEN_LIMIT_MS);
  });

  it("CONNECTING + openOk -> CONNECTING (connect sent; the connect limit counts from the answer)", () => {
    const d = new WideDriver().start();
    const cmds = play(d, { k: "openOk" }, 400);
    expect(d.st.phase).toBe("CONNECTING");
    expect(cmds[0]).toMatchObject({ kind: "connect", sessionId: d.sessions[0] });
    expect(d.st.deadlines.connect).toBe(d.now + CONNECT_LIMIT_MS);
    expect(d.st.deadlines.openWait).toBeUndefined();
  });

  it("CONNECTING + openFailed -> CLOSED (error open, Call shown again)", () => {
    const d = new WideDriver().start();
    play(d, { k: "openFailed" }, 400);
    expect(d.st).toMatchObject({ phase: "CLOSED", error: "open", awaitingOpen: false });
  });

  it("CONNECTING + channelOpen -> CONFIGURING (session.update, one state request, the ack limit armed)", () => {
    const d = new WideDriver().start();
    play(d, { k: "openOk" }, 300);
    const cmds = play(d, { k: "channelOpen" }, 300);
    expect(d.st.phase).toBe("CONFIGURING");
    expect(cmds.filter((c) => c.kind === "state")).toHaveLength(1);
    expect(d.st.deadlines.ack).toBe(d.now + ACK_LIMIT_MS);
    expect(d.st.deadlines.connect).toBeUndefined();
  });

  it("CONFIGURING + stateOk (fresh, matching ack) -> LISTENING (the poll starts)", () => {
    const d = live();
    expect(d.st.deadlines.poll).toBeDefined();
    expect(d.st.deadlines.ack).toBeUndefined();
  });

  it("CONFIGURING + timer ack -> RECOVERY (no ack within 1.5 s of session.update)", () => {
    const d = new WideDriver().start();
    play(d, { k: "openOk" }, 300);
    play(d, { k: "channelOpen" }, 300);
    play(d, { k: "fire", name: "ack" });
    expect(d.st.phase).toBe("RECOVERY");
    expect(d.st.recovery?.kind).toBe("connection");
  });

  it.fails("CONFIGURING + stateOk (ack dropped by an earlier Session's turn answer) -> asks once more -> LISTENING", () => {
    // Session A posts a typed line; the Owner hangs up and calls again at once; A's answer lands while B waits
    // for its first state answer, so B's ack is dropped as older than the last turn answer.
    const d = live();
    play(d, { k: "typed" }, 300);
    const sessionA = d.sessions[0]!;
    expect(d.pending.posts.at(-1)?.body.sessionId).toBe(sessionA);
    play(d, { k: "hangup" }, 200);
    play(d, { k: "closeDone" }, 150);
    play(d, { k: "callPressed" }, 300);
    play(d, { k: "openOk" }, 300);
    play(d, { k: "channelOpen" }, 300);
    play(d, { k: "turnOk", pick: 0, variant: "ordinary", hashOk: true }, 50);
    const cmds = play(d, { k: "stateOk", variant: "fresh" }, 100);
    expect(d.st.ackDroppedStale).toBe(true);
    // The rule: the machine asks once more rather than wait out the ack limit.
    expect(kinds(cmds), "a second state request in CONFIGURING").toContain("state");
    play(d, { k: "stateOk", variant: "fresh" }, 100);
    expect(d.st.phase).toBe("LISTENING");
    expect(d.st.session?.sessionId).toBe(d.sessions[1]);
  });

  it.fails("CONFIGURING + stateOk (ack dropped by a turn answer from before the reconnect) -> asks once more -> LISTENING", () => {
    const d = live();
    play(d, { k: "typed" }, 300);
    play(d, { k: "connectionLost" }, 300);
    play(d, { k: "fire", name: "reconnect" });
    play(d, { k: "openOk" }, 300);
    play(d, { k: "channelOpen" }, 300);
    play(d, { k: "turnFailed", pick: 0 }, 50);
    play(d, { k: "stateOk", variant: "fresh" }, 100);
    expect(d.st.ackDroppedStale).toBe(true);
    // A second state request, answered fresh, brings the new Session up; the ack limit then does nothing.
    play(d, { k: "stateOk", variant: "fresh" }, 100);
    play(d, { k: "fire", name: "ack" });
    expect(d.st.phase, "the new Session reaches LISTENING, not recovery").toBe("LISTENING");
  });
});
