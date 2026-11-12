// Transitions of the call swap (voice-control task 47; R14.3 to R14.7, R6.4; questions 81, 86), played on the swap
// driver (testing/arb-swap.ts). Titles read `<FROM> + <event> -> <TO> (<why>)`.
import { describe, expect, it } from "vitest";
import { COMPANY_LINE } from "./lines";
import { SWAP_LIMIT_MS, type VoiceCommand, avatarState, callButton } from "./machine";
import { type SwapAction, SwapDriver } from "./testing/arb-swap";

const sends = (cmds: VoiceCommand[]) => cmds.flatMap((c) => (c.kind === "send" ? [c.event] : []));

function rig() {
  const d = new SwapDriver().start();
  const play = (action: SwapAction, dt = 0): VoiceCommand[] => {
    const before = d.trace.steps.length;
    d.play({ action, dt });
    return d.trace.steps.slice(before).flatMap((x) => x.commands);
  };
  for (const [a, dt] of [
    [{ k: "openOk" }, 300],
    [{ k: "channelOpen" }, 300],
    [{ k: "stateOk", variant: "fresh" }, 100],
  ] as [SwapAction, number][])
    play(a, dt);
  expect(d.st.phase).toBe("LISTENING");
  return { d, play };
}

/** A fastO reply playing for a Turn whose transcript is in and posted. */
function speakingPosted(play: (a: SwapAction, dt?: number) => VoiceCommand[]): void {
  for (const [a, dt] of [
    [{ k: "speechStart" }, 200],
    [{ k: "speechStop" }, 900],
    [{ k: "fire", name: "poll" }, 0],
    [{ k: "stateOk", variant: "fresh" }, 100],
    [{ k: "commit" }, 200],
    [{ k: "itemAdded", pick: 0 }, 40],
    [{ k: "created", pick: 1 }, 20],
    [{ k: "created", pick: 0 }, 5],
    [{ k: "hash", pick: 0, ok: true }, 0],
    [{ k: "judgeDone", pick: 0, letter: "O" }, 300],
    [{ k: "hash", pick: 0, ok: true }, 0],
    [{ k: "started", pick: 0 }, 200],
    [{ k: "transcript", pick: 0, fail: false, empty: false }, 300],
  ] as [SwapAction, number][])
    play(a, dt);
}

