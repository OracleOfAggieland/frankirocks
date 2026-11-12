// Transitions of a Turn's posts to /api/turn (brief 014, A3): the answer wait, stale resends, holds and
// Superseding_Posts. Titles read `<FROM> + <event> -> <TO> (<why>)`. A case written `it.fails` is today's behaviour
// against the rule in its title; its fix removes `.fails`.
import { describe, expect, it } from "vitest";
import { TURN_RESPONSE_LIMIT_MS, type TimerName, type VoiceCommand } from "./machine";
import { type WideAction, WideDriver } from "./testing/arb-call-wide";

const play = (d: WideDriver, action: WideAction, dt = 0) => {
  const before = d.trace.steps.length;
  d.play({ action, dt });
  return d.trace.steps.slice(before).flatMap((x) => x.commands);
};

/**
 * Lets `ms` pass as a browser would: every armed timer whose deadline falls inside fires at its deadline, earliest
 * first. Returns the time left, for the event that ends the wait.
 */
function wait(d: WideDriver, ms: number): number {
  const until = d.now + ms;
  for (;;) {
    const next = (Object.entries(d.st.deadlines) as [TimerName, number][]).filter(([, at]) => at <= until).sort((a, b) => a[1] - b[1])[0];
    if (next === undefined) return until - d.now;
    d.ev({ type: "timer", name: next[0] }, Math.max(0, next[1] - d.now));
  }
}

/** `action` arrives `ms` from now, after the timers due before it. */
const after = (d: WideDriver, ms: number, action: WideAction) => play(d, action, wait(d, ms));

function live(d = new WideDriver().start()): WideDriver {
  play(d, { k: "openOk" }, 300);
  play(d, { k: "channelOpen" }, 300);
  play(d, { k: "stateOk", variant: "fresh" }, 100);
  expect(d.st.phase).toBe("LISTENING");
  return d;
}

/** Speech up to the judge and the speculative reply. */
function committed(d: WideDriver): void {
  for (const [a, dt] of [
    [{ k: "speechStart" }, 200],
    [{ k: "speechStop" }, 1_400],
    [{ k: "commit" }, 10],
    [{ k: "itemAdded", pick: 0 }, 50],
    [{ k: "created", pick: 1 }, 5],
    [{ k: "created", pick: 0 }, 5],
    [{ k: "hash", pick: 0, ok: true }, 0],
  ] as [WideAction, number][])
    play(d, a, dt);
}

/** A Turn posted `final` (the slow path); returns its turnId. */
function posted(d: WideDriver): string {
  committed(d);
  const cmds = play(d, { k: "transcript", pick: 0, fail: false, empty: false }, 300);
  const post = cmds.find((c) => c.kind === "turn");
  expect(post).toBeDefined();
  return post!.kind === "turn" ? post!.body.turnId : "";
}

/** A fastO reply admitted and playing; returns its turnId. */
function fastOSpeaking(d: WideDriver): string {
  play(d, { k: "fire", name: "poll" }, 100);
  play(d, { k: "stateOk", variant: "fresh" }, 100);
  committed(d);
  play(d, { k: "judgeDone", pick: 0, letter: "O" }, 300);
  play(d, { k: "hash", pick: 0, ok: true });
  play(d, { k: "started", pick: 0 }, 200);
  expect(d.st.active?.permit.kind).toBe("fastO");
  expect(d.st.phase).toBe("SPEAKING");
  return d.st.turn!.turnId;
}

const creates = (cmds: VoiceCommand[]) => cmds.filter((c) => c.kind === "send" && c.event.type === "response.create");
const turnPosts = (cmds: VoiceCommand[]) => cmds.flatMap((c) => (c.kind === "turn" ? [c] : []));

