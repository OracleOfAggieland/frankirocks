/**
 * The wide call generator and its driver (brief 014, A3). Plain module, test-only. `arbCall` and the nine
 * properties over it are left as they are; new properties use this one.
 *
 * What it adds to `arbCall`, as the server and the browser really behave:
 *   - The call starts at `callPressed`. Opening, connecting and configuring are generated steps (`openOk`,
 *     `openFailed`, `channelOpen`, `sdpFailed`, the state answer), with a gap of other events before the first
 *     `stateOk`, so CONFIGURING is a state the call can be in, not a step it skips.
 *   - Every open answers a new `sessionId` and a Deck whose `bundleRev` is one higher, as `routes/open.ts` does.
 *     The generation stays 1: the open route always issues generation 1.
 *   - Answers outlive their Session: a post or a state request sent before a reconnect or a hang-up can be
 *     answered in the next Session, stamped with its own Session, as the Voice_Client dispatches them.
 *   - The Owner's controls: `mutePressed`, `retryPressed`, hang-up and Call again.
 *   - Scenes that reach the narrow orderings: a higher Deck between admission and the transcript, on a stale turn
 *     answer, and on a poll while a fastO reply plays; an equal-revision Deck whose safe turns differ; an `error`
 *     naming the admitted reply's create; holds with a retry hint on an admitted Turn; a stale answer to a
 *     Superseding_Post; a Permit whose wait ends during its hash check; and "Try again" pressed in recovery.
 *
 * `wideReach(trace)` names the situations a call reached; the self-test counts them over a fixed sample and fails
 * below a floor, so the generator can't silently stop reaching them.
 */
import fc from "fast-check";
import { tsFromMs } from "../../schema/primitives";
import type { Deck, SafeTurn, Stamp } from "../../schema/wire";
import { type TimerName, type TurnBody, type VoiceState, isHigher } from "../machine";
import { type Action, CallDriver, type Step, type Trace, type TurnVariant, type StateVariant, arbScene, arbStep, deckAt } from "./arb-call";
import { stableJSON } from "./golden";

// ---------------------------------------------------------------------------------------------
// Actions

export type WideAction =
  | Action
  | { k: "openOk" }
  | { k: "openFailed" }
  | { k: "channelOpen" }
  | { k: "sdpFailed" }
  | { k: "mutePressed" }
  | { k: "retryPressed" }
  | { k: "hangup" }
  | { k: "callPressed" }
  | { k: "closeDone" }
  /**
   * Fires the named timer at its deadline (or `dt` from now, if later), if it is armed. Timers due earlier are not
   * fired first: a `fire` can jump past them, and they are then overdue. Tests that need a browser's order let time
   * pass with every due timer fired, earliest first.
   */
  | { k: "fire"; name: TimerName }
  /** The server's safe turns change at equal revisions (a turn committed); the next answer carries them. */
  | { k: "deckTurns" }
  /** Realtime refuses the admitted reply's `response.create` (an `error` naming its event_id). */
  | { k: "errorActive" }
  /** A typed line, from LISTENING. */
  | { k: "typed" };

export interface WideStep {
  action: WideAction;
  dt: number;
}

const s = (action: WideAction, dt = 0): WideStep => ({ action, dt });

// ---------------------------------------------------------------------------------------------
// The driver

const ZONE = "UTC";

/** A driver whose Sessions change at every open and whose answers name the Session they were asked in. */
export class WideDriver extends CallDriver {
  /** Every sessionId an open answered, in order. */
  sessions: string[] = [];
  /** Open requests the machine sent and no answer has met yet. */
  opensWaiting = 0;
  /** State requests with no answer yet, oldest first, each with the Session it was sent in. */
  states: { sentAt: number; sessionId: string }[] = [];
  /** The server's safe turns; they change with `deckTurns` at equal revisions. */
  serverTurns: SafeTurn[] = [];
  private seen = 0;
  private turnsVersion = 0;

  /** The server's current Deck, issued at `at`. */
  deckNow(at: number, revs: Partial<Deck> = {}): Deck {
    const d = this.serverDeck;
    return deckAt(at, { epoch: d.epoch, policyRev: d.policyRev, bundleRev: d.bundleRev, rulesRev: d.rulesRev, turns: this.serverTurns, ...revs });
  }

