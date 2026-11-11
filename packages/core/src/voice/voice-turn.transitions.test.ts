// Transitions of the voice Turn (brief 014, A3): from commit to post, and every exit that ends a Turn. Titles read
// `<FROM> + <event> -> <TO> (<why>)`. A case written `it.fails` is today's behaviour against the rule in its title;
// its fix removes `.fails`. The rule the red cases share is Property 13's: a Turn whose reply was admitted is
// posted, once, unless the call ended first.
import { describe, expect, it } from "vitest";
import type { VoiceCommand } from "./machine";
import { type Step, type Trace, runCall } from "./testing/arb-call";
import { type WideAction, WideDriver } from "./testing/arb-call-wide";
import { activeTurn, drainAll } from "./testing/trace";

const KEEP_ALIVE = ["poll", "refresh", "stateRetry", "stateRetryUi"] as const;

const play = (d: WideDriver, action: WideAction, dt = 0) => {
  const before = d.trace.steps.length;
  d.play({ action, dt });
  return d.trace.steps.slice(before).flatMap((x) => x.commands);
};

function live(d = new WideDriver().start()): WideDriver {
  play(d, { k: "openOk" }, 300);
  play(d, { k: "channelOpen" }, 300);
  play(d, { k: "stateOk", variant: "fresh" }, 100);
  expect(d.st.phase).toBe("LISTENING");
  return d;
}

/** Speech, commit, the judge says O, the fastO Permit is checked: the speculative reply plays before any transcript. */
function fastOSpeaking(d = live()): WideDriver {
  const steps: [WideAction, number][] = [
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
  ];
  for (const [a, dt] of steps) play(d, a, dt);
  expect(d.st.phase).toBe("SPEAKING");
  expect(d.st.active?.permit.kind).toBe("fastO");
  expect(d.st.turn?.posted).toBeNull();
  return d;
}

/** Every command of the trace, then of every armed timer fired at its deadline (keep-alive polls left out). */
function drainedCommands(trace: Trace): VoiceCommand[] {
  const last = trace.steps.at(-1)!;
  return [...trace.steps.flatMap((x) => x.commands), ...drainAll(last.after, last.now, KEEP_ALIVE).commands];
}

/** The ordinary posts (not Superseding_Posts) of a Turn, by clientSeq. */
const postSeqs = (cmds: VoiceCommand[], turnId: string) => new Set(cmds.flatMap((c) => (c.kind === "turn" && c.body.turnId === turnId && c.supersedesTurnId === undefined ? [c.body.clientSeq] : [])));

/** The Turns whose reply was admitted at some step. */
const admittedTurns = (trace: Trace) => new Set(trace.steps.flatMap((x) => { const t = activeTurn(x.after); return t === null ? [] : [t]; }));

