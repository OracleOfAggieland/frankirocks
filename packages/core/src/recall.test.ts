import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJSON, type Hasher, rootKey } from "./ids";
import {
  RECALL_LINE_CHARS,
  RECALL_MAX_LINES,
  explicitRequest,
  packRecall,
  parseRecallOutput,
  recallLines,
  recallExcerpts,
  recallNotes,
  recallOutputJsonSchema,
} from "./recall";
import type { Evidence, Memory } from "./schema/records";
import { turnTextSlice } from "./slices";
import { sampleEC, sampleEvidence, sampleMemory, sampleSnapshot, testId } from "./testing";

const hasher: Hasher = {
  id: (parts) => createHash("sha256").update(canonicalJSON(parts)).digest("base64url"),
  sha256: (bytes) => createHash("sha256").update(bytes).digest("hex"),
};

const TEXT = "My dog is called Pip";
const EID = testId("ev");
const slice = turnTextSlice(EID, TEXT, "U", hasher);
const evidence = sampleEvidence({ text: { kind: "inline", text: TEXT }, fieldSlices: [slice] });

function mem(i: number, overrides: Partial<Memory> = {}): { id: string; memory: Memory } {
  return {
    id: testId(`m${String(i).padStart(3, "0")}`),
    memory: sampleMemory({ rootSlices: [slice], rootKeys: [rootKey(slice, hasher)], value: { kind: "text", text: `line ${i}` }, key: testId(`k${i}`), ...overrides }),
  };
}

function linesFor(rows: { id: string; memory: Memory }[]) {
  const snapshot = sampleSnapshot({ memories: rows.map((r) => [r.id, r.memory]), evidence: [[EID, evidence]] });
  return recallLines(rows, sampleEC({ explicitRequest: true }), snapshot, new Map<string, Evidence>([[EID, evidence]]));
}

describe("explicitRequest (asked test)", () => {
  it("true only when the Turn's words contain a query term or entity alias", () => {
    const args = { query: "dog's name", entityRefs: [{ id: null, label: "Pip" }] };
    expect(explicitRequest("What is my DOG called?", args)).toBe(true);
    expect(explicitRequest("tell me about pip", args)).toBe(true);
    expect(explicitRequest("what's the weather", args)).toBe(false);
    expect(explicitRequest(null, args)).toBe(false);
    expect(explicitRequest("my dog", args, false)).toBe(false);
  });
});

describe("recallLines", () => {
  it("keeps eligible, spoken-grade, non-S2 lines with S0/S1 root quotes, at most 200", () => {
    const rows = [
      ...Array.from({ length: RECALL_MAX_LINES + 5 }, (_, i) => mem(i)),
      mem(900, { sens: "S2" }),
      mem(901, { sourceClass: "T" }),
      mem(902, { status: "history" }),
      mem(903, { flow: "never_outbound" }),
    ];
    const { lines, eligibleCount } = linesFor(rows);
    expect(eligibleCount).toBe(RECALL_MAX_LINES + 5);
    expect(lines).toHaveLength(RECALL_MAX_LINES);
    expect(lines.some((l) => /line 90[0-3]/.test(l.item.text))).toBe(false);
    expect(lines[0]!.item).toMatchObject({ text: "fact: line 0", roots: [{ eid: EID, fieldPath: "text", start: 0, end: 20, quote: TEXT }], class: "U", sens: "S0" });
  });

  it("drops a root Span whose Slice is S2, and caps line text at 160 characters", () => {
    const s2 = { ...slice, sens: "S2" as const };
    const { lines } = linesFor([mem(1, { rootSlices: [s2], sens: "S1", value: { kind: "text", text: "x".repeat(300) } })]);
    expect(lines[0]!.item.roots).toEqual([]);
    expect(lines[0]!.item.text.length).toBe(RECALL_LINE_CHARS);
  });
});

