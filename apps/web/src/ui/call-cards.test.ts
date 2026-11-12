// Brief 044, item 1: which tool answer's cards a call may show, and when they leave.
import type { Card, Stamp } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { CallCardShelf } from "../client/call-cards";
import { callCardProps, callCardsStay, toolCardsThatFit } from "./call-cards";

const stamp: Stamp = { sessionId: testId("s1"), epoch: 1, policyRev: 2, bundleRev: 1, rulesRev: 1, generation: 1, turnId: testId("t1") };
const cards: Card[] = [
  { id: testId("c1"), kind: "food", title: "Three quick dinners", lines: ["<b>Tacos</b>"], sources: [], sens: "S0" },
  { id: testId("c2"), kind: "food", title: "Grocery list", lines: ["Tortillas"], sources: [], sens: "S0" },
];
const answer = (over: Record<string, unknown> = {}) =>
  ({ stamp, callId: "call_1", status: "ready", result: { name: "answer", state: "applied", receiptId: null, pendingId: null, cards }, deck: null, permit: null, ...over }) as never;
const call = (over: Record<string, unknown> = {}) => ({ phase: "TOOL_WAIT", session: { sessionId: stamp.sessionId, generation: 1 }, deck: { epoch: 1, policyRev: 2 }, ...over }) as never;

describe("toolCardsThatFit (brief 044, item 1)", () => {
  it("a ready answer in the same Session and generation shows its cards", () => {
    expect(toolCardsThatFit(call(), stamp, answer())).toEqual(cards);
  });
  it("another Session, another generation, or a closed call shows nothing", () => {
    expect(toolCardsThatFit(call({ session: { sessionId: testId("s2"), generation: 1 } }), stamp, answer())).toEqual([]);
    expect(toolCardsThatFit(call({ session: { sessionId: stamp.sessionId, generation: 2 } }), stamp, answer())).toEqual([]);
    expect(toolCardsThatFit(call({ phase: "CLOSED", session: null }), stamp, answer())).toEqual([]);
    expect(toolCardsThatFit(call(), stamp, answer({ stamp: { ...stamp, generation: 2 } }))).toEqual([]);
  });
  it("a narrowing seen before the answer (a higher policy revision or epoch) shows nothing", () => {
    expect(toolCardsThatFit(call({ deck: { epoch: 1, policyRev: 3 } }), stamp, answer())).toEqual([]);
    expect(toolCardsThatFit(call({ deck: { epoch: 2, policyRev: 2 } }), stamp, answer())).toEqual([]);
  });
  it("an answer that is not ready, or a result with no cards, shows nothing", () => {
    expect(toolCardsThatFit(call(), stamp, answer({ status: "hold" }))).toEqual([]);
    expect(toolCardsThatFit(call(), stamp, answer({ result: null }))).toEqual([]);
    expect(toolCardsThatFit(call(), stamp, answer({ result: { name: "make_phone_call", requestId: testId("r"), message: "ok" } }))).toEqual([]);
  });
});

describe("the call's cards on the screen (brief 044, item 1)", () => {
  it("are read cards with their text as given, which the Card renders as text", () => {
    const props = callCardProps({ key: stamp.turnId, sessionId: stamp.sessionId, generation: 1, cards });
    expect(props.map((p) => [p.kind, p.title])).toEqual([
      ["read", "Three quick dinners"],
      ["read", "Grocery list"],
    ]);
    expect(props[0]).toMatchObject({ lines: ["<b>Tacos</b>"], sources: [] });
  });
  it("stay through a hang-up, and leave when the call is on another Session or generation", () => {
    const shown = { key: "k", sessionId: stamp.sessionId, generation: 1, cards };
    expect(callCardsStay(shown, { session: null })).toBe(true);
    expect(callCardsStay(shown, { session: { sessionId: stamp.sessionId, generation: 1 } })).toBe(true);
    expect(callCardsStay(shown, { session: { sessionId: stamp.sessionId, generation: 2 } })).toBe(false);
    expect(callCardsStay(shown, { session: { sessionId: testId("s9"), generation: 1 } })).toBe(false);
  });
  it("the shelf holds the last answer's cards, ignores one with none, drops them on a swap, and clears", () => {
    const shelf = new CallCardShelf();
    let told = 0;
    shelf.subscribe(() => told++);
    shelf.show(cards, stamp);
    shelf.show([], { ...stamp, turnId: testId("t2") });
    expect(shelf.getSnapshot()?.cards).toEqual(cards);
    shelf.onVoice({ session: { sessionId: stamp.sessionId, generation: 1 } });
    expect(shelf.getSnapshot()).not.toBeNull();
    shelf.onVoice({ session: { sessionId: testId("s2"), generation: 1 } });
    expect(shelf.getSnapshot()).toBeNull();
    shelf.show(cards, stamp);
    shelf.clear();
    expect(shelf.getSnapshot()).toBeNull();
    expect(told).toBe(4);
  });
});