describe("voice Turn transitions", () => {
  it("SPEAKING + output stopped before the transcript -> LISTENING (the admitted Turn is held back, then posted final)", () => {
    const d = fastOSpeaking();
    const turnId = d.st.turn!.turnId;
    play(d, { k: "stopped" }, 1_000);
    expect(d.st.phase).toBe("LISTENING");
    expect(d.st.heldBack?.turnId).toBe(turnId);
    const cmds = play(d, { k: "transcript", pick: 0, fail: false, empty: false }, 300);
    expect(cmds).toContainEqual(expect.objectContaining({ kind: "turn", body: expect.objectContaining({ turnId, transcriptState: "final" }) }));
    expect(d.st.heldBack).toBeNull();
  });

  it("SPEAKING + transcript -> SPEAKING (the admitted Turn is posted final and its reply plays on)", () => {
    const d = fastOSpeaking();
    const turnId = d.st.turn!.turnId;
    play(d, { k: "transcript", pick: 0, fail: false, empty: false }, 300);
    expect(d.st.phase).toBe("SPEAKING");
    expect(postSeqs(drainedCommands(d.trace), turnId).size).toBe(1);
  });

  it("SPEAKING + stateOk (higher Deck) -> HELD (the reply is cut; the unposted Turn stays current)", () => {
    const d = fastOSpeaking();
    const turnId = d.st.turn!.turnId;
    play(d, { k: "higherDeck" });
    play(d, { k: "fire", name: "poll" }, 100);
    play(d, { k: "stateOk", variant: "fresh" }, 100);
    expect(d.st).toMatchObject({ phase: "HELD", active: null, admittedTurnId: turnId, turn: { turnId, posted: null } });
  });

  it.fails("HELD + timer permit -> RECOVERY (an admitted Turn cut by a higher Deck before its transcript is still posted once)", () => {
    const d = fastOSpeaking();
    const turnId = d.st.turn!.turnId;
    play(d, { k: "higherDeck" });
    play(d, { k: "fire", name: "poll" }, 100);
    play(d, { k: "stateOk", variant: "fresh" }, 100);
    play(d, { k: "fire", name: "permit" });
    expect(d.st.phase).toBe("RECOVERY");
    play(d, { k: "transcript", pick: 0, fail: false, empty: false }, 300);
    expect(postSeqs(drainedCommands(d.trace), turnId).size, "posts of the admitted Turn").toBe(1);
  });

  it.fails("RECOVERY + timer lineDone -> LISTENING (an error naming the admitted create keeps its unposted Turn until posted)", () => {
    const d = fastOSpeaking();
    const turnId = d.st.turn!.turnId;
    play(d, { k: "errorActive" }, 100);
    expect(d.st.phase).toBe("RECOVERY");
    play(d, { k: "fire", name: "lineDone" });
    expect(d.st.phase).toBe("LISTENING");
    play(d, { k: "transcript", pick: 0, fail: false, empty: false }, 900);
    expect(postSeqs(drainedCommands(d.trace), turnId).size, "posts of the admitted Turn").toBe(1);
  });

  // Property 13's shrunk counterexample over arbCall, seed 42 (run 18,417 of 20,000). The Turn is admitted under
  // fastO; the poll's higher Deck cuts it; a bare commit grows it; the wait armed by the cut fires before the
  // grown Turn's transcript wait, and drops it.
  const SEED_42: Step[] = [
    { action: { k: "higherDeck" }, dt: 0 },
    { action: { k: "stateOk", variant: "fresh" }, dt: 100 },
    { action: { k: "commit" }, dt: 200 },
    { action: { k: "itemAdded", pick: 0 }, dt: 40 },
    { action: { k: "created", pick: 1 }, dt: 20 },
    { action: { k: "created", pick: 0 }, dt: 5 },
    { action: { k: "started", pick: 0 }, dt: 300 },
    { action: { k: "judgeDone", pick: 0, letter: "O" }, dt: 100 },
    { action: { k: "hash", pick: 0, ok: true }, dt: 0 },
    { action: { k: "hash", pick: 0, ok: true }, dt: 0 },
    { action: { k: "timer", early: false, pick: 0 }, dt: 100 },
    { action: { k: "stateOk", variant: "fresh" }, dt: 100 },
    { action: { k: "commit" }, dt: 200 },
  ];

  it.fails("HELD + commit, then timer permit -> RECOVERY (a once-admitted Turn grown after a cut is still posted once; seed 42)", () => {
    const trace = runCall(SEED_42).trace;
    const admitted = [...admittedTurns(trace)];
    expect(admitted).toHaveLength(1);
    expect(postSeqs(drainedCommands(trace), admitted[0]!).size, "posts of the admitted Turn").toBe(1);
  });

  // Property 13's shrunk counterexample over arbCall, seed 99 (run 3,783 of 20,000). The fastO reply is admitted
  // before its response exists; an error names its create, so the call shows recovery; a commit there starts a new
  // Turn and drops the admitted one.
  const SEED_99: Step[] = [
    { action: { k: "stateOk", variant: "fresh" }, dt: 100 },
    { action: { k: "commit" }, dt: 200 },
    { action: { k: "itemAdded", pick: 0 }, dt: 40 },
    { action: { k: "hash", pick: 0, ok: true }, dt: 0 },
    { action: { k: "created", pick: 1 }, dt: 20 },
    { action: { k: "judgeDone", pick: 0, letter: "O" }, dt: 0 },
    { action: { k: "hash", pick: 0, ok: true }, dt: 0 },
    { action: { k: "error", pick: 0 }, dt: 0 },
    { action: { k: "commit" }, dt: 200 },
  ];

  it.fails("RECOVERY + commit -> WAIT_ITEM (a commit after an error on the admitted create still posts the admitted Turn; seed 99)", () => {
    const trace = runCall(SEED_99).trace;
    const admitted = [...admittedTurns(trace)];
    expect(admitted).toHaveLength(1);
    expect(postSeqs(drainedCommands(trace), admitted[0]!).size, "posts of the admitted Turn").toBe(1);
  });
});