describe("call swap transitions", () => {
  it("SPEAKING + turnOk blocked -> SWAPPING (tears down, opens with previousSessionId, posts no close, looks live)", () => {
    const { d, play } = rig();
    speakingPosted(play);
    expect(d.st.phase).toBe("SPEAKING");
    const narrowed = d.st.session!.sessionId;
    const cmds = play({ k: "blocked", pick: 0, care: false }, 300);
    expect(cmds[0]).toEqual({ kind: "muteOutput" });
    expect(cmds.map((c) => c.kind)).toContain("teardown");
    expect(cmds.some((c) => c.kind === "close")).toBe(false);
    expect(cmds).toContainEqual(expect.objectContaining({ kind: "open", body: expect.objectContaining({ previousSessionId: narrowed }) }));
    expect(d.st).toMatchObject({ phase: "SWAPPING", session: null, outputMuted: true, narrowedFrom: narrowed });
    expect(d.st.deadlines.swap).toBe(d.now + SWAP_LIMIT_MS);
    expect(avatarState(d.st)).toBe("thinking");
    expect(callButton(d.st)).toEqual({ form: "hangup", disabled: false });
    // Through the fresh call's setup the avatar stays thinking and the button stays "hang up" (R14.4).
    for (const [a, dt] of [
      [{ k: "openOk" }, 300],
      [{ k: "channelOpen" }, 200],
    ] as [SwapAction, number][]) {
      play(a, dt);
      expect(d.st.phase).toBe("SWAPPING");
      expect(avatarState(d.st)).toBe("thinking");
      expect(callButton(d.st).form).toBe("hangup");
    }
    expect(d.trace.steps.flatMap((x) => x.commands).filter((c) => c.kind === "close")).toHaveLength(0);
  });

  it("SWAPPING + stateOk (ack matches) -> HELD (the swap line from proactive is the first thing played, verbatim)", () => {
    const { d, play } = rig();
    play({ k: "typed" }, 300);
    play({ k: "blocked", pick: 0, care: false }, 300);
    play({ k: "openOk" }, 300);
    expect(d.st.proactive?.whisper.text).toBe(COMPANY_LINE);
    play({ k: "channelOpen" }, 200);
    const atAck = play({ k: "stateOk", variant: "fresh" }, 100);
    expect(atAck.some((c) => c.kind === "verifyPermit")).toBe(true);
    expect(d.st).toMatchObject({ phase: "HELD", proactive: null });
    const created = sends(play({ k: "hash", pick: 0, ok: true })).filter((e) => e.type === "response.create");
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ response: expect.objectContaining({ tools: [], instructions: expect.stringContaining(COMPANY_LINE) }) });
    play({ k: "created", pick: 0 }, 30);
    expect(play({ k: "started", pick: 0 }, 200)[0]).toEqual({ kind: "unmuteOutput" });
    expect(d.st.phase).toBe("SPEAKING");
    play({ k: "stopped" }, 1_500);
    expect(d.st).toMatchObject({ phase: "LISTENING", turn: null });
  });

  it("HELD + turnOk blocked with a care Permit -> HELD, then SWAPPING when the care reply ends (R14.7)", () => {
    const { d, play } = rig();
    play({ k: "typed" }, 300);
    const narrowed = d.st.session!.sessionId;
    const asked = play({ k: "blocked", pick: 0, care: true }, 300);
    expect(asked.some((c) => c.kind === "verifyPermit")).toBe(true);
    expect(d.st).toMatchObject({ phase: "HELD", afterReply: "swap" });
    play({ k: "hash", pick: 0, ok: true });
    play({ k: "created", pick: 0 }, 30);
    play({ k: "started", pick: 0 }, 200);
    expect(d.st).toMatchObject({ phase: "SPEAKING", outputMuted: false });
    const ended = play({ k: "stopped" }, 1_500);
    expect(ended).toContainEqual(expect.objectContaining({ kind: "open", body: expect.objectContaining({ previousSessionId: narrowed }) }));
    expect(ended.some((c) => c.kind === "close")).toBe(false);
    expect(d.st.phase).toBe("SWAPPING");
  });

  /** The care reply after a `blocked` answer, playing; then a second post of the narrowed Session is pending. */
  function careSpeaking(play: (a: SwapAction, dt?: number) => VoiceCommand[], d: SwapDriver, otherTurn: boolean) {
    play({ k: "typed" }, 300);
    const post = d.pending.posts.at(-1)!;
    play({ k: "blocked", pick: 0, care: true }, 300);
    play({ k: "hash", pick: 0, ok: true });
    play({ k: "created", pick: 0 }, 30);
    play({ k: "started", pick: 0 }, 200);
    expect(d.st).toMatchObject({ phase: "SPEAKING", outputMuted: false, afterReply: "swap" });
    const turnId = otherTurn ? d.fresh("t") : post.body.turnId;
    d.pending.posts.push({ ...post, body: { ...post.body, turnId }, answered: false });
    return d.st.active!.responseId;
  }

  it("SPEAKING (care reply) + turnOk blocked again for its Turn -> SPEAKING (a stale resend's answer neither cuts nor restarts it)", () => {
    const { d, play } = rig();
    const care = careSpeaking(play, d, false);
    const cmds = play({ k: "blocked", pick: 0, care: true }, 100);
    expect(cmds, "nothing is cut, muted or checked again").toEqual([]);
    expect(d.st).toMatchObject({ phase: "SPEAKING", outputMuted: false, afterReply: "swap" });
    expect(d.st.active?.responseId).toBe(care);
  });

  it("SPEAKING (care reply) + turnOk blocked for another Turn of the narrowed Session -> SPEAKING (the swap still waits for the care reply)", () => {
    const { d, play } = rig();
    const care = careSpeaking(play, d, true);
    const cmds = play({ k: "blocked", pick: 0, care: false }, 100);
    expect(cmds).toEqual([]);
    expect(d.st).toMatchObject({ phase: "SPEAKING", outputMuted: false, afterReply: "swap" });
    expect(d.st.active?.responseId).toBe(care);
    play({ k: "stopped" }, 1_500);
    expect(d.st.phase).toBe("SWAPPING");
  });

  it("SPEAKING (care reply) + speech_started -> SWAPPING (a barge-in on the care reply swaps at once)", () => {
    const { d, play } = rig();
    play({ k: "typed" }, 300);
    play({ k: "blocked", pick: 0, care: true }, 300);
    play({ k: "hash", pick: 0, ok: true });
    play({ k: "created", pick: 0 }, 30);
    play({ k: "started", pick: 0 }, 200);
    const cut = play({ k: "speechStart" }, 400);
    expect(cut[0]).toEqual({ kind: "muteOutput" });
    expect(cut.map((c) => c.kind)).toContain("teardown");
    expect(d.st.phase).toBe("SWAPPING");
  });

  it("SWAPPING + openFailed -> RECOVERY (connection recovery; the reconnect names the narrowed Session)", () => {
    const { d, play } = rig();
    play({ k: "typed" }, 300);
    const narrowed = d.st.session!.sessionId;
    play({ k: "blocked", pick: 0, care: false }, 300);
    play({ k: "openFailed" }, 400);
    expect(d.st).toMatchObject({ phase: "RECOVERY", recovery: { kind: "connection" } });
    expect(avatarState(d.st)).toBe("recovery");
    const again = play({ k: "fire", name: "reconnect" });
    expect(again).toContainEqual(expect.objectContaining({ kind: "open", body: expect.objectContaining({ previousSessionId: narrowed }) }));
  });

  it("SWAPPING + timer swap -> RECOVERY (a fresh call that never configures; its Session is closed)", () => {
    const { d, play } = rig();
    play({ k: "typed" }, 300);
    play({ k: "blocked", pick: 0, care: false }, 300);
    play({ k: "openOk" }, 300);
    const fresh = d.st.session!.sessionId;
    const cmds = play({ k: "fire", name: "swap" });
    expect(d.st.phase).toBe("RECOVERY");
    expect(cmds).toContainEqual(expect.objectContaining({ kind: "close", body: expect.objectContaining({ sessionId: fresh, reason: "error" }) }));
  });

  it("CONNECTING (reconnect) + turnOk blocked for the lost Session -> SWAPPING (R14.6: the answer decides; the open in flight is never the swap's, brief 031)", () => {
    const { d, play } = rig();
    play({ k: "typed" }, 300);
    const narrowed = d.st.session!.sessionId;
    play({ k: "connectionLost" }, 200);
    expect(d.st.phase).toBe("RECOVERY");
    // The reconnect's open goes out naming the lost Session before the answer comes.
    play({ k: "fire", name: "reconnect" });
    expect(d.st.awaitingOpen).toBe(true);
    const openWait = d.st.deadlines.openWait;
    const cmds = play({ k: "blocked", pick: 0, care: false }, 300);
    expect(d.st).toMatchObject({ phase: "SWAPPING", recovery: null, narrowedFrom: narrowed, awaitingOpen: true, staleOpen: true });
    // One open in flight at a time: the swap's own goes out when the reconnect's answers; that one keeps its wait.
    expect(cmds.some((c) => c.kind === "open")).toBe(false);
    expect(d.st.deadlines.openWait).toBe(openWait);
    expect(avatarState(d.st)).toBe("thinking");
    // The reconnect's open answers: its Session is closed, never connected, and the swap's open follows.
    const stale = play({ k: "openOk" }, 300);
    expect(stale.some((c) => c.kind === "connect")).toBe(false);
    expect(stale.map((c) => c.kind)).toEqual(expect.arrayContaining(["close", "open"]));
    expect(d.st.staleOpen).toBe(false);
    play({ k: "openOk" }, 300);
    play({ k: "channelOpen" }, 200);
    play({ k: "stateOk", variant: "fresh" }, 100);
    expect(d.st.phase).toBe("HELD");
    expect(d.st.pending?.notes[0]?.text).toBe(COMPANY_LINE);
  });

  it("SWAPPING + openOk for the open sent before the blocked answer -> SWAPPING (closed, never adopted; the swap's own open follows)", () => {
    const { d, play } = rig();
    play({ k: "typed" }, 300);
    const narrowed = d.st.session!.sessionId;
    play({ k: "connectionLost" }, 200);
    play({ k: "fire", name: "reconnect" });
    play({ k: "blocked", pick: 0, care: false }, 300);
    expect(d.st.phase).toBe("SWAPPING");
    // The server handled the reconnect's open before it committed the narrowing: a new Session, no swap line.
    const cmds = play({ k: "openEarly" }, 200);
    const early = d.trace.steps.at(-1)!.event;
    expect(early.type).toBe("openOk");
    const earlySession = early.type === "openOk" ? early.response.sessionId : "";
    expect(cmds.some((c) => c.kind === "connect"), "the early open's Session is never connected").toBe(false);
    expect(cmds).toContainEqual(expect.objectContaining({ kind: "close", body: expect.objectContaining({ sessionId: earlySession }) }));
    expect(cmds).toContainEqual(expect.objectContaining({ kind: "open", body: expect.objectContaining({ previousSessionId: narrowed }) }));
    expect(d.st).toMatchObject({ phase: "SWAPPING", session: null, awaitingOpen: true });
    play({ k: "openOk" }, 300);
    play({ k: "channelOpen" }, 200);
    play({ k: "stateOk", variant: "fresh" }, 100);
    expect(d.st.phase).toBe("HELD");
    expect(d.st.pending?.notes[0]?.text).toBe(COMPANY_LINE);
  });

  it("SWAPPING + turnOk blocked for the Session already swapped away from -> SWAPPING (nothing happens)", () => {
    const { d, play } = rig();
    play({ k: "typed" }, 300);
    play({ k: "blocked", pick: 0, care: false }, 300);
    expect(d.st.phase).toBe("SWAPPING");
    // A second post of the narrowed Session (from the pending list) answered blocked too.
    d.pending.posts.push({ ...d.pending.posts.at(-1)!, answered: false });
    play({ k: "blocked", pick: 0, care: false }, 100);
    expect(d.st.phase).toBe("SWAPPING");
    expect(d.trace.steps.at(-1)!.event.type).toBe("turnOk");
    expect(d.trace.steps.at(-1)!.commands).toEqual([]);
  });
});
