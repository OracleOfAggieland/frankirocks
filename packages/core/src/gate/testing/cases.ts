/**
 * Concrete Gate inputs for unit cases (brief 033). Every field is set, so a test names only what it changes.
 */
import { testId } from "../../testing/samples";
import type { GateCandidate, GateContext } from "../types";

export const CASE_NOW = "2026-11-12T17:00:00.000Z"; // 09:00 in Los Angeles

export function gateCand(o: Partial<GateCandidate> = {}): GateCandidate {
  return {
    id: testId("c1"),
    kind: "memory",
    subjectId: "e:mom",
    sourceClass: "U",
    sens: "S0",
    allergy: false,
    eligibility: { allow: true, reason: "ok" },
    toldAt: null,
    topic: null,
    queryTerms: [],
    aliases: [],
    purpose: "item",
    gravity: 0,
    food: false,
    mustSay: null,
    dueAt: null,
    sender: null,
    attestedPremises: 0,
    offerUsed: false,
    ownRooted: false,
    checkInUsed: false,
    act: "say",
    ...o,
  };
}

export function gateCtx(o: Partial<GateContext> = {}): GateContext {
  return {
    worldNow: CASE_NOW,
    zone: "America/Los_Angeles",
    build: "floor",
    audience: "private",
    modifiers: { rushed: false, crisis: false },
    trigger: "unprompted",
    ownerTurn: null,
    openedTopics: [],
    recentTurns: [],
    counts: { proactive: 0, heavy: 0, senderAsks: 0, notesThisReply: 0 },
    rules: "ready",
    authorization: null,
    ...o,
  };
}

export const ownerSaid = (text: string) => ({ text, sourceClass: "U" as const, certain: true });
