/**
 * The synthetic context the Harness sends `FastSlotsV1` (brief 012 task A9): made-up entities and targets, so the
 * call sees a context shaped like the app's (design 3.0) without any of the owner's words or memories. Targets go
 * only to the routes that read them: `correct` and `transition`; a hardRule-only line gets none.
 *
 * A correction can only name a target it was sent, so each correction line of lines.json also gets the saved row it
 * corrects, written from that line's own text (the repo's words, never the owner's). Without it, a correction count
 * measured the shared fixture, not FastSlotsV1.
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

type Context = Pick<FastSlotsInput, "entities" | "targets">;
type Target = FastSlotsInput["targets"][number];

/** One line's own entity (when it has one) and the row it corrects, ahead of the shared set. */
const withRow = (entity: FastSlotsInput["entities"][number] | null, target: Target): Context => ({
  entities: entity === null ? FIXTURE_ENTITIES : [entity, ...FIXTURE_ENTITIES],
  targets: [target, ...FIXTURE_TARGETS],
});
const nameRow = (line: string, oldName: string, alias: string, said: string): Context =>
  withRow(
    { id: idOf(`${line}:entity`), label: oldName, aliases: [alias] },
    { id: idOf(`${line}:target`), predicate: "identity.alias", value: { kind: "text", text: oldName }, args: { entityRef: idOf(`${line}:entity`) }, line: said },
  );
const eventRow = (line: string, what: string, occasion: string, said: string): Context =>
  withRow(null, { id: idOf(`${line}:target`), predicate: "event", value: { kind: "text", text: what }, args: { occasion, anchorRef: null, important: false }, line: said });

/** The saved row each correction line corrects, from the line's own words in lines.json. */
export const LINE_CONTEXT: Readonly<Record<string, Context>> = {
  // "No, her name is Mara, not Maya."
  "c-correction-1": nameRow("c-correction-1", "Maya", "sister", "The owner's sister is called Maya."),
  // "Actually, I said Tuesday, not Thursday."
  "c-correction-2": eventRow("c-correction-2", "Appointment on Thursday", "appointment", "The owner has an appointment on Thursday."),
  // "That's wrong, my dog is called Pip, not Tip."
  "c-correction-3": nameRow("c-correction-3", "Tip", "dog", "The owner's dog is called Tip."),
  // "No, I meant my cousin, not my brother."
  "c-correction-4": withRow(
    { id: idOf("c-correction-4:entity"), label: "Sam", aliases: ["brother"] },
    { id: idOf("c-correction-4:target"), predicate: "person.relation", value: { kind: "enum", code: "brother" }, args: { otherRef: idOf("c-correction-4:entity"), label: "brother", employerRef: null }, line: "Sam is the owner's brother." },
  ),
  // "Sorry, I got that wrong earlier, the wedding is in June, not July."
  "c-correction-5": eventRow("c-correction-5", "Wedding in July", "other", "The owner has a wedding in July."),
};

/** The FastSlotsV1 input for one line: its text as the turn, the line's context, and targets when a route reads them. */
export function fixtureInput(lineId: string, text: string, routes: readonly SlotsRoute[]): FastSlotsInput {
  const wantsTargets = routes.includes("correct") || routes.includes("transition");
  const ctx = LINE_CONTEXT[lineId] ?? { entities: FIXTURE_ENTITIES, targets: FIXTURE_TARGETS };
  return {
    turn: { eid: idOf(`turn:${lineId}`), text, ownerConfirmed: false },
    lastTurns: [],
    entities: ctx.entities,
    targets: wantsTargets ? ctx.targets : [],
    pendingId: null,
  };
}