describe("packRecall and notes", () => {
  it("packs within 8,000 tokens and flags truncation", () => {
    const { lines, eligibleCount } = linesFor(Array.from({ length: 205 }, (_, i) => mem(i)));
    const packed = packRecall(lines, eligibleCount, "line", "answer");
    expect(packed.truncated).toBe(true);
    expect(Math.ceil(JSON.stringify(packed.input).length / 4)).toBeLessThanOrEqual(8_000);
    const small = linesFor([mem(1)]);
    expect(packRecall(small.lines, small.eligibleCount, "line", "answer")).toMatchObject({ truncated: false, input: { coverage: { complete: true, truncated: false } } });
  });

  it("recall citation filter: every citation must be supplied; notes carry the cited rows' roots and dependencies", () => {
    const { lines } = linesFor([mem(1), mem(2, { sens: "S1" })]);
    const ref1 = lines[0]!.item.refs[0]!;
    const ref2 = lines[1]!.item.refs[0]!;
    const span = lines[0]!.item.roots[0]!;
    const out = parseRecallOutput(
      JSON.stringify({
        kind: "supported",
        statements: [
          { text: "both", citations: [ref1, ref2], memoryIds: [] },
          { text: "ghost", citations: [{ type: "memory", id: testId("ghost"), rev: 1 }], memoryIds: [] },
          { text: "old rev", citations: [{ ...ref1, rev: 9 }], memoryIds: [] },
          { text: "span", citations: [span], memoryIds: [] },
        ],
        alternatives: [],
      }),
    )!;
    const notes = recallNotes(out, lines, { noteId: (n) => testId(`note${n}`), expiresAt: "2026-11-03T12:01:00.000Z" });
    expect(notes.map((n) => n.text)).toEqual(["both", "span"]);
    expect(notes[0]).toMatchObject({ sens: "S1", kind: "result", unprompted: false });
    expect(notes[0]!.dependsOn).toEqual([`e:${EID}`]);
    expect(notes[0]!.rootKeys).toEqual([rootKey(slice, hasher)]);
  });

  it("rejects a statement with no citations and output outside the schema", () => {
    expect(parseRecallOutput(JSON.stringify({ kind: "supported", statements: [{ text: "x", citations: [], memoryIds: [] }], alternatives: [] }))).toBeNull();
    expect(parseRecallOutput("{")).toBeNull();
    expect(parseRecallOutput(null)).toBeNull();
  });

  it("builds a strict JSON Schema for the Responses text format", () => {
    const schema = recallOutputJsonSchema();
    expect(schema).toMatchObject({ type: "object", additionalProperties: false, required: ["kind", "statements", "alternatives"] });
  });
});

describe("recallExcerpts (when the reader fails)", () => {
  const ctx = { noteId: (n: number) => testId(`x${n}`), expiresAt: "2026-11-03T12:01:00.000Z" };
  const lineRows = () =>
    linesFor([
      mem(1, { value: { kind: "text", text: "Ana lives in Denver" } }),
      mem(2, { value: { kind: "text", text: "Pip is the owner's dog" } }),
      mem(3, { value: { kind: "text", text: "The dog park near Ana opens at 9" } }),
      mem(4, { value: { kind: "text", text: "Locker code 4417" }, sens: "S1" }),
    ]).lines;

  it("keeps stored lines sharing a topic word with the query or question, best overlap first, verbatim", () => {
    const notes = recallExcerpts("dog park", "What time does the dog park open?", lineRows(), ctx);
    expect(notes.map((n) => n.text)).toEqual(["fact: The dog park near Ana opens at 9", "fact: Pip is the owner's dog"]);
    expect(notes[0]).toMatchObject({ noteId: testId("x0"), kind: "result", unprompted: false, sens: "S0", dependsOn: [`e:${EID}`] });
    expect(notes[0]!.rootKeys).toEqual([rootKey(slice, hasher)]);
  });

  it("question words, 'owner' and short words never match, so nothing comes back for them", () => {
    expect(recallExcerpts("what", "What did I tell you about the owner?", lineRows(), ctx)).toEqual([]);
    expect(recallExcerpts("my", "is it", lineRows(), ctx)).toEqual([]);
  });

  it("carries each line's sensitivity and stops at four notes", () => {
    expect(recallExcerpts("locker code", null, lineRows(), ctx)).toEqual([expect.objectContaining({ text: "fact: Locker code 4417", sens: "S1" })]);
    const many = linesFor(Array.from({ length: 9 }, (_, i) => mem(i, { value: { kind: "text", text: `dog fact ${i}` } }))).lines;
    expect(recallExcerpts("dog", null, many, ctx)).toHaveLength(4);
  });
});
