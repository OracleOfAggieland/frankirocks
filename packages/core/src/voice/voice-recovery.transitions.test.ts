// Transitions of connection recovery (brief 014, A3): how a live call drops, waits, reconnects and what it keeps.
// Titles read `<FROM> + <event> -> <TO> (<why>)`. A case written `it.fails` is today's behaviour against the rule
// in its title; its fix removes `.fails`.
import { describe, expect, it } from "vitest";
import { RETRY_DELAYS_MS, RETRY_UI_MS, type TimerName, type VoiceCommand, type VoiceState } from "./machine";
import { type WideAction, WideDriver } from "./testing/arb-call-wide";

const play = (d: WideDriver, action: WideAction, dt = 0) => {
  const before = d.trace.steps.length;
  d.play({ action, dt });
  return d.trace.steps.slice(before).flatMap((x) => x.commands);
};

/**
 * Lets time pass up to `until` as a browser would: every armed timer whose deadline falls inside fires at its
 * deadline, earliest first, and an open the machine sends meanwhile gets no answer.
 */
function waitUntil(d: WideDriver, until: number): void {
  for (;;) {
    const next = (Object.entries(d.st.deadlines) as [TimerName, number][]).filter(([, at]) => at <= until).sort((a, b) => a[1] - b[1])[0];
    if (next === undefined) return;
    d.ev({ type: "timer", name: next[0] }, Math.max(0, next[1] - d.now));
  }
}

function live(d = new WideDriver().start()): WideDriver {
  play(d, { k: "openOk" }, 300);
  play(d, { k: "channelOpen" }, 300);
  play(d, { k: "stateOk", variant: "fresh" }, 100);
  expect(d.st.phase).toBe("LISTENING");
  return d;
}

/** What the call screen shows as "Try again" (CallScreen: RECOVERY with retryVisible, or stateRetryVisible). */
const tryAgainShown = (st: VoiceState) => (st.phase === "RECOVERY" && st.retryVisible) || st.stateRetryVisible;

/** A live call whose state requests have failed for 30 s: the state-retry control shows. */
function stateOutage(): WideDriver {
  const d = live();
  play(d, { k: "fire", name: "poll" }, 100);
  play(d, { k: "stateFailed" }, 300);
  // The state retries and polls due before it fire first, unanswered.
  waitUntil(d, d.st.deadlines.stateRetryUi!);
  expect(d.st.stateRetryVisible).toBe(true);
  return d;
}

