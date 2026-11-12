/** Stamps and Decks (contracts §6 SS, Deck; R11.5, R13.3; design "Refresh"). */
import type { CoreBundle, CoreEpoch, CoreRules, Deck, Head, ID, SafeTurn, SS } from "@franki/core";
import { tsFromMs } from "@franki/core";
// Brief 024: whispers on the Deck.
import { type W, msFromTs } from "@franki/core";
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

// ---------------------------------------------------------------------------------------------
// Brief 024: whispers on the Deck (spec §3 "How it works on the wire": "S1+ notes never sit on the deck. The deck
// carries S0 whispers and a noteWaiting flag"). A later brief calls this where the Deck is issued.

/** The Deck with these notes: unexpired S0 notes ride on it (up to 4, first kept); any live S1+ note sets `noteWaiting`. */
export function withWhispers(deck: Deck, notes: readonly W[], opsNow: number): Deck {
  const live = [...deck.whispers, ...notes].filter((w) => msFromTs(w.expiresAt) > opsNow);
  const seen = new Set<string>();
  const whispers: W[] = [];
  let waiting = deck.noteWaiting;
  for (const w of live) {
    if (w.sens !== "S0") {
      waiting = true;
      continue;
    }
    if (seen.has(w.noteId) || whispers.length >= 4) continue;
    seen.add(w.noteId);
    whispers.push(w);
  }
  return { ...deck, whispers, noteWaiting: waiting };
}
