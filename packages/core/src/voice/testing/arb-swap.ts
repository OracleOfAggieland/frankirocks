/**
 * The call swap's generators and driver (voice-control task 46; R20.1.10, R14.1, R14.5, R14.7). Plain module,
 * test-only. Property 10 states its rule over these; fixing a generator is an ordinary edit.
 *
 * What it adds to the wide driver, as the wave B server is specified to behave (design "The company swap", rows 6
 * and 8, question 81):
 *   - `blocked`: a company or quiet hit answers a pending post `blocked`. The server raises `policyRev` (the
 *     answer's Deck is one higher) and marks the post's Session narrowed. With `care`, the hit also had `crisis`:
 *     the answer carries the care Permit (`postCommitControl`, scope `ack`, no notes, under the new revisions).
 *   - An open that names a narrowed Session as `previousSessionId` answers with the swap line in `proactive`: a
 *     `postCommitControl` Permit over the COMPANY ack note, as `routes/open.ts` will in task 50.
 *
 * `swapCalls(trace)` labels each step with the call it belongs to: call n opens at the n-th `connect` command.
 */
import fc from "fast-check";
import { payloadHash } from "../../admission";
import { tsFromMs } from "../../schema/primitives";
import type { Infer } from "../../schema/v";
import type { Permit, Proactive, Stamp, TurnResponse } from "../../schema/wire";
import { COMPANY_LINE, ackNote } from "../lines";
import type { TurnBody } from "../machine";
import type { Trace } from "./arb-call";
import { type WideAction, WideDriver, type WideStep, arbFastOScene, arbSetup, arbSlowScene, arbWideNoise, judged } from "./arb-call-wide";

export type SwapAction = WideAction | { k: "blocked"; pick: number; care: boolean };

export interface SwapStep {
  action: SwapAction;
  dt: number;
}

const w = (action: SwapAction, dt = 0): SwapStep => ({ action, dt });

/** A wide driver whose server narrows a Session on `blocked` and speaks the swap line on the open after it. */
export class SwapDriver extends WideDriver {
  /** Sessions a `blocked` answer narrowed. */
  narrowed = new Set<string>();
  /** The `previousSessionId` of every open sent and not yet answered, oldest first. */
  private opensPrev: (string | null)[] = [];
  private seenOpens = 0;

  private syncOpens(): void {
    for (const st of this.trace.steps.slice(this.seenOpens)) for (const c of st.commands) if (c.kind === "open") this.opensPrev.push(c.body.previousSessionId);
    this.seenOpens = this.trace.steps.length;
  }

  override start(): this {
    super.start();
    this.syncOpens();
    return this;
  }

  override play(step: SwapStep | WideStep | Parameters<WideDriver["play"]>[0]): void {
    this.sync();
    this.syncOpens();
    const a = step.action as SwapAction;
    if (a.k === "blocked") {
      this.blocked(a.pick, a.care, step.dt);
    } else if (a.k === "openOk" && this.opensWaiting > 0 && this.narrowed.has(this.opensPrev[0] ?? "")) {
      this.opensPrev.shift();
      this.opensWaiting -= 1;
      this.swapOpen(step.dt);
    } else {
      if ((a.k === "openOk" || a.k === "openFailed") && this.opensWaiting > 0) this.opensPrev.shift();
      super.play(step as WideStep);
    }
    this.sync();
    this.syncOpens();
  }

  /** Answers the `pick`-th unanswered post (newest first) `blocked`, with the care Permit when `care`. */
  private blocked(pick: number, care: boolean, dt: number): void {
    const open = this.pending.posts.filter((p) => !p.answered);
    if (open.length === 0) return;
    const p = open[open.length - 1 - (pick % open.length)]!;
    p.answered = true;
    const at = this.now + dt;
    this.narrowed.add(p.body.sessionId);
    this.serverDeck = this.deckNow(at, { policyRev: this.serverDeck.policyRev + 1 });
    const deck = this.serverDeck;
    const body = p.body;
    const stamp: Stamp = { sessionId: body.sessionId, epoch: body.epoch, policyRev: body.policyRev, bundleRev: body.bundleRev, rulesRev: body.rulesRev, generation: body.generation, turnId: body.turnId };
    const response: TurnResponse = {
      requestId: this.fresh("r"),
      stamp,
      status: "blocked",
      deck,
      permit: care ? this.carePermit(body, at) : null,
      notes: [],
      cards: [],
      pendingId: null,
      question: null,
      retryAfterMs: 0,
      receiptId: null,
      error: null,
    };
    this.ev({ type: "turnOk", turnId: body.turnId, response }, dt);
  }