describe("post transitions", () => {
  it("HELD + turnOk ordinary -> HELD (the Permit is sent for checking, then its reply is admitted)", () => {
    const d = live();
    const turnId = posted(d);
    // Past the judge's limit, so the slow path decides and the reply is created fresh.
    const cmds = after(d, 1_500, { k: "turnOk", pick: 0, variant: "ordinary", hashOk: true });
    expect(cmds.some((c) => c.kind === "verifyPermit")).toBe(true);
    expect(d.st.phase).toBe("HELD");
    expect(creates(play(d, { k: "hash", pick: 0, ok: true }))).toHaveLength(1);
    expect(d.st.phase).toBe("HELD");
    expect(d.st.active?.permit.stamp.turnId).toBe(turnId);
  });

  it("HELD + turnOk stale -> HELD (resent once under the answer's revisions, same clientSeq)", () => {
    const d = live();
    posted(d);
    const first = turnPosts(d.trace.steps.flatMap((x) => x.commands)).at(-1)!;
    play(d, { k: "higherDeck" });
    const cmds = after(d, 800, { k: "turnOk", pick: 0, variant: "stale", hashOk: true });
    const resend = turnPosts(cmds);
    expect(resend).toHaveLength(1);
    expect(resend[0]!.body).toMatchObject({ clientSeq: first.body.clientSeq, policyRev: first.body.policyRev + 1 });
  });

  it("HELD + turnOk stale (higher Deck) -> HELD (the resend gets the full answer wait)", () => {
    const d = live();
    posted(d);
    play(d, { k: "higherDeck" });
    after(d, 1_500, { k: "turnOk", pick: 0, variant: "stale", hashOk: true });
    // The resend's answer comes 3 s later: inside the 5 s a post's answer has.
    expect(3_000).toBeLessThan(TURN_RESPONSE_LIMIT_MS);
    const cmds = after(d, 3_000, { k: "turnOk", pick: 0, variant: "ordinary", hashOk: true });
    expect(cmds.some((c) => c.kind === "verifyPermit"), "the resend's Permit is sent for checking").toBe(true);
  });

  it("HELD + turnOk stale (after a poll's higher Deck) -> HELD (a higher Deck never shortens the resend's answer wait)", () => {
    const d = live();
    posted(d);
    play(d, { k: "higherDeck" });
    play(d, { k: "fire", name: "poll" }, 300);
    play(d, { k: "stateOk", variant: "fresh" }, 100);
    after(d, 1_100, { k: "turnOk", pick: 0, variant: "stale", hashOk: true });
    const cmds = after(d, 1_500, { k: "turnOk", pick: 0, variant: "ordinary", hashOk: true });
    expect(cmds.some((c) => c.kind === "verifyPermit"), "the resend's Permit is sent for checking").toBe(true);
  });

  it("HELD + timer permit during the Permit's hash check -> HELD (a Permit inside the answer wait plays)", () => {
    const d = live();
    const turnId = posted(d);
    // The answer at 4.95 s, inside the wait; the wait ends at 5 s; the hash comes back at 5.05 s.
    const asked = after(d, TURN_RESPONSE_LIMIT_MS - 50, { k: "turnOk", pick: 0, variant: "ordinary", hashOk: true });
    expect(asked.some((c) => c.kind === "verifyPermit")).toBe(true);
    play(d, { k: "fire", name: "permit" });
    const cmds = play(d, { k: "hash", pick: 0, ok: true }, 50);
    expect(d.st.active?.permit.stamp.turnId, "the checked Permit's reply is admitted").toBe(turnId);
    expect(creates(cmds)).toHaveLength(1);
  });

  it("SPEAKING + turnOk hold with a retry hint -> SPEAKING (an admitted Turn's post is resent after the hint)", () => {
    const d = live();
    const turnId = fastOSpeaking(d);
    const sent = turnPosts(play(d, { k: "transcript", pick: 0, fail: false, empty: false }, 300));
    expect(sent).toHaveLength(1);
    play(d, { k: "turnOk", pick: 0, variant: "retry", hashOk: true }, 300);
    expect(d.st.deadlines.turnRetry, "a resend is scheduled").toBeDefined();
    const cmds = play(d, { k: "fire", name: "turnRetry" });
    expect(turnPosts(cmds).map((c) => [c.body.turnId, c.body.clientSeq])).toEqual([[turnId, sent[0]!.body.clientSeq]]);
  });

  it("SPEAKING + output stopped before a hold's retry hint -> LISTENING (the admitted Turn's post is still resent, brief 031)", () => {
    const d = live();
    const turnId = fastOSpeaking(d);
    const sent = turnPosts(play(d, { k: "transcript", pick: 0, fail: false, empty: false }, 300));
    expect(sent).toHaveLength(1);
    // Nothing was recorded: hold, retry after 250 ms. The short reply ends first.
    play(d, { k: "turnOk", pick: 0, variant: "retry", hashOk: true }, 100);
    expect(d.st.deadlines.turnRetry).toBeDefined();
    play(d, { k: "stopped" }, 50);
    expect(d.st).toMatchObject({ phase: "LISTENING", turn: null });
    const before = d.trace.steps.length;
    wait(d, 1_000);
    const resent = turnPosts(d.trace.steps.slice(before).flatMap((x) => x.commands));
    expect(resent.map((c) => [c.body.turnId, c.body.clientSeq]), "the post is resent after the hint").toEqual([[turnId, sent[0]!.body.clientSeq]]);
  });

  /** A Turn posted `missing`, answered with the neutral line; then its late transcript sends a Superseding_Post. */
  function superseding(d: WideDriver, lineEnded: boolean): { turnId: string; cmds: VoiceCommand[] } {
    committed(d);
    const missing = turnPosts(play(d, { k: "fire", name: "transcript" }));
    expect(missing[0]?.body.transcriptState).toBe("missing");
    const turnId = missing[0]!.body.turnId;
    play(d, { k: "turnOk", pick: 0, variant: "hold", hashOk: true }, 300);
    play(d, { k: "hash", pick: 0, ok: true });
    if (lineEnded) {
      play(d, { k: "fire", name: "lineDone" });
      expect(d.st.turn).toBeNull();
    } else expect(d.st.turn?.turnId).toBe(turnId);
    const sup = turnPosts(play(d, { k: "transcript", pick: 0, fail: false, empty: false }, 1_000));
    expect(sup).toHaveLength(1);
    expect(sup[0]).toMatchObject({ supersedesTurnId: turnId, body: { transcriptState: "final" } });
    // A revision rises on the server before the Superseding_Post's transaction: it answers `stale`.
    play(d, { k: "higherDeck" });
    const cmds = play(d, { k: "turnOk", pick: 0, variant: "stale", hashOk: true }, 400);
    return { turnId, cmds };
  }

  it("LISTENING + turnOk stale for a Superseding_Post -> LISTENING (resent once as a Superseding_Post, no reconnect)", () => {
    const d = live();
    const { turnId, cmds } = superseding(d, true);
    expect(cmds.some((c) => c.kind === "teardown"), "the call is not torn down").toBe(false);
    const resend = turnPosts(cmds);
    expect(resend).toHaveLength(1);
    expect(resend[0]).toMatchObject({ supersedesTurnId: turnId, body: { transcriptState: "final", policyRev: d.serverDeck.policyRev } });
  });

  it("RECOVERY + turnOk stale for a Superseding_Post -> RECOVERY (the resend is the Superseding_Post, never the missing post)", () => {
    const d = live();
    const { turnId, cmds } = superseding(d, false);
    expect(cmds.some((c) => c.kind === "teardown"), "the call is not torn down").toBe(false);
    const resend = turnPosts(cmds);
    expect(resend).toHaveLength(1);
    expect(resend[0], "the resend is the Superseding_Post").toMatchObject({ supersedesTurnId: turnId, body: { transcriptState: "final" } });
  });
});
