// Calls in which the server sends delivery's unprompted lines (brief 045, part V, finding 3): an opening line in
// the open answer, and idle lines in state answers, amid ordinary call steps (speech, Turns, replies, timers, lost
// connections). Each line carries a `proactive` Permit hashed as the server's `proactiveOf` hashes it: the stamp,
// the Deck the same answer carries (its Head and safe turns), the whisper as the one note, no audio, no tool
// output. Some are issued for another Session, another call (generation), or under another audience (a Head the
// browser never held), and must be dropped.
import fc from "fast-check";
import { payloadHash } from "../../admission";
import type { Deck, Permit, Proactive, Stamp, W } from "../../schema/wire";
import { tsFromMs } from "../../schema/primitives";
import type { RealtimeClientEvent } from "../machine";
import { type Action, CallDriver, SID, type Step, arbAction, deckAt } from "./arb-call";

export type LineVariant = "ok" | "otherSession" | "otherGen" | "otherAudience";
export type ProactiveAction = { k: "lineState"; variant: LineVariant };
export interface PStep {
  action: Action | ProactiveAction;
  dt: number;
}

export interface Delivered {
  p: Proactive;
  variant: LineVariant | "open";
  /** The trace step whose event carried the line. */
  step: number;
  /** When the state request it answers went out (the open's line: the open answer's time). */
  sentAt: number;
}

const OTHER_SID = "x".repeat(43);
const LINE = "Good luck at 2 PM: Tessellate Labs final interview.";
const COMPANY_HEAD = "You are Franki.\nAudience: company.";

const ssOf = (d: Deck) => ({ sessionId: SID, epoch: d.epoch, policyRev: d.policyRev, bundleRev: d.bundleRev, rulesRev: d.rulesRev, generation: d.generation });
const ackOf = (d: Deck, at: number) => ({ stamp: ssOf(d), issuedOpsAt: tsFromMs(at), expiresOpsAt: tsFromMs(at + 2_500) });

export const metaOf = (e: RealtimeClientEvent): Record<string, string> => ((e.response as Record<string, unknown> | undefined)?.metadata as Record<string, string> | undefined) ?? {};

export class ProactiveDriver extends CallDriver {
  readonly delivered: Delivered[] = [];
  private opened = false;

  constructor(private readonly openLine: boolean) {
    super();
  }

  /** The server's line for `deck`, as `proactiveOf` builds it, bent by `variant`. */
  line(deck: Deck, at: number, variant: LineVariant): Proactive {
    const turnId = this.fresh("q");
    const momentId = this.fresh("m");
    const stamp: Stamp = { ...ssOf(deck), sessionId: variant === "otherSession" ? OTHER_SID : SID, generation: variant === "otherGen" ? deck.generation + 1 : deck.generation, turnId };
    const whisper: W = { noteId: this.fresh("n"), rev: 1, kind: "moment", text: LINE, rootKeys: [], dependsOn: [], sens: "S0", expiresAt: tsFromMs(at + 10_000), unprompted: true, momentId, tokens: [] };
    const head = variant === "otherAudience" ? { ...deck.head, text: COMPANY_HEAD } : deck.head;
    const approvedPayloadHash = payloadHash({ stamp, head, notes: [whisper], turns: deck.turns, audioIds: [], toolOutput: null }, this.hasher);
    const permit: Permit = { permitId: this.fresh("p"), stamp, kind: "proactive", scope: "reply", approvedPayloadHash, noteIds: [whisper.noteId], momentIds: [momentId], expiresAt: tsFromMs(at + 10_000) };
    return { turnId, permit, whisper, cards: [] };
  }