  /** The care reply's Permit (row 6): postCommitControl, scope ack, no notes, under the narrowed Deck's revisions. */
  private carePermit(body: TurnBody, at: number): Permit {
    const d = this.serverDeck;
    const stamp: Stamp = { sessionId: body.sessionId, epoch: d.epoch, policyRev: d.policyRev, bundleRev: d.bundleRev, rulesRev: d.rulesRev, generation: d.generation, turnId: body.turnId };
    const audioIds = [...body.items].sort((x, y) => x.commitSeq - y.commitSeq).map((i) => i.itemId);
    const hash = payloadHash({ stamp, head: d.head, notes: [], turns: d.turns, audioIds, toolOutput: null }, this.hasher);
    return { permitId: this.fresh("p"), stamp, kind: "postCommitControl", scope: "ack", approvedPayloadHash: hash, noteIds: [], momentIds: [], expiresAt: tsFromMs(at + 10_000) };
  }

  /** An open that inherits a narrowed audience: a new Session, and the swap line in `proactive`. */
  private swapOpen(dt: number): void {
    const at = this.now + dt;
    const sessionId = this.fresh("s");
    this.sessions.push(sessionId);
    this.serverDeck = this.deckNow(at, { bundleRev: this.serverDeck.bundleRev + 1 });
    const deck = this.serverDeck;
    const turnId = this.fresh("t");
    const whisper = ackNote(COMPANY_LINE, this.fresh("n"), tsFromMs(at + 10_000));
    const stamp: Stamp = { sessionId, epoch: deck.epoch, policyRev: deck.policyRev, bundleRev: deck.bundleRev, rulesRev: deck.rulesRev, generation: deck.generation, turnId };
    const hash = payloadHash({ stamp, head: deck.head, notes: [whisper], turns: deck.turns, audioIds: [], toolOutput: null }, this.hasher);
    const permit: Permit = { permitId: this.fresh("p"), stamp, kind: "postCommitControl", scope: "ack", approvedPayloadHash: hash, noteIds: [whisper.noteId], momentIds: [], expiresAt: tsFromMs(at + 10_000) };
    const proactive: Infer<typeof Proactive> = { turnId, permit, whisper, cards: [] };
    this.ev({ type: "openOk", response: { sessionId, generation: 1, deck, state: "connecting", ack: this.ackFor(sessionId, deck, at), proactive } }, dt);
  }
}

/** Plays a whole swap call and returns its driver. */
export function runSwapCall(steps: readonly SwapStep[]): SwapDriver {
  const d = new SwapDriver().start();
  for (const st of steps) d.play(st);
  return d;
}

// ---------------------------------------------------------------------------------------------
// Calls

/**
 * The call each step belongs to: 0 before the first `connect`, then n from the step that sent the n-th `connect`.
 * A response belongs to the call of the step at which its `response.created` arrived.
 */