describe("connection recovery transitions", () => {
  it("LISTENING + connectionLost -> RECOVERY (mute, teardown, close as error, reconnect after 1 s)", () => {
    const d = live();
    const cmds = play(d, { k: "connectionLost" }, 200);
    expect(cmds.slice(0, 2)).toEqual([{ kind: "muteOutput" }, { kind: "teardown" }]);
    expect(cmds).toContainEqual(expect.objectContaining({ kind: "close", body: expect.objectContaining({ reason: "error" }) }));
    expect(d.st).toMatchObject({ phase: "RECOVERY", session: null, recovery: { kind: "connection", attempts: 0 } });
    expect(d.st.deadlines.reconnect).toBe(d.now + RETRY_DELAYS_MS[0]);
    expect(RETRY_DELAYS_MS[0]).toBe(1_000);
  });

  it("RECOVERY + timer reconnect -> CONNECTING (a new open naming the last Session)", () => {
    const d = live();
    play(d, { k: "connectionLost" }, 200);
    const cmds = play(d, { k: "fire", name: "reconnect" });
    expect(d.st.phase).toBe("CONNECTING");
    expect(cmds).toContainEqual(expect.objectContaining({ kind: "open", body: expect.objectContaining({ previousSessionId: d.sessions[0] }) }));
    play(d, { k: "openOk" }, 300);
    play(d, { k: "channelOpen" }, 200);
    play(d, { k: "stateOk", variant: "fresh" }, 100);
    expect(d.st).toMatchObject({ phase: "LISTENING", recovery: null, session: { sessionId: d.sessions[1] } });
  });

  it("RECOVERY + timer retryUi -> RECOVERY (Try again shows at 30 s, and a press reconnects)", () => {
    const d = live();
    play(d, { k: "connectionLost" }, 200);
    const since = d.now;
    waitUntil(d, since + RETRY_UI_MS - 1);
    expect(tryAgainShown(d.st)).toBe(false);
    waitUntil(d, since + RETRY_UI_MS);
    expect(d.trace.steps.filter((x) => x.event.type === "timer" && x.event.name === "retryUi").map((x) => x.now)).toEqual([since + RETRY_UI_MS]);
    expect(RETRY_UI_MS).toBe(30_000);
    expect(d.st.phase).toBe("RECOVERY");
    expect(tryAgainShown(d.st)).toBe(true);
    const cmds = play(d, { k: "retryPressed" }, 100);
    expect(cmds.some((c) => c.kind === "open")).toBe(true);
  });

  it("SPEAKING + connectionLost -> RECOVERY (every reply slot empty)", () => {
    const d = live();
    for (const [a, dt] of [
      [{ k: "speechStart" }, 200],
      [{ k: "speechStop" }, 1_400],
      [{ k: "fire", name: "poll" }, 0],
      [{ k: "stateOk", variant: "fresh" }, 100],
      [{ k: "commit" }, 10],
      [{ k: "itemAdded", pick: 0 }, 50],
      [{ k: "created", pick: 1 }, 5],
      [{ k: "created", pick: 0 }, 5],
      [{ k: "hash", pick: 0, ok: true }, 0],
      [{ k: "judgeDone", pick: 0, letter: "O" }, 300],
      [{ k: "hash", pick: 0, ok: true }, 0],
      [{ k: "started", pick: 0 }, 200],
    ] as [WideAction, number][])
      play(d, a, dt);
    expect(d.st.phase).toBe("SPEAKING");
    expect(d.st.active).not.toBeNull();
    play(d, { k: "connectionLost" }, 300);
    expect(d.st).toMatchObject({ phase: "RECOVERY", recovery: { kind: "connection" }, outputMuted: true, judge: null, spec: null, pending: null, active: null });
  });

  it("RECOVERY + timer reconnect -> CONNECTING (a muted mic stays muted across the reconnect)", () => {
    const d = live();
    play(d, { k: "mutePressed" }, 300);
    expect(d.st.micMuted).toBe(true);
    play(d, { k: "connectionLost" }, 500);
    expect(d.st.micMuted).toBe(true);
    play(d, { k: "fire", name: "reconnect" });
    expect(d.st.micMuted, "micMuted after the reconnect's open").toBe(true);
    play(d, { k: "openOk" }, 300);
    play(d, { k: "channelOpen" }, 200);
    play(d, { k: "stateOk", variant: "fresh" }, 100);
    expect(d.st).toMatchObject({ phase: "LISTENING", micMuted: true });
  });

  it.fails("LISTENING + connectionLost -> RECOVERY (no Try again shows that a press can't act on)", () => {
    const d = stateOutage();
    play(d, { k: "connectionLost" }, 400);
    expect(d.st.phase).toBe("RECOVERY");
    expect(d.st.retryVisible).toBe(false);
    // The rule: whatever Try again the screen shows does something when pressed.
    if (tryAgainShown(d.st)) {
      const before = d.st;
      const cmds: VoiceCommand[] = play(d, { k: "retryPressed" }, 600);
      expect(cmds.length > 0 || d.st !== before, "a shown Try again did nothing when pressed").toBe(true);
    }
  });

  it.fails("HELD + turnFailed -> RECOVERY (connection recovery clears the state-retry control)", () => {
    const d = stateOutage();
    play(d, { k: "typed" }, 200);
    play(d, { k: "turnFailed", pick: 0 }, 300);
    expect(d.st).toMatchObject({ phase: "RECOVERY", recovery: { kind: "connection" }, session: null });
    expect(d.st.stateRetryVisible, "stateRetryVisible after connection recovery").toBe(false);
  });
});
