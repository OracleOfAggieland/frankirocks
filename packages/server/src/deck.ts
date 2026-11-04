/** Stamps and Decks (contracts §6 SS, Deck; R11.5, R13.3; design "Refresh"). */
import type { CoreBundle, CoreEpoch, CoreRules, Deck, Head, ID, SafeTurn, SS } from "@franki/core";
import { tsFromMs } from "@franki/core";
import { DECK_TTL_MS } from "./sessions";

/** The current SS from the stored core values. */
export function currentStamp(sessionId: ID, generation: number, core: { epoch: CoreEpoch; rules: CoreRules; bundle: CoreBundle }): SS {
  return {
    sessionId,
    epoch: core.epoch.epoch,
    policyRev: core.epoch.policyRev,
    bundleRev: core.bundle.bundleRev,
    rulesRev: core.rules.rulesRev,
    generation,
  };
}

/** A Deck issued now: `expiresAt` is exactly `issuedAt` + 60 s on opsClock. */
export function issueDeck(stamp: SS, head: Head, opsNow: number, turns: SafeTurn[] = []): Deck {
  return {
    epoch: stamp.epoch,
    policyRev: stamp.policyRev,
    generation: stamp.generation,
    bundleRev: stamp.bundleRev,
    rulesRev: stamp.rulesRev,
    issuedAt: tsFromMs(opsNow),
    expiresAt: tsFromMs(opsNow + DECK_TTL_MS),
    head,
    whispers: [],
    noteWaiting: false,
    turns: turns.slice(-4),
    cards: [],
    activePlanId: null,
  };
}

export const sameStamp = (a: SS, b: SS) =>
  a.sessionId === b.sessionId &&
  a.epoch === b.epoch &&
  a.policyRev === b.policyRev &&
  a.bundleRev === b.bundleRev &&
  a.rulesRev === b.rulesRev &&
  a.generation === b.generation;
