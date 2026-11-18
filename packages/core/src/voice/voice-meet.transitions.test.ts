// Brief 052 part B: the first meeting's line plays the way the swap line and the forget acknowledgment do. An open
// answer's `proactive` with a meet line under a `postCommitControl` / `ack` Permit is the call's first reply, said
// exactly, with no tools. No machine change: this pins that the existing path carries it.
// Titles read `<FROM> + <event> -> <TO> (<why>)`.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { payloadHash } from "../admission";
import { type Hasher, canonicalJSON } from "../ids";
import { tsFromMs } from "../schema/primitives";
import type { Deck, Permit, Proactive, Stamp } from "../schema/wire";
import type { Infer } from "../schema/v";
import { sampleHead, testId } from "../testing/samples";
import { type AckText, MEET_AGAIN_LINE, MEET_LINE, ackNote, sayExactly } from "./lines";
import { type VoiceCommand, type VoiceEvent, type VoiceState, initialVoiceState, step } from "./machine";

const hasher: Hasher = {
  id: (parts) => createHash("sha256").update(canonicalJSON(parts)).digest("base64url"),
  sha256: (bytes) => createHash("sha256").update(bytes).digest("hex"),
};
const T = Date.UTC(2026, 10, 3, 12);
const SID = testId("session");
const TURN = testId("meet-turn");

function deckAt(issued: number): Deck {
  return { epoch: 1, policyRev: 1, generation: 1, bundleRev: 1, rulesRev: 1, issuedAt: tsFromMs(issued), expiresAt: tsFromMs(issued + 60_000), head: sampleHead(), whispers: [], noteWaiting: false, turns: [], cards: [], activePlanId: null };
}
const ss = (d: Deck) => ({ sessionId: SID, epoch: d.epoch, policyRev: d.policyRev, bundleRev: d.bundleRev, rulesRev: d.rulesRev, generation: d.generation });
const ackAt = (d: Deck, at: number) => ({ stamp: ss(d), issuedOpsAt: tsFromMs(at), expiresOpsAt: tsFromMs(at + 2500) });

/** The open's `proactive` as the server builds it: the line as one ack note, under the Permit `admitRule` gives. */
function meetProactive(line: AckText, deck: Deck, at: number): Infer<typeof Proactive> {
  const whisper = ackNote(line, testId("meet-note"), tsFromMs(at + 10_000));
  const stamp: Stamp = { ...ss(deck), turnId: TURN };
  const approvedPayloadHash = payloadHash({ stamp, head: deck.head, notes: [whisper], turns: deck.turns, audioIds: [], toolOutput: null }, hasher);
  const permit: Permit = { permitId: testId("meet-permit"), stamp, kind: "postCommitControl", scope: "ack", approvedPayloadHash, noteIds: [whisper.noteId], momentIds: [], expiresAt: tsFromMs(at + 10_000) };
  return { turnId: TURN, permit, whisper, cards: [] };
}

function firstCall(line: AckText) {
  let st: VoiceState = initialVoiceState({ transcribeModel: "test-transcribe-model" }, "America/Chicago");
  let now = T;
  const log: VoiceCommand[] = [];
  const ev = (event: VoiceEvent, dt = 0) => {
    now += dt;
    const r = step(st, event, now);
    st = r.state;
    log.push(...r.commands);
    return r.commands;
  };
  ev({ type: "callPressed", zone: "America/Chicago" });
  const deck = deckAt(now + 200);
  ev({ type: "openOk", response: { sessionId: SID, generation: 1, deck, state: "connecting", ack: ackAt(deck, now + 200), proactive: meetProactive(line, deck, now + 200), audience: "private" } }, 200);
  const held = st.proactive;
  ev({ type: "channelOpen" }, 300);
  const atAck = ev({ type: "stateOk", response: { stamp: ss(deck), state: "LISTENING", deck: deckAt(now + 100), ack: ackAt(deck, now + 100), barrierReceiptId: null, proactive: null, audience: null } }, 100);
  return { st: () => st, ev, log, held, atAck };
}

describe("the first meeting's line on the call (brief 052 part B)", () => {
  for (const line of [MEET_LINE, MEET_AGAIN_LINE] as const) {
    it(`CONNECTING + stateOk (ack matches) -> HELD, then the line exactly: "${line}"`, () => {
      const c = firstCall(line);
      expect(c.held?.whisper.text).toBe(line);
      const verify = c.atAck.find((x) => x.kind === "verifyPermit");
      expect(verify).toBeDefined();
      expect(c.st()).toMatchObject({ phase: "HELD", proactive: null });
      if (verify?.kind !== "verifyPermit") return;
      const said = c.ev({ type: "permitChecked", permitId: verify.permitId, hash: payloadHash(verify.payload, hasher) });
      const creates = said.flatMap((x) => (x.kind === "send" && x.event.type === "response.create" ? [x.event] : []));
      expect(creates).toHaveLength(1);
      expect(creates[0]).toMatchObject({ response: expect.objectContaining({ tools: [], instructions: sayExactly(line) }) });
    });
  }

  it("CONNECTING + stateOk with a meet line whose hash doesn't match -> nothing is said (the Permit check still binds it)", () => {
    const c = firstCall(MEET_LINE);
    const verify = c.atAck.find((x) => x.kind === "verifyPermit");
    if (verify?.kind !== "verifyPermit") throw new Error("no verifyPermit");
    const said = c.ev({ type: "permitChecked", permitId: verify.permitId, hash: "0".repeat(64) });
    expect(said.some((x) => x.kind === "send" && x.event.type === "response.create")).toBe(false);
  });
});
