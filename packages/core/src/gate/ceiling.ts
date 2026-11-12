/**
 * The ceiling for unprompted saying, as data (spec §6 lines 202 to 206; contracts §2). One cell per sensitivity and
 * class group. A cell's `paths` are tried in order for an unprompted candidate and the first whose condition holds
 * wins; no match is silent. `reply` is the render once the topic is raised (asked, or its door open).
 */
import type { Class, Sens } from "../schema/primitives";
import type { GateRender } from "./reasons";

export type ClassGroup = "told" | "own" | "third" | "inferred";

export const CEILING_PATHS = [
  "open",
  "attributedMailed",
  "attributedLogistics",
  "cappedAsk",
  "card",
  "offer",
  "checkIn",
  "door",
  "ownRootedDoor",
  "oLogistics",
  "replyOnly",
  "silentUntilRaised",
] as const;
export type CeilingPath = (typeof CEILING_PATHS)[number];

export interface CeilingCell {
  paths: readonly CeilingPath[];
  reply: GateRender;
}

export const CEILING = {
  S0: {
    told: { paths: ["open"], reply: "free" },
    own: { paths: ["open"], reply: "free" },
    third: { paths: ["attributedMailed", "card"], reply: "attributed" },
    inferred: { paths: ["offer", "silentUntilRaised"], reply: "hedged" },
  },
  S1: {
    told: { paths: ["open"], reply: "free" },
    own: { paths: ["open"], reply: "free" },
    third: { paths: ["attributedLogistics", "cappedAsk", "card"], reply: "attributed" },
    inferred: { paths: ["offer", "silentUntilRaised"], reply: "hedged" },
  },
  S2: {
    told: { paths: ["checkIn", "door", "replyOnly"], reply: "free" },
    // "Logistics open; any conclusion counts as M."
    own: { paths: ["oLogistics", "ownRootedDoor", "silentUntilRaised"], reply: "hedged" },
    third: { paths: ["replyOnly"], reply: "attributed" },
    inferred: { paths: ["ownRootedDoor", "silentUntilRaised"], reply: "hedged" },
  },
} as const satisfies Record<Sens, Record<ClassGroup, CeilingCell>>;

export function classGroup(c: Class): ClassGroup {
  switch (c) {
    case "U":
    case "C":
      return "told";
    case "O":
      return "own";
    case "T":
      return "third";
    case "M":
      return "inferred";
    default:
      c satisfies never;
      return "inferred";
  }
}

/** The paths that need the +200 build (code forms of the `proactive` row). */
export const PLUS200_PATHS: ReadonlySet<CeilingPath> = new Set(["checkIn", "door", "ownRootedDoor", "oLogistics"]);
