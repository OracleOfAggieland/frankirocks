// Feature: what a call puts on the screen (brief 044), Property: an old visit never talks.
// Each reset makes a new visit ID, and the server answers STALE to an open that names an older one (brief 038). The
// Voice_Client hands that answer to the machine as `visitGone`, naming the visit the open carried. For any sequence
// of resets (here or in another tab), visit changes the tab learns, opens, retries, reconnects and swaps: once the
// server has answered STALE to an open naming the tab's current visit, no later open carries that visit ID, and the
// call is not left waiting (it is closed, with no deadline armed and no open in flight).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { OPEN_LIMIT_MS, type VoiceCommand, type VoiceEvent } from "./machine";
import { arbWideCall } from "./testing/arb-call-wide";
import { SwapDriver, type SwapStep, arbEarlyOpenCall, arbSwapCall } from "./testing/arb-swap";

const visitIdOf = (n: number) => `v${String(n).padStart(42, "0")}`;

/** What happens to the visit between steps: another tab resets, this tab learns the server's visit, or both. */
type VisitMove = { at: number; kind: "elsewhere" | "learn" | "here" | "press" };

const arbVisitMoves = fc.array(fc.record({ at: fc.nat({ max: 110 }), kind: fc.constantFrom("elsewhere", "elsewhere", "learn", "here", "press") }), { maxLength: 6 });

const arbOldVisitCall = fc.record({
  kind: fc.constantFrom("wide", "swap", "early"),
  wide: arbWideCall,
  swap: arbSwapCall,
  early: arbEarlyOpenCall,
  moves: arbVisitMoves,
});

type OldVisitCall = { kind: "wide" | "swap" | "early"; wide: readonly unknown[]; swap: readonly SwapStep[]; early: readonly SwapStep[]; moves: readonly VisitMove[] };

const isOpen = (c: VoiceCommand): c is Extract<VoiceCommand, { kind: "open" }> => c.kind === "open";
const answersOpen = (e: VoiceEvent) => e.type === "openOk" || e.type === "openFailed" || e.type === "visitGone";

/** A swap driver whose server holds one current visit, and answers an open naming any other visit STALE. */
class VisitDriver extends SwapDriver {
  serverVisit: string | null = null;
  private visits = 0;

  /** The visit the oldest unanswered open carries, read from the trace: opens are answered oldest first. */
  private oldestOpenVisit(): { visitId: string | null } | undefined {
    const opens = this.trace.steps.flatMap((s) => s.commands.filter(isOpen));
    const answered = this.trace.steps.filter((s) => answersOpen(s.event)).length;
    const o = opens[answered];
    return o === undefined ? undefined : { visitId: o.body.visitId };
  }

  move(kind: VisitMove["kind"]): void {
    if (kind === "press") {
      this.ev({ type: "callPressed", zone: "UTC" });
      return;
    }
    if (kind !== "learn") this.serverVisit = visitIdOf(++this.visits);
    if (kind !== "elsewhere") this.ev({ type: "visitSet", visitId: this.serverVisit });
  }

  override play(step: SwapStep): void {
    const a = step.action as { k: string };
    if ((a.k === "openOk" || a.k === "openEarly") && this.opensWaiting > 0) {
      const o = this.oldestOpenVisit();
      if (o !== undefined && o.visitId !== null && o.visitId !== this.serverVisit) {
        this.sync();
        this.opensPrev.shift();
        this.opensWaiting -= 1;
        this.ev({ type: "visitGone", visitId: o.visitId }, step.dt);
        this.sync();
        return;
      }
    }
    super.play(step);
  }
}

function play(c: OldVisitCall): VisitDriver {
  const steps = (c.kind === "wide" ? c.wide : c.kind === "swap" ? c.swap : c.early) as SwapStep[];
  const d = new VisitDriver();
  if (c.kind === "early") d.openTimeoutMs = OPEN_LIMIT_MS;
  // The tab starts on the server's visit.
  d.move("here");
  d.start();
  steps.forEach((st, i) => {
    for (const m of c.moves) if (m.at === i) d.move(m.kind);
    d.play(st);
  });
  return d;
}

describe("Property: an old visit never talks", () => {
  it("after STALE for the tab's visit, no open carries it and the call is closed with nothing waiting", () => {
    fc.assert(
      fc.property(arbOldVisitCall, (c) => {
        const d = play(c);
        const gone = new Set<string>();
        for (const s of d.trace.steps) {
          for (const cmd of s.commands.filter(isOpen)) {
            if (cmd.body.visitId !== null) expect(gone.has(cmd.body.visitId), `open at step ${s.i} names a visit answered STALE`).toBe(false);
          }
          const ev = s.event as { type: string; visitId?: string | null };
          if (ev.type === "visitGone" && ev.visitId != null && ev.visitId === (s.before.visitId ?? null)) {
            gone.add(ev.visitId);
            expect(s.after.phase, `phase after STALE at step ${s.i}`).toBe("CLOSED");
            expect(s.after.awaitingOpen, `still awaiting an open after STALE at step ${s.i}`).toBe(false);
            expect(Object.keys(s.after.deadlines), `deadlines after STALE at step ${s.i}`).toEqual([]);
          }
        }
      }),
      { numRuns: 1_000 },
    );
  });

  it("the calls reach a STALE answer for the tab's visit, and a press after it", () => {
    let stale = 0;
    let pressedAfter = 0;
    for (const c of fc.sample(arbOldVisitCall, { seed: 2026, numRuns: 300 })) {
      const d = play(c);
      const at = d.trace.steps.findIndex((s) => s.event.type === "visitGone" && (s.event as { visitId: string | null }).visitId === (s.before.visitId ?? null));
      if (at < 0) continue;
      stale += 1;
      if (d.trace.steps.slice(at + 1).some((s) => s.event.type === "callPressed" || s.event.type === "retryPressed")) pressedAfter += 1;
    }
    expect(stale).toBeGreaterThanOrEqual(40);
    expect(pressedAfter).toBeGreaterThanOrEqual(10);
  });
});
