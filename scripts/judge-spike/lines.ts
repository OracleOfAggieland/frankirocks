/**
 * The judge spike's probe lines (brief 006 item 2), frozen in lines.json before any run. Spec §13: a miss is
 * never relabeled a pass. `lines.test.ts` pins a hash of every line's ID, text, class, label and probe flag, so a
 * label can only change in a commit that also changes the pin and says why.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const CONTROL_CLASSES = ["forget", "company", "quiet", "correction", "hardRule", "crisis"] as const;
export const ORDINARY_CLASSES = ["smallTalk", "question", "fact", "askMemory", "nearMiss"] as const;
export type ControlClass = (typeof CONTROL_CLASSES)[number];
export type OrdinaryClass = (typeof ORDINARY_CLASSES)[number];
export type LineClass = ControlClass | OrdinaryClass;
export type Expect = "hold" | "ordinary";

export interface ProbeLine {
  id: string;
  text: string;
  class: LineClass;
  expect: Expect;
  /** One of the 15 ordinary latency probes. */
  probe: boolean;
  note?: string;
}

export const LINES_URL = new URL("./lines.json", import.meta.url);
export const LINE_ID = /^(c-[a-z]+-[1-9]|o-[0-9]{2})$/;
/** About 6 seconds of speech at a relaxed pace. */
export const MAX_WORDS = 18;

const isControl = (c: string): c is ControlClass => (CONTROL_CLASSES as readonly string[]).includes(c);
const isOrdinary = (c: string): c is OrdinaryClass => (ORDINARY_CLASSES as readonly string[]).includes(c);

/** Checks the shape of one parsed line. Throws on the first problem. */
function checkLine(raw: unknown, index: number): ProbeLine {
  if (typeof raw !== "object" || raw === null) throw new Error(`line ${index}: not an object`);
  const r = raw as Record<string, unknown>;
  const keys = Object.keys(r).filter((k) => !["id", "text", "class", "expect", "probe", "note"].includes(k));
  if (keys.length > 0) throw new Error(`line ${index}: unknown keys ${keys.join(", ")}`);
  if (typeof r.id !== "string" || !LINE_ID.test(r.id)) throw new Error(`line ${index}: bad id`);
  if (typeof r.text !== "string" || r.text.trim() === "") throw new Error(`${r.id}: empty text`);
  if (typeof r.class !== "string" || !(isControl(r.class) || isOrdinary(r.class))) throw new Error(`${r.id}: bad class`);
  if (r.expect !== "hold" && r.expect !== "ordinary") throw new Error(`${r.id}: bad expect`);
  if (typeof r.probe !== "boolean") throw new Error(`${r.id}: bad probe`);
  if (r.note !== undefined && typeof r.note !== "string") throw new Error(`${r.id}: bad note`);
  if (isControl(r.class) !== (r.expect === "hold")) throw new Error(`${r.id}: class and expect disagree`);
  return { id: r.id, text: r.text, class: r.class, expect: r.expect, probe: r.probe, ...(r.note === undefined ? {} : { note: r.note }) };
}

/** Parses and checks the whole file's text. */
export function parseLines(text: string): ProbeLine[] {
  const doc = JSON.parse(text) as { lines?: unknown };
  if (!Array.isArray(doc.lines)) throw new Error("lines.json: no lines array");
  const lines = doc.lines.map(checkLine);
  const ids = new Set(lines.map((l) => l.id));
  if (ids.size !== lines.length) throw new Error("lines.json: duplicate IDs");
  return lines;
}

export function loadLines(url: URL = LINES_URL): ProbeLine[] {
  return parseLines(readFileSync(url, "utf8"));
}

/** SHA-256 over every line's labelled fields, in file order. Notes are excluded. */
export function lineSetHash(lines: readonly ProbeLine[]): string {
  const rows = lines.map((l) => [l.id, l.text, l.class, l.expect, l.probe]);
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

export const wordCount = (text: string): number => text.split(/\s+/).filter((w) => w !== "").length;