export function swapCalls(trace: Trace): number[] {
  const out: number[] = [];
  let n = 0;
  for (const st of trace.steps) {
    n += st.commands.filter((c) => c.kind === "connect").length;
    out.push(n);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Scenes

/** What leads to the post that is answered `blocked`. */
const arbLead: fc.Arbitrary<SwapStep[]> = fc.constantFrom("fastO", "slow", "typed", "dropped", "droppedBack").map((lead) => {
  const transcript = w({ k: "transcript", pick: 0, fail: false, empty: false }, 300);
  switch (lead) {
    case "fastO":
      // The reply plays under fastO before the transcript; the post goes out while it plays.
      return [...judged(1), w({ k: "judgeDone", pick: 0, letter: "O" }, 300), w({ k: "hash", pick: 0, ok: true }), w({ k: "started", pick: 0 }, 200), transcript];
    case "slow":
      return [...judged(1), w({ k: "judgeDone", pick: 0, letter: "H" }, 300), transcript];
    case "typed":
      return [w({ k: "typed" }, 300)];
    case "dropped":
      // The connection drops while the post is outstanding (R14.6).
      return [...judged(1), transcript, w({ k: "connectionLost" }, 200)];
    case "droppedBack":
      // ... and the reconnect's open goes out before the answer.
      return [w({ k: "typed" }, 300), w({ k: "connectionLost" }, 200), w({ k: "fire", name: "reconnect" })];
    default:
      return [];
  }
});

/** The care reply plays to its end, is interrupted, or never gets that far. */
const arbCare: fc.Arbitrary<SwapStep[]> = fc.constantFrom("ends", "bargeIn", "commit", "hashFails", "none").map((how) => {
  const check = w({ k: "hash", pick: 0, ok: how !== "hashFails" });
  switch (how) {
    case "ends":
      return [check, w({ k: "created", pick: 0 }, 30), w({ k: "started", pick: 0 }, 200), w({ k: "stopped" }, 1_500), w({ k: "done", pick: 0 })];
    case "bargeIn":
      return [check, w({ k: "created", pick: 0 }, 30), w({ k: "started", pick: 0 }, 200), w({ k: "speechStart" }, 600)];
    case "commit":
      return [check, w({ k: "created", pick: 0 }, 30), w({ k: "commit" }, 300)];
    case "hashFails":
      return [check];
    default:
      return [];
  }
});

/** The fresh call: it comes up and speaks the swap line, or the swap fails. */
const arbFresh: fc.Arbitrary<SwapStep[]> = fc
  .record({
    how: fc.constantFrom("up", "up", "up", "openFailed", "swapTimer", "sdpFailed", "lost", "hangup"),
    lineHash: fc.constantFrom(true, true, true, false),
    lineEnds: fc.boolean(),
    openMs: fc.integer({ min: 50, max: 900 }),
  })
  .map(({ how, lineHash, lineEnds, openMs }) => {
    const up = [w({ k: "openOk" }, openMs), w({ k: "channelOpen" }, 200), w({ k: "stateOk", variant: "fresh" }, 100)];
    switch (how) {
      case "up":
        return [
          ...up,
          w({ k: "hash", pick: 0, ok: lineHash }),
          w({ k: "created", pick: 0 }, 30),
          w({ k: "started", pick: 0 }, 200),
          ...(lineEnds ? [w({ k: "stopped" }, 1_500), w({ k: "done", pick: 0 })] : [w({ k: "speechStart" }, 400)]),
        ];
      case "openFailed":
        return [w({ k: "openFailed" }, openMs), w({ k: "fire", name: "reconnect" }), ...up];
      case "swapTimer":
        return [w({ k: "openOk" }, openMs), w({ k: "fire", name: "swap" }), w({ k: "fire", name: "reconnect" }), ...up];
      case "sdpFailed":
        return [w({ k: "openOk" }, openMs), w({ k: "sdpFailed" }, 300), w({ k: "fire", name: "reconnect" }), ...up];
      case "lost":
        return [...up, w({ k: "connectionLost" }, 300), w({ k: "fire", name: "reconnect" }), ...up];
      case "hangup":
        return [w({ k: "hangup" }, 300), w({ k: "closeDone" }, 150), w({ k: "openOk" }, openMs)];
      default:
        return [];
    }
  });

/** One narrowing: a post, its `blocked` answer, the care reply if any, the fresh call; noise anywhere. */
const arbSwapScene: fc.Arbitrary<SwapStep[]> = fc
  .record({
    lead: arbLead,
    care: fc.boolean(),
    answerMs: fc.integer({ min: 50, max: 2_000 }),
    careSteps: arbCare,
    fresh: arbFresh,
    noise: fc.array(fc.tuple(fc.nat({ max: 20 }), arbWideNoise), { maxLength: 2 }),
  })
  .map(({ lead, care, answerMs, careSteps, fresh, noise }) => {
    const out: SwapStep[] = [...lead, w({ k: "blocked", pick: 0, care }, answerMs), ...(care ? careSteps : []), ...fresh];
    for (const [at, n] of noise) out.splice(Math.min(at, out.length), 0, ...n);
    return out;
  });

/** A swap call: setup from `callPressed`, then one to three scenes, at least one a narrowing; at most 100 steps. */
export const arbSwapCall: fc.Arbitrary<SwapStep[]> = fc
  .tuple(arbSetup, arbSwapScene, fc.array(fc.oneof({ weight: 3, arbitrary: arbSwapScene }, { weight: 1, arbitrary: arbFastOScene as fc.Arbitrary<SwapStep[]> }, { weight: 1, arbitrary: arbSlowScene as fc.Arbitrary<SwapStep[]> }), { maxLength: 2 }), fc.boolean())
  .map(([setup, first, rest, swapFirst]) => {
    const scenes = swapFirst ? [first, ...rest] : [...rest, first];
    return [...(setup as SwapStep[]), ...scenes.flat()].slice(0, 100);
  });