  private ackFor(sessionId: string, d: Deck, at: number, policyBump = 0) {
    return {
      stamp: { sessionId, epoch: d.epoch, policyRev: d.policyRev + policyBump, bundleRev: d.bundleRev, rulesRev: d.rulesRev, generation: d.generation },
      issuedOpsAt: tsFromMs(at),
      expiresOpsAt: tsFromMs(at + 2_500),
    };
  }

  /** Reads the commands of steps not seen yet: opens and state requests become things the world can answer. */
  private sync(): void {
    for (const st of this.trace.steps.slice(this.seen)) {
      for (const c of st.commands) {
        if (c.kind === "open") this.opensWaiting += 1;
        else if (c.kind === "state") this.states.push({ sentAt: st.now, sessionId: c.body.sessionId });
      }
    }
    this.seen = this.trace.steps.length;
    // The base driver's own open and state bookkeeping is not used: opens are answered only by generated steps.
    this.pending.open = false;
    this.pending.states = [];
  }

  /** The call starts at `callPressed`; everything after it is generated. */
  override start(): this {
    this.ev({ type: "callPressed", zone: ZONE });
    this.sync();
    return this;
  }

  /** Not used: a wide call connects only through its generated steps. */
  override connect(): void {
    this.sync();
  }

  /** A stale answer carries the server's current revisions, as `routes/turn.ts` does. */
  override turnResponse(body: TurnBody, variant: TurnVariant, hashOk: boolean) {
    const r = super.turnResponse(body, variant, hashOk);
    if (r.status !== "stale") return r;
    const d = this.serverDeck;
    const stamp: Stamp = { sessionId: body.sessionId, epoch: d.epoch, policyRev: d.policyRev, bundleRev: d.bundleRev, rulesRev: d.rulesRev, generation: d.generation, turnId: body.turnId };
    return { ...r, stamp };
  }

  override play(step: Step | WideStep): void {
    this.sync();
    const a = step.action as WideAction;
    const dt = step.dt;
    switch (a.k) {
      case "openOk": {
        if (this.opensWaiting === 0) return;
        this.opensWaiting -= 1;
        const at = this.now + dt;
        const sessionId = this.fresh("s");
        this.sessions.push(sessionId);
        this.serverDeck = this.deckNow(at, { bundleRev: this.serverDeck.bundleRev + 1 });
        const deck = this.serverDeck;
        this.ev({ type: "openOk", response: { sessionId, generation: 1, deck, state: "connecting", ack: this.ackFor(sessionId, deck, at), proactive: null } }, dt);
        break;
      }
      case "openFailed":
        if (this.opensWaiting === 0) return;
        this.opensWaiting -= 1;
        this.ev({ type: "openFailed" }, dt);
        break;
      case "channelOpen":
        this.ev({ type: "channelOpen" }, dt);
        break;
      case "sdpFailed":
        this.ev({ type: "sdpFailed" }, dt);
        break;
      case "mutePressed":
        this.ev({ type: "mutePressed" }, dt);
        break;
      case "retryPressed":
        this.ev({ type: "retryPressed" }, dt);
        break;
      case "hangup":
        this.ev({ type: "hangupPressed" }, dt);
        break;
      case "callPressed":
        this.ev({ type: "callPressed", zone: ZONE }, dt);
        break;
      case "closeDone":
        this.ev({ type: "closeDone" }, dt);
        break;
      case "fire": {
        const at = this.st.deadlines[a.name];
        if (at === undefined) return;
        // At its deadline, or `dt` from now if that is later.
        this.ev({ type: "timer", name: a.name }, Math.max(dt, at - this.now));
        break;
      }
      case "deckTurns": {
        this.turnsVersion += 1;
        const n = this.turnsVersion % 3;
        this.serverTurns = Array.from({ length: n }, (_, i) => ({
          turnId: `w${String(this.turnsVersion * 10 + i).padStart(42, "0")}`,
          role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
          text: `earlier line ${this.turnsVersion}.${i}`,
          sens: "S0" as const,
          rootKeys: [],
          dependsOn: [],
          policyRev: this.serverDeck.policyRev,
        }));
        this.serverDeck = this.deckNow(this.now);
        return;
      }
      case "errorActive": {
        const id = this.st.active?.eventId;
        if (id === undefined || id === null) return;
        this.rt({ type: "error", error: { type: "invalid_request_error", code: "conversation_already_has_active_response", event_id: id } }, dt);
        break;
      }
      case "typed":
        if (this.st.phase !== "LISTENING") return;
        this.ev({ type: "typedSubmitted", turnId: this.fresh("t"), text: "Remind me about the dentist" }, dt);
        break;
      case "stateOk": {
        const q = this.states.shift();
        if (q === undefined) return;
        const at = this.now + dt;
        const d = this.deckNow(at);
        this.serverDeck = d;
        const ack = a.variant === "null" ? null : a.variant === "stale" ? this.ackFor(q.sessionId, d, at - 3_000) : a.variant === "mismatch" ? this.ackFor(q.sessionId, d, at, 1) : this.ackFor(q.sessionId, d, at);
        const stamp = { sessionId: q.sessionId, epoch: d.epoch, policyRev: d.policyRev, bundleRev: d.bundleRev, rulesRev: d.rulesRev, generation: d.generation };
        this.ev({ type: "stateOk", response: { stamp, state: "LISTENING", deck: d, ack, barrierReceiptId: null, proactive: null }, sentAt: q.sentAt }, dt);
        break;
      }
      case "stateFailed":
        if (this.states.shift() === undefined) return;
        this.ev({ type: "stateFailed" }, dt);
        break;
      case "higherDeck":
        // A revision rises on the server (a late hit, a repair); answers from now on carry it.
        this.serverDeck = this.deckNow(this.now, { policyRev: this.serverDeck.policyRev + 1 });
        return;
      default:
        super.play(step as Step);
    }
    this.sync();
  }
}

