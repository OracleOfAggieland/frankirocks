// Kiroween Demo (R14.1): `phoneOff` is set once at construction and no exit clears it, so a demo call's first
// `session.update`, sent before any state poll, already offers no phone tool. Titles read `<FROM> + <event> -> <TO> (<why>)`.
import { describe, expect, it } from "vitest";
import { tsFromMs } from "../schema/primitives";
import type { Deck } from "../schema/wire";
import { sampleHead, testId } from "../testing/samples";
import { type VoiceCommand, type VoiceEvent, type VoiceState, initialVoiceState, step } from "./machine";

const T = Date.UTC(2026, 10, 3, 12);
const SID = testId("session");
const CONFIG = { transcribeModel: "test-transcribe-model" };

function deckAt(issued: number): Deck {
  return { epoch: 1, policyRev: 1, generation: 1, bundleRev: 1, rulesRev: 1, issuedAt: tsFromMs(issued), expiresAt: tsFromMs(issued + 60_000), head: sampleHead(), whispers: [], noteWaiting: false, turns: [], cards: [], activePlanId: null };
}
const ss = (d: Deck) => ({ sessionId: SID, epoch: d.epoch, policyRev: d.policyRev, bundleRev: d.bundleRev, rulesRev: d.rulesRev, generation: d.generation });

function run(phoneOff?: boolean) {
  let st: VoiceState = initialVoiceState(CONFIG, "America/Chicago", phoneOff === undefined ? undefined : { phoneOff });
  let now = T;
  const ev = (event: VoiceEvent, dt = 0): VoiceCommand[] => {
    now += dt;
    const r = step(st, event, now);
    st = r.state;
    return r.commands;
  };
  return { st: () => st, ev, now: () => now };
}

/** The tool names of every `session.update` among the commands. */
const toolNames = (cmds: VoiceCommand[]): string[][] =>
  cmds.flatMap((c) => (c.kind === "send" && c.event.type === "session.update" ? [((c.event.session as { tools?: { name: string }[] }).tools ?? []).map((t) => t.name)] : []));

/** Press, open, channel: the first `session.update` goes out on `channelOpen`, before any state poll answers. */
function connect(r: ReturnType<typeof run>) {
  r.ev({ type: "callPressed", zone: "America/Chicago" });
  const deck = deckAt(r.now() + 200);
  r.ev({ type: "openOk", response: { sessionId: SID, generation: 1, deck, state: "connecting", ack: { stamp: ss(deck), issuedOpsAt: tsFromMs(r.now() + 200), expiresOpsAt: tsFromMs(r.now() + 2_700) }, proactive: null, audience: "private" } }, 200);
  return r.ev({ type: "channelOpen" }, 300);
}

describe("phoneOff through a call (Kiroween Demo)", () => {
  it("initialVoiceState sets phoneOff only when true", () => {
    expect("phoneOff" in initialVoiceState(CONFIG)).toBe(false);
    expect("phoneOff" in initialVoiceState(CONFIG, "UTC", {})).toBe(false);
    expect("phoneOff" in initialVoiceState(CONFIG, "UTC", { phoneOff: false })).toBe(false);
    expect(initialVoiceState(CONFIG, "UTC", { phoneOff: true }).phoneOff).toBe(true);
    // Every other field is today's.
    const { phoneOff: _, ...rest } = initialVoiceState(CONFIG, "UTC", { phoneOff: true });
    expect(rest).toEqual(initialVoiceState(CONFIG, "UTC"));
  });

  it("CLOSED + connect -> CONNECTING (phoneOff kept)", () => {
    const r = run(true);
    r.ev({ type: "callPressed", zone: "America/Chicago" });
    expect(r.st().phoneOff).toBe(true);
    const deck = deckAt(r.now() + 200);
    r.ev({ type: "openOk", response: { sessionId: SID, generation: 1, deck, state: "connecting", ack: { stamp: ss(deck), issuedOpsAt: tsFromMs(r.now() + 200), expiresOpsAt: tsFromMs(r.now() + 2_700) }, proactive: null, audience: "private" } }, 200);
    expect(r.st().phase).toBe("CONNECTING");
    expect(r.st().phoneOff).toBe(true);
  });

  it("CONNECTING + channelOpen -> CONFIGURING (the first session.update offers no phone tool)", () => {
    const off = run(true);
    const offTools = toolNames(connect(off));
    expect(off.st().phase).toBe("CONFIGURING");
    expect(off.st().phoneOff).toBe(true);
    expect(offTools.length).toBeGreaterThan(0);
    for (const names of offTools) {
      expect(names).not.toContain("make_phone_call");
      expect(names).not.toContain("read_phone_result");
      expect(names).toContain("read_money");
    }
    // Any other visit: today's first list, phone included.
    const today = toolNames(connect(run()));
    expect(today[0]).toContain("make_phone_call");
    expect(offTools[0]).toEqual(today[0]!.filter((n) => n !== "make_phone_call"));
  });

  it("CONFIGURING + hangupPressed -> CLOSED (phoneOff kept for the next call)", () => {
    const r = run(true);
    connect(r);
    r.ev({ type: "hangupPressed" }, 100);
    r.ev({ type: "closeDone" }, 100);
    expect(r.st().phase).toBe("CLOSED");
    expect(r.st().phoneOff).toBe(true);
    const again = toolNames(connect(r));
    for (const names of again) expect(names).not.toContain("make_phone_call");
  });

  it("OPENING + openFailed -> CLOSED (phoneOff kept)", () => {
    const r = run(true);
    r.ev({ type: "callPressed", zone: "America/Chicago" });
    r.ev({ type: "openFailed" }, 100);
    expect(r.st().phase).toBe("CLOSED");
    expect(r.st().phoneOff).toBe(true);
  });

  it("CONFIGURING + connectionLost -> RECOVERY (phoneOff kept)", () => {
    const r = run(true);
    connect(r);
    r.ev({ type: "connectionLost" }, 100);
    expect(r.st().phase).toBe("RECOVERY");
    expect(r.st().phoneOff).toBe(true);
  });
});
