/**
 * Recall (contracts §5 Recall readers, RecallAllV1; §6 Tools; R27.4–R27.9, R28.1–R28.3; design "Tool turn").
 * Pure parts: the asked test, recall lines, the RecallAllV1 packet and request body, output validation and the
 * citation filter that turns statements into notes. The server reads the rows and runs the call.
 *
 *   - Lines are Memories that pass `eligible` and Spoken_Grade and are not S2, at most 200, each `predicate: value`
 *     of at most 160 characters, with up to 4 root Spans whose Slice is not S2 and the Memory's own Ref.
 *   - Lines are packed in order until the 8,000-token input cap; anything left out sets `truncated`.
 *   - A statement survives only if it has 1 to 4 citations and every one is a Ref or Span supplied in the packet.
 *     Its note carries the cited rows' rootKeys and dependsOn, and the highest Sensitivity among them.
 */
import { type Dependent, type DocRef, type EC, type Snapshot, eligible } from "./eligible";
import { PREFIX, estimateTokens } from "./extract";
import { maxSens } from "./lexicon";
import { renderedMemory } from "./memory-text";
import { type JsonSchema, jsonSchemaOf } from "./schema/json-schema";
import { type Class, Cov, ID, type RecallArgs, Ref, type Sens, Span } from "./schema/primitives";
import type { Evidence, Memory } from "./schema/records";
import { type Infer, arr, obj, oneOf, str, union, validate } from "./schema/v";
import type { RecallResult, W } from "./schema/wire";
import { spokenGrade } from "./spoken";
import { tokenize } from "./text";

export const RECALL_ALL_PROMPT =
  "Packet only/no action. Preserve source/guess/roles/time. Nearest is not proof; conflict=uncertain; unsupported=not_in_packet, not absence. No coverage/disclosure upgrade/outside facts. Tool is not permission. Why needs receipt. Cite supplied refs/spans.";
export const RECALL_INSTRUCTIONS = `${PREFIX}\n${RECALL_ALL_PROMPT}`;

export const RECALL_MAX_LINES = 200;
export const RECALL_LINE_CHARS = 160;
export const RECALL_INPUT_TOKEN_CAP = 8_000;
export const RECALL_OUTPUT_TOKEN_CAP = 768;
/**
 * The reader's deadline. Measured Nov 6 on the live bg model with 14 lines: effort low p50 2.6 s, effort none p50
 * 1.7 s, so the contract's 1.5 s timed out on most reads and every timeout answered "nothing saved". The read now
 * runs at effort none with up to 2.5 s, and a timeout falls back to code-ranked excerpts (`recallExcerpts`).
 */
export const RECALL_DEADLINE_MS = 2_500;
export const RECALL_EFFORT = "none";
export const RECALL_MAX_NOTES = 4;
const MAX_ROOTS = 4;

// ---------------------------------------------------------------------------------------------
// Asked test (memory-spec §6 "Asked is decided by code"; contracts §5 explicitRequest)

/**
 * The recall's terms and aliases: query tokens plus entity label tokens. One-character tokens are left out: the
 * tokenizer splits "dog's" into "dog" and "s", and a lone "s" or "i" would make almost any Turn count as asked.
 */
export function recallTerms(args: Pick<RecallArgs, "query" | "entityRefs">): Set<string> {
  const words = [args.query, ...args.entityRefs.flatMap((e) => (e.label === null ? [] : [e.label]))];
  return new Set(words.flatMap((w) => tokenize(w)).filter((t) => t.length > 1));
}

/**
 * R27.9: true only when the current user Turn's own words contain a recall term or alias, with the same
 * tokenizer as chunking, and the speaker is certain. This slice has no speaker model: a Turn committed under the
 * signed-in Owner's token counts as certain.
 */
export function explicitRequest(turnText: string | null, args: Pick<RecallArgs, "query" | "entityRefs">, speakerCertain = true): boolean {
  if (!speakerCertain || turnText === null) return false;
  const terms = recallTerms(args);
  return tokenize(turnText).some((t) => terms.has(t));
}

// ---------------------------------------------------------------------------------------------
// Lines and packet

export interface RecallRow {
  id: ID;
  memory: Memory;
}

export interface PacketItem {
  id: ID;
  text: string;
  roots: Infer<typeof Span>[];
  refs: Infer<typeof Ref>[];
  class: Class;
  sens: Sens;
}