/** Plays a whole wide call and returns its driver. */
export function runWideCall(steps: readonly WideStep[]): WideDriver {
  const d = new WideDriver().start();
  for (const st of steps) d.play(st);
  return d;
}

// ---------------------------------------------------------------------------------------------
// Scenes

const stateVariant = fc.constantFrom<StateVariant>("fresh", "fresh", "fresh", "fresh", "fresh", "fresh", "stale", "null", "mismatch");

/** Steps that may come between the channel opening and the first state answer, or anywhere else. */
const arbGapStep: fc.Arbitrary<WideStep> = fc.oneof(
  { weight: 3, arbitrary: fc.record({ action: fc.record({ k: fc.constant("turnOk" as const), pick: fc.nat({ max: 3 }), variant: fc.constantFrom<TurnVariant>("ordinary", "hold", "retry", "stale", "error"), hashOk: fc.constant(true) }), dt: fc.integer({ min: 0, max: 300 }) }) },
  { weight: 2, arbitrary: fc.record({ action: fc.record({ k: fc.constant("turnFailed" as const), pick: fc.nat({ max: 3 }) }), dt: fc.integer({ min: 0, max: 300 }) }) },
  { weight: 1, arbitrary: fc.constant(s({ k: "mutePressed" }, 50)) },
  { weight: 1, arbitrary: fc.constant(s({ k: "timer", early: false, pick: 0 })) },
  { weight: 1, arbitrary: fc.constant(s({ k: "retryPressed" }, 100)) },
  { weight: 1, arbitrary: fc.constant(s({ k: "stateFailed" }, 200)) },
);

/** A gap step during setup: late answers, a press; not the state failure or timer that would end setup early. */
const arbSetupGapStep: fc.Arbitrary<WideStep> = fc.oneof(
  { weight: 3, arbitrary: arbGapStep.filter((x) => x.action.k === "turnOk" || x.action.k === "turnFailed") },
  { weight: 1, arbitrary: fc.constant(s({ k: "mutePressed" }, 50)) },
  { weight: 1, arbitrary: fc.constant(s({ k: "retryPressed" }, 100)) },
);