  /** The first open answer may carry an opening line; every later open (a reconnect) carries none. */
  override connect(): void {
    if (!this.openLine || this.opened) return super.connect();
    this.opened = true;
    this.pending.open = false;
    this.serverDeck = deckAt(this.now + 100, { policyRev: this.serverDeck.policyRev });
    const p = this.line(this.serverDeck, this.now + 100, "ok");
    this.delivered.push({ p, variant: "open", step: this.trace.steps.length, sentAt: this.now + 100 });
    this.ev({ type: "openOk", response: { sessionId: SID, generation: 1, deck: this.serverDeck, state: "connecting", ack: ackOf(this.serverDeck, this.now + 100), proactive: p } }, 100);
    this.ev({ type: "channelOpen" }, 200);
    const sent = this.pending.states.shift() ?? this.now;
    this.ev({ type: "stateOk", response: { stamp: ssOf(this.serverDeck), state: "LISTENING", deck: this.serverDeck, ack: ackOf(this.serverDeck, this.now + 50), barrierReceiptId: null, proactive: null }, sentAt: sent }, 50);
  }

  override play(s: Step | PStep): void {
    const a = s.action;
    if (a.k !== "lineState") return super.play(s as Step);
    if (this.pending.open && this.st.awaitingOpen) this.connect();
    const sentAt = this.pending.states.shift();
    if (sentAt === undefined) return;
    const at = this.now + s.dt;
    const d = deckAt(at, { policyRev: this.serverDeck.policyRev });
    this.serverDeck = d;
    const p = this.line(d, at, a.variant);
    this.delivered.push({ p, variant: a.variant, step: this.trace.steps.length, sentAt });
    this.ev({ type: "stateOk", response: { stamp: ssOf(d), state: "LISTENING", deck: d, ack: ackOf(d, at), barrierReceiptId: null, proactive: p }, sentAt }, s.dt);
  }

  /** The `response.create`s sent for a delivered line's Turn, with their steps. */
  createsFor(p: Proactive): { step: number; event: RealtimeClientEvent }[] {
    return this.trace.creates.filter((c) => metaOf(c.event).turnId === p.turnId);
  }
}

const step = (action: Action | ProactiveAction, dt = 0): PStep => ({ action, dt });
const arbLineAction: fc.Arbitrary<ProactiveAction> = fc.record({
  k: fc.constant("lineState" as const),
  variant: fc.constantFrom<LineVariant>("ok", "ok", "ok", "otherSession", "otherGen", "otherAudience"),
});

/** A quiet poll answered with a line, then its check and reply: the path a line takes when nothing is in its way. */
const arbQuietLine: fc.Arbitrary<PStep[]> = fc.tuple(arbLineAction, fc.boolean()).map(([line, hashOk]) => [
  step({ k: "timer", pick: 0, early: false }),
  step(line, 80),
  step({ k: "hash", pick: 0, ok: hashOk }, 5),
  step({ k: "created", pick: 0 }, 30),
  step({ k: "started", pick: 0 }, 200),
  step({ k: "stopped" }, 900),
  step({ k: "done", pick: 0 }),
]);

/** Ordinary call steps with lines among them, and quiet lines; the open may carry an opening line. */
export const arbProactiveCall: fc.Arbitrary<{ openLine: boolean; steps: PStep[] }> = fc.record({
  openLine: fc.boolean(),
  steps: fc
    .array(
      fc.oneof(
        { weight: 6, arbitrary: fc.record({ action: arbAction, dt: fc.integer({ min: 0, max: 1_500 }) }).map((x) => [x as PStep]) },
        { weight: 2, arbitrary: fc.record({ action: arbLineAction, dt: fc.integer({ min: 0, max: 400 }) }).map((x) => [x as PStep]) },
        { weight: 2, arbitrary: arbQuietLine },
      ),
      { minLength: 0, maxLength: 30 },
    )
    .map((xs) => xs.flat()),
});

/** Plays one generated call. */
export function runProactiveCall(c: { openLine: boolean; steps: readonly PStep[] }): ProactiveDriver {
  const d = new ProactiveDriver(c.openLine).start();
  // The opening line's check and reply, when there is one, before anything else happens.
  if (c.openLine) for (const s of [step({ k: "hash", pick: 0, ok: true }, 5), step({ k: "created", pick: 0 }, 30)]) d.play(s);
  for (const s of c.steps) d.play(s);
  return d;
}