export interface RecallLine {
  item: PacketItem;
  rootKeys: ID[];
  dependsOn: string[];
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** One recall line's text: the Memory's stored plain-English line, single-line, at most 160 characters. */
export function recallLineText(m: Memory): string {
  return renderedMemory(m).slice(0, RECALL_LINE_CHARS);
}

/** Root Spans whose Slice is S0 or S1, quoting the Evidence text (R28.3: no S2 quote crosses). */
function rootSpans(m: Memory, evidence: ReadonlyMap<string, Evidence>): Infer<typeof Span>[] {
  const out: Infer<typeof Span>[] = [];
  for (const s of m.rootSlices) {
    if (out.length >= MAX_ROOTS) break;
    if (s.sens === "S2" || s.start === null || s.end === null || s.fieldPath !== "text") continue;
    const ev = evidence.get(s.eid);
    const text = ev?.text?.kind === "inline" ? ev.text.text : null;
    if (text === null || s.end > text.length) continue;
    const quote = text.slice(s.start, s.end);
    if (quote.length === 0 || quote.length > 512) continue;
    out.push({ eid: s.eid, fieldPath: s.fieldPath, start: s.start, end: s.end, quote });
  }
  return out;
}

/** The eligible, spoken-grade lines in a fixed order, and how many passed in all (for `truncated`). */
export function recallLines(
  rows: readonly RecallRow[],
  ec: EC,
  snapshot: Snapshot,
  evidence: ReadonlyMap<string, Evidence>,
): { lines: RecallLine[]; eligibleCount: number } {
  const passing: RecallRow[] = [];
  for (const r of rows) {
    const ref: DocRef = { collection: "memories", id: r.id, parentId: null, rev: r.memory.rev };
    const x: Dependent = { ref, row: r.memory };
    if (!eligible(x, { ...ec, stage: "project" }, snapshot).allow) continue;
    if (!spokenGrade(x, ec, snapshot).allow) continue;
    if (r.memory.sens === "S2") continue;
    passing.push(r);
  }
  passing.sort((a, b) => cmp(a.memory.predicate, b.memory.predicate) || cmp(a.memory.key, b.memory.key) || cmp(a.id, b.id));
  const lines = passing.slice(0, RECALL_MAX_LINES).map((r) => ({
    item: {
      id: r.id,
      text: recallLineText(r.memory),
      roots: rootSpans(r.memory, evidence),
      refs: [{ type: "memory" as const, id: r.id, rev: r.memory.rev }],
      class: r.memory.sourceClass,
      sens: r.memory.sens,
    },
    rootKeys: [...r.memory.rootKeys],
    dependsOn: [...r.memory.dependsOn],
  }));
  return { lines, eligibleCount: passing.length };
}

export type RecallPurpose = "answer" | "plan" | "why";

export interface RecallInput {
  query: string;
  purpose: RecallPurpose;
  packet: PacketItem[];
  coverage: { complete: boolean; truncated: boolean };
  allowedEntityIds: string[];
}

/** Packs lines in order while the whole input stays within 8,000 tokens (R27.4). */
export function packRecall(lines: readonly RecallLine[], eligibleCount: number, query: string, purpose: RecallPurpose): { input: RecallInput; used: RecallLine[]; truncated: boolean } {
  const base: RecallInput = { query, purpose, packet: [], coverage: { complete: true, truncated: false }, allowedEntityIds: [] };
  let tokens = estimateTokens(RECALL_INSTRUCTIONS) + estimateTokens(JSON.stringify(base)) + 8;
  const used: RecallLine[] = [];
  for (const line of lines) {
    const t = estimateTokens(JSON.stringify(line.item)) + 1;
    if (tokens + t > RECALL_INPUT_TOKEN_CAP) break;
    tokens += t;
    used.push(line);
  }
  const truncated = eligibleCount > used.length;
  return { input: { ...base, packet: used.map((l) => l.item), coverage: { complete: !truncated, truncated } }, used, truncated };
}

// ---------------------------------------------------------------------------------------------
// Output

const Citation = union(Span, Ref);
export const RecallOutput = obj({
  kind: oneOf(["supported", "uncertain", "not_in_packet"]),
  statements: arr(obj({ text: str(240), citations: arr(Citation, 4, 1), memoryIds: arr(ID, 4) }), 4),
  alternatives: arr(obj({ id: ID, label: str(80) }), 4),
});
export type RecallOutput = Infer<typeof RecallOutput>;

export function recallOutputJsonSchema(): JsonSchema {
  return jsonSchemaOf(RecallOutput);
}

/** The Responses request for one tool-less RecallAllV1 read (contracts §5: L, 8000/768; effort see RECALL_DEADLINE_MS). */
export function recallRequest(model: string, input: RecallInput) {
  return {
    model,
    reasoning: { effort: RECALL_EFFORT },
    store: false,
    tools: [],
    instructions: RECALL_INSTRUCTIONS,
    input: JSON.stringify(input),
    text: { format: { type: "json_schema", name: "RecallAllV1", strict: true, schema: recallOutputJsonSchema() } },
    max_output_tokens: RECALL_OUTPUT_TOKEN_CAP,
  };
}

export function parseRecallOutput(outputText: string | null): RecallOutput | null {
  if (outputText === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(outputText);
  } catch {
    return null;
  }
  const r = validate(RecallOutput, raw);
  return r.ok ? r.value : null;
}

type CitationT = Infer<typeof Citation>;

const sameSpan = (a: Infer<typeof Span>, b: CitationT) =>
  "eid" in b && a.eid === b.eid && a.fieldPath === b.fieldPath && a.start === b.start && a.end === b.end && a.quote === b.quote;
const sameRef = (a: Infer<typeof Ref>, b: CitationT) => "type" in b && a.type === b.type && a.id === b.id && a.rev === b.rev;

/** The packet line a citation names, or null when it was not supplied. */
function citedLine(c: CitationT, lines: readonly RecallLine[]): RecallLine | null {
  for (const l of lines) {
    if (l.item.refs.some((r) => sameRef(r, c)) || l.item.roots.some((s) => sameSpan(s, c))) return l;
  }
  return null;
}

export interface NoteContext {
  /** Builds the noteId of the n-th kept statement. */
  noteId: (n: number) => ID;
  expiresAt: string;
}

/** R27.6: keep only statements whose citations are all supplied refs or Spans; at most 4 notes. */
export function recallNotes(out: RecallOutput, used: readonly RecallLine[], ctx: NoteContext): W[] {
  const notes: W[] = [];
  for (const st of out.statements) {
    if (notes.length >= RECALL_MAX_NOTES) break;
    const text = st.text.trim();
    if (text === "" || st.citations.length === 0) continue;
    const cited = st.citations.map((c) => citedLine(c, used));
    if (cited.some((l) => l === null)) continue;
    const rows = [...new Set(cited as RecallLine[])];
    let sens: Sens = "S0";
    for (const r of rows) sens = maxSens(sens, r.item.sens);
    notes.push({
      noteId: ctx.noteId(notes.length),
      rev: 1,
      kind: "result",
      text,
      rootKeys: [...new Set(rows.flatMap((r) => r.rootKeys))].slice(0, 128),
      dependsOn: [...new Set(rows.flatMap((r) => r.dependsOn))].slice(0, 256),
      sens,
      expiresAt: ctx.expiresAt,
      unprompted: false,
      momentId: null,
      tokens: [],
    });
  }
  return notes;
}

/** Words that carry no topic: question words, fillers and the word every stored line has ("owner"). */
const EXCERPT_STOP = new Set([
  "what", "whats", "who", "whos", "where", "when", "which", "how", "why", "the", "and", "for", "you", "your", "did", "does", "doe", "have", "has",
  "had", "about", "tell", "know", "remember", "recall", "saved", "save", "called", "call", "owner", "owners", "that", "this", "with", "are", "was",
  "were", "can", "could", "would", "will", "please", "again", "said", "say", "told", "any", "all", "there",
]);

/**
 * Code-only excerpts (contracts §5 Recall readers: a failed read gives excerpts, not silence). The supplied lines
 * that share a topic word with the query or the Owner's question, best overlap first, at most 4. Each note is a
 * stored line verbatim, carrying that line's lineage and sensitivity, so nothing new is said.
 */
export function recallExcerpts(query: string, turnText: string | null, used: readonly RecallLine[], ctx: NoteContext): W[] {
  const terms = new Set(tokenize(`${query} ${turnText ?? ""}`).filter((t) => t.length > 2 && !EXCERPT_STOP.has(t)));
  if (terms.size === 0) return [];
  const scored = used
    .map((line, i) => ({ line, i, score: new Set(tokenize(line.item.text).filter((t) => terms.has(t))).size }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, RECALL_MAX_NOTES);
  return scored.map(({ line }, n) => ({
    noteId: ctx.noteId(n),
    rev: 1,
    kind: "result" as const,
    text: line.item.text,
    rootKeys: line.rootKeys.slice(0, 128),
    dependsOn: line.dependsOn.slice(0, 256),
    sens: line.item.sens,
    expiresAt: ctx.expiresAt,
    unprompted: false,
    momentId: null,
    tokens: [],
  }));
}

const coverage = (state: Infer<typeof Cov>["state"]): Infer<typeof Cov> => ({ state, from: null, to: null, missingRanges: [], generation: 0 });

/** The `recall` ToolResult (R27.5, R27.7). */
export function recallResult(notes: W[], state: "complete" | "partial" | "unknown", truncated: boolean): Infer<typeof RecallResult> {
  return { name: "recall", notes, coverage: coverage(state), truncated, cursor: null, pendingId: null, snapshot: null, cards: [] };
}
