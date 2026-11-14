// Transitions of a forget in a call (brief 048, rulings 3 and 7), played on the forget driver (testing/arb-forget.ts).
// The server answers the forget `blocked`, holds opens behind its barrier, then lets a fresh call through with the
// acknowledgment. Titles read `<FROM> + <event> -> <TO> (<why>)`.
import { describe, expect, it } from "vitest";
import { GONE_LINE, sayExactly } from "./lines";
import { BARRIER_RETRY_MS, BARRIER_WAIT_MS, RETRY_DELAYS_MS, type VoiceCommand, avatarState } from "./machine";
import { type ForgetAction, ForgetDriver } from "./testing/arb-forget";

function rig() {
  const d = new ForgetDriver().start();
  const play = (action: ForgetAction, dt = 0): VoiceCommand[] => {
    const before = d.trace.steps.length;
    d.play({ action, dt });
    return d.trace.steps.slice(before).flatMap((x) => x.commands);
  };
  for (const [a, dt] of [
    [{ k: "openOk" }, 300],
    [{ k: "channelOpen" }, 300],
    [{ k: "stateOk", variant: "fresh" }, 100],
  ] as [ForgetAction, number][])
    play(a, dt);
  expect(d.st.phase).toBe("LISTENING");
  play({ k: "typed" }, 300);
  const forgotten = d.st.session!.sessionId;
  play({ k: "blocked", pick: 0, care: false }, 300);
  expect(d.st.phase).toBe("SWAPPING");
  return { d, play, forgotten, swapAt: d.now };
}

const opens = (cmds: VoiceCommand[]) => cmds.filter((c) => c.kind === "open");

describe("forget transitions", () => {
  it("SWAPPING + openOk blocked -> SWAPPING (the barrier: muted, thinking, the same open again after BARRIER_RETRY_MS)", () => {
    const { d, play, forgotten } = rig();
    play({ k: "barrier" }, 400);
    expect(d.st).toMatchObject({ phase: "SWAPPING", session: null, outputMuted: true, awaitingOpen: false, recovery: null });
    expect(avatarState(d.st)).toBe("thinking");
    expect(d.st.deadlines.barrierRetry).toBe(d.now + BARRIER_RETRY_MS);
    const again = play({ k: "fire", name: "barrierRetry" });
    expect(opens(again)).toEqual([expect.objectContaining({ body: expect.objectContaining({ previousSessionId: forgotten }) })]);
    expect(d.st).toMatchObject({ phase: "SWAPPING", awaitingOpen: true });
  });

  it("SWAPPING + barrierRetry past BARRIER_WAIT_MS -> RECOVERY (no ready fresh call after 5 s: recovery shows, output stays muted, the old call is not resumed)", () => {
    const { d, play, swapAt } = rig();
    for (let i = 0; i < 10 && d.st.phase === "SWAPPING"; i++) {
      play({ k: "barrier" }, 300);
      if (d.st.phase === "SWAPPING") {
        expect(d.now - swapAt).toBeLessThan(BARRIER_WAIT_MS);
        play({ k: "fire", name: "barrierRetry" });
      }
    }
    expect(d.now - swapAt).toBeGreaterThanOrEqual(BARRIER_WAIT_MS);
    expect(d.st).toMatchObject({ phase: "RECOVERY", recovery: { kind: "connection" }, session: null, outputMuted: true });
    expect(avatarState(d.st)).toBe("recovery");
  });

  it("CONNECTING (reconnect) + openOk blocked -> RECOVERY (the attempt is given back: the same delay runs again while the barrier lasts)", () => {
    const { d, play } = rig();
    for (let i = 0; i < 10 && d.st.phase === "SWAPPING"; i++) {
      play({ k: "barrier" }, 300);
      if (d.st.phase === "SWAPPING") play({ k: "fire", name: "barrierRetry" });
    }
    expect(d.st.phase).toBe("RECOVERY");
    for (let i = 0; i < 6; i++) {
      const at = d.st.deadlines.reconnect;
      expect(at).toBeDefined();
      play({ k: "fire", name: "reconnect" });
      expect(d.st.phase).toBe("CONNECTING");
      play({ k: "barrier" }, 200);
      expect(d.st).toMatchObject({ phase: "RECOVERY", recovery: { kind: "connection", attempts: 0 }, outputMuted: true });
      expect(d.st.deadlines.reconnect).toBe(d.now + RETRY_DELAYS_MS[0]);
    }
  });

  it("SWAPPING + openOk with the acknowledgment -> HELD (the fresh call's first words are the acknowledgment, said exactly)", () => {
    const { d, play } = rig();
    play({ k: "barrier" }, 400);
    play({ k: "fire", name: "barrierRetry" });
    const said: VoiceCommand[] = [];
    for (const [a, dt] of [
      [{ k: "openOk" }, 300],
      [{ k: "channelOpen" }, 200],
      [{ k: "stateOk", variant: "fresh" }, 100],
      [{ k: "stateOk", variant: "fresh" }, 50],
      [{ k: "hash", pick: 0, ok: true }, 0],
    ] as [ForgetAction, number][])
      said.push(...play(a, dt));
    const creates = said.flatMap((c) => (c.kind === "send" && c.event.type === "response.create" ? [c.event] : []));
    expect(creates).toHaveLength(1);
    expect((creates[0]!.response as { instructions?: string }).instructions).toBe(sayExactly(GONE_LINE));
  });
});