/** Open, connect and configure, with a gap before the state answer and the odd failure on the way. */
const arbSetup: fc.Arbitrary<WideStep[]> = fc
  .record({
    open: fc.constantFrom("ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "failed"),
    openMs: fc.integer({ min: 50, max: 900 }),
    channel: fc.constantFrom("open", "open", "open", "open", "open", "open", "open", "open", "sdpFailed", "none"),
    channelMs: fc.integer({ min: 50, max: 700 }),
    gap: fc.array(arbSetupGapStep, { maxLength: 3 }),
    state: stateVariant,
    stateMs: fc.integer({ min: 20, max: 1_800 }),
    after: fc.constantFrom("none", "none", "none", "ack", "timer"),
  })
  .map(({ open, openMs, channel, channelMs, gap, state, stateMs, after }) => {
    const out: WideStep[] = [s(open === "ok" ? { k: "openOk" } : { k: "openFailed" }, openMs)];
    if (channel === "open") out.push(s({ k: "channelOpen" }, channelMs));
    else if (channel === "sdpFailed") out.push(s({ k: "sdpFailed" }, channelMs));
    out.push(...gap, s({ k: "stateOk", variant: state }, stateMs));
    if (after === "ack") out.push(s({ k: "fire", name: "ack" }));
    else if (after === "timer") out.push(s({ k: "timer", early: false, pick: 0 }));
    return out;
  });

/** Whatever brings a dropped call back: the reconnect timer, or a hang-up and Call again; then setup. */
const arbComeBack: fc.Arbitrary<WideStep[]> = fc.tuple(fc.constantFrom("reconnect", "reconnect", "redial", "retry"), arbSetup).map(([how, setup]) => {
  const head: WideStep[] =
    how === "reconnect" ? [s({ k: "fire", name: "reconnect" })] : how === "retry" ? [s({ k: "fire", name: "retryUi" }), s({ k: "retryPressed" }, 200)] : [s({ k: "hangup" }, 300), s({ k: "closeDone" }, 150), s({ k: "callPressed" }, 400)];
  return [...head, ...setup];
});

/** A spoken Turn up to the judge and the speculative reply, with a fresh ack just before the commit. */
function judged(fragments: number): WideStep[] {
  const out: WideStep[] = [];
  for (let f = 0; f < fragments; f++) {
    out.push(s({ k: "speechStart" }, 200), s({ k: "speechStop" }, 900));
    if (f === fragments - 1) out.push(s({ k: "fire", name: "poll" }), s({ k: "stateOk", variant: "fresh" }, 100));
    out.push(s({ k: "commit" }, 200), s({ k: "itemAdded", pick: 0 }, 40));
  }
  // created(judge), created(spec), the spec's hash.
  out.push(s({ k: "created", pick: 1 }, 20), s({ k: "created", pick: 0 }, 5), s({ k: "hash", pick: 0, ok: true }));
  return out;
}

/** A Turn admitted under fastO before its transcript, then what happens to it. */
const arbFastOScene: fc.Arbitrary<WideStep[]> = fc
  .record({
    mutedFirst: fc.boolean(),
    judgeMs: fc.integer({ min: 100, max: 900 }),
    then: fc.constantFrom("pollHigher", "pollHigher", "staleHigher", "error", "hold", "deckTurns", "plain"),
    permitFirst: fc.boolean(),
    asrMs: fc.integer({ min: 0, max: 3_500 }),
    answerMs: fc.integer({ min: 100, max: 3_500 }),
  })
  .map(({ mutedFirst, judgeMs, then, permitFirst, asrMs, answerMs }) => {
    const out = judged(1);
    if (mutedFirst) out.push(s({ k: "started", pick: 0 }, 150));
    // The judge says O; the fastO Permit is checked and admitted; its audio starts.
    out.push(s({ k: "judgeDone", pick: 0, letter: "O" }, judgeMs), s({ k: "hash", pick: 0, ok: true }));
    if (mutedFirst) out.push(s({ k: "created", pick: 0 }, 30));
    out.push(s({ k: "started", pick: 0 }, 200));
    const transcript = s({ k: "transcript", pick: 0, fail: false, empty: false }, asrMs);
    switch (then) {
      case "pollHigher":
        out.push(s({ k: "higherDeck" }), s({ k: "fire", name: "poll" }), s({ k: "stateOk", variant: "fresh" }, 100));
        if (permitFirst) out.push(s({ k: "fire", name: "permit" }));
        out.push(transcript, s({ k: "turnOk", pick: 0, variant: "ordinary", hashOk: true }, answerMs));
        break;
      case "staleHigher":
        out.push(transcript, s({ k: "higherDeck" }), s({ k: "turnOk", pick: 0, variant: "stale", hashOk: true }, 300), s({ k: "turnOk", pick: 0, variant: "ordinary", hashOk: true }, answerMs));
        break;
      case "error":
        out.push(s({ k: "errorActive" }, 100));
        if (permitFirst) out.push(s({ k: "fire", name: "lineDone" }));
        out.push(transcript, s({ k: "turnOk", pick: 0, variant: "ordinary", hashOk: true }, answerMs));
        break;
      case "hold":
        out.push(transcript, s({ k: "turnOk", pick: 0, variant: "retry", hashOk: true }, answerMs), s({ k: "fire", name: "turnRetry" }), s({ k: "turnOk", pick: 0, variant: "ordinary", hashOk: true }, 400));
        break;
      case "deckTurns":
        out.push(transcript, s({ k: "deckTurns" }), s({ k: "fire", name: "poll" }, 20), s({ k: "stateOk", variant: "fresh" }, 100), s({ k: "turnOk", pick: 0, variant: "ordinary", hashOk: true }, answerMs));
        break;
      case "plain":
        out.push(transcript, s({ k: "turnOk", pick: 0, variant: "ordinary", hashOk: true }, answerMs));
        break;
    }
    out.push(s({ k: "stopped" }, 1_200), s({ k: "done", pick: 0 }), s({ k: "timer", early: false, pick: 0 }));
    return out;
  });

/** A slow-path Turn: the transcript, the post, a server answer, and the orderings around its check. */
const arbSlowScene: fc.Arbitrary<WideStep[]> = fc
  .record({
    then: fc.constantFrom("edgePermit", "staleHigher", "pollThenStale", "deckTurnsInCheck", "holdRetry"),
    answerMs: fc.integer({ min: 100, max: 4_999 }),
    resendMs: fc.integer({ min: 200, max: 4_000 }),
  })
  .map(({ then, answerMs, resendMs }) => {
    const out: WideStep[] = [s({ k: "speechStart" }, 200), s({ k: "speechStop" }, 900), s({ k: "commit" }, 200), s({ k: "itemAdded", pick: 0 }, 40), s({ k: "transcript", pick: 0, fail: false, empty: false }, 300)];
    switch (then) {
      case "edgePermit":
        // The answer lands just inside the 5 s wait; the wait ends before its hash comes back.
        out.push(s({ k: "turnOk", pick: 0, variant: "ordinary", hashOk: true }, Math.max(4_900, answerMs)), s({ k: "fire", name: "permit" }), s({ k: "hash", pick: 0, ok: true }));
        break;
      case "staleHigher":
        out.push(s({ k: "higherDeck" }), s({ k: "turnOk", pick: 0, variant: "stale", hashOk: true }, answerMs % 2_000), s({ k: "fire", name: "permit" }, 0), s({ k: "turnOk", pick: 0, variant: "ordinary", hashOk: true }, resendMs));
        break;
      case "pollThenStale":
        out.push(s({ k: "higherDeck" }), s({ k: "fire", name: "poll" }), s({ k: "stateOk", variant: "fresh" }, 150), s({ k: "turnOk", pick: 0, variant: "stale", hashOk: true }, answerMs % 2_000), s({ k: "turnOk", pick: 0, variant: "ordinary", hashOk: true }, resendMs));
        break;
      case "deckTurnsInCheck":
        out.push(s({ k: "turnOk", pick: 0, variant: "ordinary", hashOk: true }, answerMs % 2_000), s({ k: "deckTurns" }), s({ k: "fire", name: "poll" }, 20), s({ k: "stateOk", variant: "fresh" }, 50), s({ k: "hash", pick: 0, ok: true }), s({ k: "created", pick: 0 }, 20));
        break;
      case "holdRetry":
        out.push(s({ k: "turnOk", pick: 0, variant: "retry", hashOk: true }, answerMs % 2_000), s({ k: "fire", name: "turnRetry" }), s({ k: "turnOk", pick: 0, variant: "ordinary", hashOk: true }, 400));
        break;
    }
    out.push(s({ k: "hash", pick: 0, ok: true }), s({ k: "created", pick: 0 }, 30), s({ k: "started", pick: 0 }, 300), s({ k: "stopped" }, 1_500), s({ k: "done", pick: 0 }));
    return out;
  });

/** A Turn whose transcript is late: posted `missing`, then its Superseding_Post and the answer to it. */
const arbSupersedeScene: fc.Arbitrary<WideStep[]> = fc
  .record({
    lineEnds: fc.boolean(),
    higher: fc.boolean(),
    answer: fc.constantFrom<TurnVariant>("stale", "stale", "ordinary", "retry"),
    lateMs: fc.integer({ min: 100, max: 6_000 }),
  })
  .map(({ lineEnds, higher, answer, lateMs }) => {
    const out: WideStep[] = [s({ k: "speechStart" }, 200), s({ k: "speechStop" }, 900), s({ k: "commit" }, 200), s({ k: "itemAdded", pick: 0 }, 40), s({ k: "fire", name: "transcript" })];
    // The `missing` post's answer: the neutral line under recoveryOnly.
    out.push(s({ k: "turnOk", pick: 0, variant: "hold", hashOk: true }, 300), s({ k: "hash", pick: 0, ok: true }));
    if (lineEnds) out.push(s({ k: "fire", name: "lineDone" }));
    out.push(s({ k: "transcript", pick: 0, fail: false, empty: false }, lateMs));
    if (higher) out.push(s({ k: "higherDeck" }));
    out.push(s({ k: "turnOk", pick: 0, variant: answer, hashOk: true }, 400), s({ k: "timer", early: false, pick: 0 }));
    return out;
  });

/** The Owner mutes, then the connection drops and comes back. */
const arbMuteScene: fc.Arbitrary<WideStep[]> = fc
  .tuple(fc.constantFrom("lost", "lost", "sdp", "turnFailed", "none"), fc.boolean(), arbComeBack)
  .map(([drop, unmute, back]) => {
    const out: WideStep[] = [s({ k: "mutePressed" }, 300)];
    if (drop === "lost") out.push(s({ k: "connectionLost" }, 500));
    else if (drop === "sdp") out.push(s({ k: "sdpFailed" }, 500));
    else if (drop === "turnFailed") out.push(s({ k: "typed" }, 200), s({ k: "turnFailed", pick: 0 }, 400));
    if (drop !== "none") out.push(...back);
    if (unmute) out.push(s({ k: "mutePressed" }, 300));
    return out;
  });

/** The state route keeps failing for 30 s, the retry control shows, then the connection drops. */
const arbStateOutageScene: fc.Arbitrary<WideStep[]> = fc
  .tuple(fc.integer({ min: 1, max: 3 }), fc.constantFrom("lost", "lost", "turnFailed"), fc.boolean())
  .map(([failures, drop, comeBack]) => {
    const out: WideStep[] = [];
    for (let i = 0; i < failures; i++) out.push(s({ k: "fire", name: i === 0 ? "poll" : "stateRetry" }), s({ k: "stateFailed" }, 300));
    out.push(s({ k: "fire", name: "stateRetryUi" }));
    if (drop === "lost") out.push(s({ k: "connectionLost" }, 400));
    else out.push(s({ k: "typed" }, 200), s({ k: "turnFailed", pick: 0 }, 300));
    out.push(s({ k: "retryPressed" }, 600));
    if (comeBack) out.push(s({ k: "fire", name: "reconnect" }), s({ k: "openOk" }, 300), s({ k: "channelOpen" }, 200), s({ k: "stateOk", variant: "fresh" }, 100));
    return out;
  });

/** A post outlives its Session: sent, then a drop or a hang-up, then answered during the next setup. */
const arbLateAnswerScene: fc.Arbitrary<WideStep[]> = fc
  .record({
    typed: fc.boolean(),
    drop: fc.constantFrom("lost", "hangup"),
    answer: fc.constantFrom("turnOk", "turnOk", "turnFailed"),
    openMs: fc.integer({ min: 100, max: 600 }),
    answerMs: fc.integer({ min: 0, max: 300 }),
    stateMs: fc.integer({ min: 20, max: 400 }),
  })
  .map(({ typed, drop, answer, openMs, answerMs, stateMs }) => {
    const out: WideStep[] = typed
      ? [s({ k: "typed" }, 300)]
      : [s({ k: "speechStart" }, 200), s({ k: "speechStop" }, 900), s({ k: "commit" }, 200), s({ k: "itemAdded", pick: 0 }, 40), s({ k: "transcript", pick: 0, fail: false, empty: false }, 300)];
    out.push(...(drop === "lost" ? [s({ k: "connectionLost" }, 300), s({ k: "fire", name: "reconnect" })] : [s({ k: "hangup" }, 300), s({ k: "closeDone" }, 150), s({ k: "callPressed" }, 300)]));
    out.push(s({ k: "openOk" }, openMs), s({ k: "channelOpen" }, 200));
    out.push(answer === "turnOk" ? s({ k: "turnOk", pick: 0, variant: "ordinary", hashOk: true }, answerMs) : s({ k: "turnFailed", pick: 0 }, answerMs));
    out.push(s({ k: "stateOk", variant: "fresh" }, stateMs), s({ k: "fire", name: "ack" }), s({ k: "fire", name: "reconnect" }), s({ k: "openOk" }, 300), s({ k: "channelOpen" }, 200), s({ k: "stateOk", variant: "fresh" }, 100));
    return out;
  });

/** Noise: any base step, or one of the wide actions, at any time. */
const arbWideNoise: fc.Arbitrary<WideStep[]> = fc.array(
  fc.oneof(
    { weight: 6, arbitrary: arbStep as fc.Arbitrary<WideStep> },
    { weight: 2, arbitrary: arbGapStep },
    {
      weight: 2,
      arbitrary: fc.record({
        action: fc.constantFrom<WideAction>({ k: "openOk" }, { k: "channelOpen" }, { k: "hangup" }, { k: "callPressed" }, { k: "closeDone" }, { k: "deckTurns" }, { k: "errorActive" }, { k: "typed" }, { k: "sdpFailed" }),
        dt: fc.integer({ min: 0, max: 800 }),
      }),
    },
    { weight: 1, arbitrary: fc.record({ action: fc.record({ k: fc.constant("fire" as const), name: fc.constantFrom<TimerName>("permit", "transcript", "lineDone", "reconnect", "ack", "poll", "heldBack", "turnRetry") }), dt: fc.constant(0) }) },
  ),
  { minLength: 1, maxLength: 6 },
);

const arbWideScene: fc.Arbitrary<WideStep[]> = fc.oneof(
  { weight: 3, arbitrary: arbScene as fc.Arbitrary<WideStep[]> },
  { weight: 3, arbitrary: arbFastOScene },
  { weight: 2, arbitrary: arbSlowScene },
  { weight: 2, arbitrary: arbSupersedeScene },
  { weight: 2, arbitrary: arbMuteScene },
  { weight: 1, arbitrary: arbStateOutageScene },
  { weight: 2, arbitrary: arbLateAnswerScene },
  { weight: 2, arbitrary: arbWideNoise },
);

/** A wide call: setup from `callPressed`, then one to four scenes; at most 90 steps. */
export const arbWideCall: fc.Arbitrary<WideStep[]> = fc
  .tuple(arbSetup, fc.array(arbWideScene, { minLength: 1, maxLength: 4 }))
  .map(([setup, scenes]) => [...setup, ...scenes.flat()].slice(0, 90));

// ---------------------------------------------------------------------------------------------
// Reach

export const WIDE_SITUATIONS = [
  "setup: started at callPressed and reached LISTENING through generated steps",
  "reconnect: a later Session with a new sessionId",
  "gap: an event handled in CONFIGURING before its state answer",
  "late answer: a turn or state answer from an earlier Session",
  "late answer in CONFIGURING",
  "mute: the Owner's mutePressed toggled the mic in a call",
  "mute: muted when connection recovery began",
  "higher Deck between admission and the transcript",
  "higher Deck on a stale turn answer",
  "higher Deck on a poll while a fastO reply is admitted",
  "equal-revision Deck with different safe turns",
  "equal-revision Deck with different safe turns while a Permit is being checked",
  "error naming the admitted reply's create",
  "hold with a retry hint",
  "hold with a retry hint for an admitted Turn",
  "stale answer to a Superseding_Post",
  "permit wait ended while a Permit was being checked",
  "retryPressed in connection recovery while only the state-retry flag shows Try again",
] as const;
export type WideSituation = (typeof WIDE_SITUATIONS)[number];

const sameRevs = (a: Deck, b: Deck) => a.epoch === b.epoch && a.policyRev === b.policyRev && a.bundleRev === b.bundleRev && a.rulesRev === b.rulesRev && a.generation === b.generation;
const higher = (next: Deck | null | undefined, held: Deck | null) => next != null && held !== null && isHigher(next, held);

/** The situations one call reached. */
export function wideReach(trace: Trace): Set<WideSituation> {
  const out = new Set<WideSituation>();
  const postSession = new Map<string, string>();
  const lastPostWasSupersede = new Map<string, boolean>();
  const sessions = new Set<string>();
  const first = trace.steps[0];
  if (first?.event.type === "callPressed" && trace.steps.some((x) => x.after.phase === "LISTENING")) out.add(WIDE_SITUATIONS[0]);
  // Whether a state answer was handled since CONFIGURING was entered: a gap is only what comes before it.
  let answeredInConfiguring = false;
  for (const st of trace.steps) {
    const b: VoiceState = st.before;
    const a: VoiceState = st.after;
    const e = st.event;
    if (a.session !== null) sessions.add(a.session.sessionId);
    if (b.phase !== "CONFIGURING") answeredInConfiguring = false;
    // A gap step is a non-timer event (the ack limit firing ends CONFIGURING; it is not a gap).
    else if (e.type === "stateOk") answeredInConfiguring = true;
    else if (e.type !== "timer" && !answeredInConfiguring) out.add(WIDE_SITUATIONS[2]);
    const answerSession = e.type === "turnOk" ? e.response.stamp.sessionId : e.type === "turnFailed" ? postSession.get(e.turnId) : e.type === "stateOk" ? e.response.stamp.sessionId : undefined;
    if (answerSession !== undefined && b.session !== null && answerSession !== b.session.sessionId) {
      out.add(WIDE_SITUATIONS[3]);
      if (b.phase === "CONFIGURING") out.add(WIDE_SITUATIONS[4]);
    }
    if (e.type === "mutePressed" && a.micMuted !== b.micMuted) out.add(WIDE_SITUATIONS[5]);
    if (b.micMuted && a.recovery?.kind === "connection" && b.recovery?.kind !== "connection") out.add(WIDE_SITUATIONS[6]);
    if (higher(a.deck, b.deck) && b.admittedTurnId !== null && b.turn?.turnId === b.admittedTurnId && b.turn.posted === null) out.add(WIDE_SITUATIONS[7]);
    if (e.type === "turnOk" && e.response.status === "stale" && b.session?.sessionId === e.response.stamp.sessionId && higher(e.response.deck, b.deck)) out.add(WIDE_SITUATIONS[8]);
    if (e.type === "stateOk" && b.active?.permit.kind === "fastO" && higher(e.response.deck, b.deck)) out.add(WIDE_SITUATIONS[9]);
    if (a.deck !== null && b.deck !== null && a.deck !== b.deck && sameRevs(a.deck, b.deck) && stableJSON(a.deck.turns) !== stableJSON(b.deck.turns)) {
      out.add(WIDE_SITUATIONS[10]);
      if (b.pending !== null) out.add(WIDE_SITUATIONS[11]);
    }
    if (e.type === "realtime" && e.event.type === "error" && b.active?.eventId != null && e.event.error.event_id === b.active.eventId) out.add(WIDE_SITUATIONS[12]);
    if (e.type === "turnOk" && e.response.status === "hold" && e.response.permit === null && e.response.retryAfterMs > 0) {
      out.add(WIDE_SITUATIONS[13]);
      if (b.admittedTurnId === e.turnId && b.session?.sessionId === e.response.stamp.sessionId) out.add(WIDE_SITUATIONS[14]);
    }
    if (e.type === "turnOk" && e.response.status === "stale" && lastPostWasSupersede.get(e.turnId) === true) out.add(WIDE_SITUATIONS[15]);
    if (e.type === "timer" && e.name === "permit" && b.deadlines.permit !== undefined && b.deadlines.permit <= st.now && b.pending !== null) out.add(WIDE_SITUATIONS[16]);
    if (e.type === "retryPressed" && b.phase === "RECOVERY" && b.recovery?.kind === "connection" && !b.retryVisible && b.stateRetryVisible) out.add(WIDE_SITUATIONS[17]);
    for (const c of st.commands) {
      if (c.kind === "turn") {
        postSession.set(c.body.turnId, c.body.sessionId);
        lastPostWasSupersede.set(c.body.turnId, c.supersedesTurnId !== undefined);
      }
    }
  }
  if (sessions.size >= 2) out.add(WIDE_SITUATIONS[1]);
  return out;
}

/** How many of the calls reached each situation. */
export function reachCounts(traces: readonly Trace[]): Record<WideSituation, number> {
  const counts = Object.fromEntries(WIDE_SITUATIONS.map((x) => [x, 0])) as Record<WideSituation, number>;
  for (const t of traces) for (const x of wideReach(t)) counts[x] += 1;
  return counts;
}
