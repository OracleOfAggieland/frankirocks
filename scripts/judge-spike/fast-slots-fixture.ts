/**
 * The synthetic context the Harness sends `FastSlotsV1` (brief 012 task A9): made-up entities and targets, so the
 * call sees a context shaped like the app's (design 3.0) without any of the owner's words or memories. Targets go
 * only to the routes that read them: `correct` and `transition`; a hardRule-only line gets none.
 */
import { createHash } from "node:crypto";
import type { FastSlotsInput } from "@franki/core";

export type SlotsRoute = "hardRule" | "correct" | "transition";

/** A stable 43-character ID from a name, the shape of the app's IDs. */
const idOf = (name: string): string => createHash("sha256").update(`fast-slots-fixture:${name}`).digest("base64url");

export const FIXTURE_ENTITIES: FastSlotsInput["entities"] = [
  { id: idOf("sibling"), label: "Robin", aliases: ["sister"] },
  { id: idOf("parent"), label: "Pat", aliases: ["dad"] },
  { id: idOf("friend"), label: "Jordan", aliases: ["friend"] },
];

export const FIXTURE_TARGETS: FastSlotsInput["targets"] = [
  { id: idOf("selfName"), predicate: "identity.name", value: { kind: "text", text: "Casey" }, args: {}, line: "The owner's name is Casey." },
  { id: idOf("siblingRel"), predicate: "person.relation", value: { kind: "enum", code: "sister" }, args: { otherRef: idOf("sibling"), label: "sister", employerRef: null }, line: "Robin is the owner's sister." },
  { id: idOf("parentLife"), predicate: "person.life", value: { kind: "enum", code: "alive" }, args: { detail: null }, line: "Pat is alive." },
  { id: idOf("selfStatus"), predicate: "employment.status", value: { kind: "enum", code: "working" }, args: {}, line: "The owner is working." },
];

/** The FastSlotsV1 input for one line: its text as the turn, the synthetic entities, and targets when a route reads them. */
export function fixtureInput(lineId: string, text: string, routes: readonly SlotsRoute[]): FastSlotsInput {
  const wantsTargets = routes.includes("correct") || routes.includes("transition");
  return {
    turn: { eid: idOf(`turn:${lineId}`), text, ownerConfirmed: false },
    lastTurns: [],
    entities: FIXTURE_ENTITIES,
    targets: wantsTargets ? FIXTURE_TARGETS : [],
    pendingId: null,
  };
}
