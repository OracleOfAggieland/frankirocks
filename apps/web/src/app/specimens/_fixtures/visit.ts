// Seed route answers for the visit, bolt and sheet specimens and tests (brief 027). Specimens and tests only:
// nothing on /lab imports this. Each answer is valid against the closed contracts §6 response.
import type { AdvanceResponse, Proactive, ResetResponse } from "@franki/core";

/** A 43-character ID for a fixture row. */
export const vid = (label: string) => (`vx${label}` + "_".repeat(43)).slice(0, 43);

/** The clone's world clock: a Friday at 08:40 UTC (spec §15). */
export const CLONE_WORLD = "2026-11-06T08:40:00.000Z";
/** Thursday at 18:00 UTC, six days on. */
export const THURSDAY_WORLD = "2026-11-12T18:00:00.000Z";

export const RESET_ANSWER: ResetResponse = { fixtureNamespace: vid("ns"), worldClock: CLONE_WORLD, sessionId: null };

const STAMP = { sessionId: vid("s"), epoch: 0, policyRev: 1, bundleRev: 1, rulesRev: 1, generation: 1, turnId: vid("t") };

export const PROACTIVE_ANSWER: Proactive = {
  turnId: vid("t"),
  permit: {
    permitId: vid("p"),
    stamp: STAMP,
    kind: "proactive",
    scope: "reply",
    approvedPayloadHash: "0".repeat(64),
    noteIds: [vid("w")],
    momentIds: [vid("m")],
    expiresAt: "2026-11-12T18:00:10.000Z",
  },
  whisper: {
    noteId: vid("w"),
    rev: 1,
    kind: "moment",
    text: "How'd Biscuit do?",
    rootKeys: [],
    dependsOn: [],
    sens: "S0",
    expiresAt: "2026-11-12T18:00:10.000Z",
    unprompted: true,
    momentId: vid("m"),
    tokens: [],
  },
  cards: [{ id: vid("c"), kind: "moment", title: "Biscuit's surgery", lines: ["You said Thursday."], sources: [], sens: "S0" }],
};

export const ADVANCE_ANSWER: AdvanceResponse = { worldClock: THURSDAY_WORLD, jobId: vid("j"), proactive: PROACTIVE_ANSWER, deck: null };
export const QUIET_ADVANCE_ANSWER: AdvanceResponse = { worldClock: THURSDAY_WORLD, jobId: vid("j"), proactive: null, deck: null };
