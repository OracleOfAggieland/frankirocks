/**
 * The extraction check (brief 012 wave A item 7, design task A10b). Runs ExtractV1 on the 30 frozen lines in
 * `lines.json` through a port that is fake unless `--live`, plans every Item with the extractor's own `planItem`,
 * and compares what would be written with each line's `writes` and `neverWrites`.
 *
 * The lines are frozen: `LINES_SHA256` pins the file, so a relabel fails the check's test, and the run refuses a
 * file that doesn't match. The pass count is a measurement, so a run that finishes exits 0 whatever it counts; only
 * a bad flag, a changed or malformed lines file, or a missing live setting exits 2.
 *
 * What a line "writes" is read the way the worker commits it: a `hold` plan (allergies and standing rules) is
 * `held`; a `memory` plan is its own status, and each target it closes becomes `wrong` (a correction) or `history`
 * (a change) through `statusTransition`. A live call is one call with no repair (the worker adds one repair call),
 * so the count is the first call's.
 *
 *   node scripts/extract-check/run.mjs            fake port: no network, every answer empty
 *   node --env-file=apps/web/.env.local scripts/extract-check/run.mjs --live
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type ClockPort,
  EXTRACT_DEADLINE_MS,
  type ExtractItem as ExtractItemT,
  ExtractItem,
  type ExtractPacket,
  type Hasher,
  type ItemPlan,
  type OpenRef,
  PREDICATE_SPECS,
  type PlanContext,
  buildExtractPacket,
  lookupAllergen,
  openRefOf,
  parseExtractOutput,
  planItem,
  resolveMention,
  statusTransition,
  turnTextSlice,
  validate,
} from "@franki/core";
import { sampleEvidence } from "@franki/core/testing";
import { liveClockPort } from "../../packages/server/src/clock/live-clock";
import { liveTimers, withDeadline } from "../../packages/server/src/clock/timers";
import type { Env } from "../../packages/server/src/config/env";
import { requireModel } from "../../packages/server/src/config/models";
import { createHasher } from "../../packages/server/src/crypto";
import { liveOpenAI } from "../../packages/server/src/openai/live";
import type { ResponsesResult } from "../../packages/server/src/openai/responses";
import { extractRequest } from "../../packages/server/src/worker/extract";

/** SHA-256 of lines.json with line endings as LF. A relabel changes it; fixing a wrong label means a new pin, in its own commit. */
export const LINES_SHA256 = "7bba56d2c6fab58478433bd947ddd9cca82716fbf81fbc0b3d182469340b0a0b";

/** The time every line is said at, so a run is repeatable. */
export const SPEECH_AT = "2026-11-11T17:00:00.000Z";
const NEXT_REVIEW_AT = "2027-11-11T17:00:00.000Z";
const UID = "extract-check";

export type CheckClass = "allergy" | "correction" | "lifeChange" | "nearMiss" | "ordinary";
const CLASSES: readonly CheckClass[] = ["allergy", "correction", "lifeChange", "nearMiss", "ordinary"];
type Status = "active" | "history" | "wrong" | "held";
const STATUSES: readonly Status[] = ["active", "history", "wrong", "held"];

/** What a line should or must never write. null means any. */
export interface Expect {
  predicate: string | null;
  subject: string | null;
  value: string | null;
  status: Status | null;
  target: string | null;
  names: string | null;
}

/** A row already saved, shown in `open` with its stored line. */
export interface Prior {
  ref: string;
  predicate: string;
  subject: string;
  value: string;
  names: string | null;
  line: string;
}

export interface CheckLine {
  id: string;
  class: CheckClass;
  text: string;
  prior: Prior[];
  writes: Expect[];
  neverWrites: Expect[];
}

// ---------------------------------------------------------------------------------------------
// The lines file

/** SHA-256 hex of the file's text with CRLF read as LF, so a checkout's line endings never change the pin. */
export function linesHash(text: string): string {
  return createHash("sha256").update(text.replace(/\r\n/g, "\n"), "utf8").digest("hex");
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const strOrNull = (v: unknown) => v === null || typeof v === "string";

function closedKeys(v: unknown, keys: readonly string[], where: string): Record<string, unknown> {
  if (!isObj(v)) throw new Error(`${where}: not an object`);
  const extra = Object.keys(v).filter((k) => !keys.includes(k));
  const missing = keys.filter((k) => !(k in v));
  if (extra.length > 0 || missing.length > 0) throw new Error(`${where}: ${[...extra.map((k) => `unknown ${k}`), ...missing.map((k) => `missing ${k}`)].join(", ")}`);
  return v;
}

function expectOf(v: unknown, where: string): Expect {
  const e = closedKeys(v, ["predicate", "subject", "value", "status", "target", "names"], where);
  for (const k of ["predicate", "subject", "value", "target", "names"] as const) if (!strOrNull(e[k])) throw new Error(`${where}.${k}: not a string or null`);
  if (e.status !== null && !STATUSES.includes(e.status as Status)) throw new Error(`${where}.status: ${String(e.status)}`);
  if (e.predicate !== null && !(e.predicate as string in PREDICATE_SPECS)) throw new Error(`${where}.predicate: ${String(e.predicate)}`);
  return e as unknown as Expect;
}

/** The lines, checked: a closed shape, known predicates and statuses, unique IDs, and targets that name a prior. */
export function parseLines(text: string): CheckLine[] {
  const top = closedKeys(JSON.parse(text), ["description", "version", "lines"], "lines.json");
  if (top.version !== 1 || !Array.isArray(top.lines)) throw new Error("lines.json: version 1 with a lines array");
  const seen = new Set<string>();
  return top.lines.map((raw, i) => {
    const l = closedKeys(raw, ["id", "class", "text", "prior", "writes", "neverWrites"], `lines[${i}]`);
    if (typeof l.id !== "string" || seen.has(l.id)) throw new Error(`lines[${i}].id: missing or repeated`);
    seen.add(l.id);
    if (!CLASSES.includes(l.class as CheckClass)) throw new Error(`${l.id}.class: ${String(l.class)}`);
    if (typeof l.text !== "string" || l.text.length === 0) throw new Error(`${l.id}.text: empty`);
    if (!Array.isArray(l.prior) || !Array.isArray(l.writes) || !Array.isArray(l.neverWrites)) throw new Error(`${l.id}: prior, writes and neverWrites are arrays`);
    const prior = l.prior.map((p, j) => {
      const r = closedKeys(p, ["ref", "predicate", "subject", "value", "names", "line"], `${l.id}.prior[${j}]`);
      if (typeof r.ref !== "string" || typeof r.subject !== "string" || typeof r.value !== "string" || typeof r.line !== "string" || !strOrNull(r.names)) throw new Error(`${l.id}.prior[${j}]: field types`);
      if (typeof r.predicate !== "string" || !(r.predicate in PREDICATE_SPECS)) throw new Error(`${l.id}.prior[${j}].predicate: ${String(r.predicate)}`);
      return r as unknown as Prior;
    });
    const writes = l.writes.map((e, j) => expectOf(e, `${l.id}.writes[${j}]`));
    const neverWrites = l.neverWrites.map((e, j) => expectOf(e, `${l.id}.neverWrites[${j}]`));
    for (const e of [...writes, ...neverWrites]) if (e.target !== null && !prior.some((p) => p.ref === e.target)) throw new Error(`${l.id}: target ${e.target} names no prior`);
    return { id: l.id, class: l.class as CheckClass, text: l.text, prior, writes, neverWrites };
  });
}

// ---------------------------------------------------------------------------------------------
// The packet and the plan context for one line

/** A fixed key: the check's IDs only need to be stable, never secret. */
const HASHER: Hasher = createHasher("extract-check-ids");

const priorId = (lineId: string, ref: string) => HASHER.id(["extract-check", "prior", lineId, ref]);
const subjectIdOf = (subject: string) => (subject === "self" ? "self" : HASHER.id(["mention", "person", subject.toLowerCase()]));

function priorRef(p: Prior): OpenRef {
  const spec = PREDICATE_SPECS[p.predicate as keyof typeof PREDICATE_SPECS];
  const value = spec.codes !== undefined && (spec.codes as readonly string[]).includes(p.value) ? { kind: "enum" as const, code: p.value } : { kind: "text" as const, text: p.value };
  return openRefOf({ rev: 1, predicate: p.predicate as never, kind: spec.kinds[0] as never, subjectId: subjectIdOf(p.subject), value: value as never });
}

/** The ExtractV1 packet for a line and the context `planItem` reads, exactly as the worker builds them for one turn. */
export function lineSetup(line: CheckLine): { packet: ExtractPacket; ctx: PlanContext; priorById: Map<string, Prior> } {
  const eid = HASHER.id(["extract-check", "turn", line.id]);
  const evidence = sampleEvidence({
    uid: UID,
    text: { kind: "inline", text: line.text },
    fieldSlices: [turnTextSlice(eid, line.text, "U", HASHER)],
    occurredAt: SPEECH_AT,
    assertedAt: SPEECH_AT,
    receivedAt: SPEECH_AT,
    zone: "UTC",
  });
  const jobId = HASHER.id(["extract-check", "job", line.id]);
  const priorById = new Map(line.prior.map((p) => [priorId(line.id, p.ref), p]));
  const open = [...priorById].map(([id, p]) => ({ id, rev: 1, kind: PREDICATE_SPECS[p.predicate as keyof typeof PREDICATE_SPECS].kinds[0] as string, rendered: p.line }));
  const packet = buildExtractPacket({ jobId, epoch: 1, policyRev: 1, eid, evidence, homeZone: "UTC", currentZone: null, open });
  const ctx: PlanContext = {
    uid: UID,
    jobId,
    packet: new Map([[eid, { evidence, fields: ["text"] }]]),
    hasher: HASHER,
    worldNow: SPEECH_AT,
    opsNow: SPEECH_AT,
    nextReviewAt: NEXT_REVIEW_AT,
    epoch: 1,
    policyRev: 1,
    open: new Map(line.prior.map((p) => [priorId(line.id, p.ref), priorRef(p)])),
    context: [...priorById.keys()].map((id) => ({ type: "memory" as const, id, rev: 1 })),
    zone: "UTC",
  };
  return { packet, ctx, priorById };
}

// ---------------------------------------------------------------------------------------------
// What would be written

/** One row a line's Items would write or change. */
export interface Seen {
  predicate: string;
  /** "self", or the words the Owner used for the person. */
  subject: string;
  value: string | null;
  status: Status;
  /** The prior a change closes, by its ref; null for the Item's own row. */
  target: string | null;
  /** Names the Item carries: its mentions and its value's words. */
  names: string[];
}

function valueWords(item: ExtractItemT): string | null {
  const v = item.value;
  switch (v.kind) {
    case "enum":
      return v.code;
    case "text":
      return v.text;
    case "entity":
      return item.mentions.find((m) => m.localId === v.mention)?.observedName ?? v.mention;
    case "number":
      return String(v.num);
    case "boolean":
      return String(v.bool);
    case "money":
      return String(v.amountMinor);
    case "none":
      return null;
  }
}

function subjectWords(item: ExtractItemT): string {
  if (resolveMention(item.subject, item, HASHER) === "self") return "self";
  return item.mentions.find((m) => m.localId === item.subject)?.observedName ?? item.subject;
}

/** The rows one Item's plan would write: none for a skip or a reject. */
export function seenOf(raw: unknown, plan: ItemPlan, priorById: ReadonlyMap<string, Prior>): Seen[] {
  if (plan.kind !== "hold" && plan.kind !== "memory") return [];
  const checked = validate(ExtractItem, raw);
  if (!checked.ok) return [];
  const item = checked.value;
  const value = valueWords(item);
  const names = [...item.mentions.map((m) => m.observedName), ...(value === null ? [] : [value])];
  if (plan.kind === "hold") return [{ predicate: item.predicate, subject: subjectWords(item), value, status: "held", target: null, names }];
  const own: Seen = { predicate: plan.memory.predicate, subject: subjectWords(item), value, status: plan.memory.status as Status, target: null, names };
  const closed: Seen[] = [];
  if (plan.change !== "none") {
    for (const id of plan.targetIds) {
      const p = priorById.get(id);
      const next = statusTransition("active", plan.change);
      if (p === undefined || next === "refuse") continue;
      closed.push({ predicate: p.predicate, subject: p.subject, value: p.value, status: next as Status, target: p.ref, names: p.names === null ? [] : [p.names] });
    }
  }
  return [own, ...closed];
}

/** Lower case, every run of non-letters and non-digits one space. */
const fold = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
/** Without "my", "the" or "the owner's" in front: "my son" and "son" name the same person. */
const bare = (s: string) => fold(s).replace(/^(the owner s|owner s|my|the)\s+/, "");
const hasWords = (hay: string, needle: string) => ` ${fold(hay)} `.includes(` ${fold(needle)} `);

/** Whether a row meets an expectation. null fields match anything. */
export function meets(e: Expect, s: Seen): boolean {
  if (e.predicate !== null && e.predicate !== s.predicate) return false;
  if (e.status !== null && e.status !== s.status) return false;
  if (e.target !== s.target && e.target !== null) return false;
  if (e.target === null && e.status !== null && s.target !== null) return false;
  if (e.subject !== null) {
    if ((e.subject === "self") !== (s.subject === "self")) return false;
    if (e.subject !== "self") {
      const [a, b] = [bare(e.subject), bare(s.subject)];
      if (a !== b && !hasWords(a, b) && !hasWords(b, a)) return false;
    }
  }
  if (e.value !== null) {
    const v = s.value ?? "";
    const ok = s.predicate === "allergy" ? v === e.value || lookupAllergen(v).includes(e.value) : fold(v) === fold(e.value) || hasWords(v, e.value);
    if (!ok) return false;
  }
  if (e.names !== null && !s.names.some((n) => hasWords(n, e.names!))) return false;
  return true;
}

export interface LineResult {
  id: string;
  class: CheckClass;
  result: "answered" | "failed";
  /** Why the call failed; null when it answered. */
  error: string | null;
  ms: number;
  pass: boolean;
  /** Indexes into `writes` that nothing met, and into `neverWrites` that something met. */
  missing: number[];
  forbidden: number[];
  /** How many Items came back, and what their plans were (never their words). */
  items: number;
  plans: ItemPlan["kind"][];
}

/** Judges one line's answer. A failed call writes nothing, so it passes only when the line expects nothing. */
export function judgeLine(line: CheckLine, answer: CallAnswer): LineResult {
  const { ctx, priorById } = lineSetup(line);
  const items = answer.ok ? answer.items : [];
  const plans = items.map((raw, i) => planItem(raw, i, ctx));
  const seen = items.flatMap((raw, i) => seenOf(raw, plans[i]!, priorById));
  const missing = line.writes.flatMap((e, i) => (seen.some((s) => meets(e, s)) ? [] : [i]));
  const forbidden = line.neverWrites.flatMap((e, i) => (seen.some((s) => meets(e, s)) ? [i] : []));
  return {
    id: line.id,
    class: line.class,
    result: answer.ok ? "answered" : "failed",
    error: answer.ok ? null : answer.error,
    ms: answer.ms,
    pass: missing.length === 0 && forbidden.length === 0,
    missing,
    forbidden,
    items: items.length,
    plans: plans.map((p) => p.kind),
  };
}

// ---------------------------------------------------------------------------------------------
// Ports

export type CallAnswer = { ok: true; items: unknown[]; ms: number } | { ok: false; error: string; ms: number };

export interface ExtractCheckPort {
  extract(packet: ExtractPacket): Promise<CallAnswer>;
}

/** No network: every answer is valid and empty at 0 ms. */
export function fakeExtractPort(): ExtractCheckPort {
  return { extract: async () => ({ ok: true, items: [], ms: 0 }) };
}

/** One ExtractV1 call with the worker's own request and deadline. Built only for `--live`. */
export function liveExtractPort(env: Env, clock: ClockPort = liveClockPort): ExtractCheckPort {
  const openai = liveOpenAI(env);
  const model = requireModel("brain", env);
  return {
    extract: async (packet) => {
      const start = clock.read().opsClock.now;
      const ms = () => clock.read().opsClock.now - start;
      let r: ResponsesResult;
      try {
        r = (await withDeadline(openai.call("responses.create", extractRequest(model, packet)), EXTRACT_DEADLINE_MS, liveTimers)) as ResponsesResult;
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.name : "error", ms: ms() };
      }
      if (r === null || typeof r !== "object") return { ok: false, error: "no result", ms: ms() };
      if (r.refusal !== null && r.refusal !== undefined) return { ok: false, error: "refusal", ms: ms() };
      if (r.status !== "completed") return { ok: false, error: `status ${String(r.status)}`, ms: ms() };
      const parsed = parseExtractOutput(r.outputText);
      return parsed.ok ? { ok: true, items: parsed.items, ms: ms() } : { ok: false, error: parsed.error, ms: ms() };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The run

export interface CheckCtx {
  /** The folder holding lines.json; results go under it. */
  dir: string;
  env: Env;
  log: (line: string) => void;
  /** Tests replace the fake; the CLI builds the live port only with --live. */
  port?: ExtractCheckPort;
  clock?: ClockPort;
}

export interface CheckRun {
  port: "fake" | "live";
  linesSha256: string;
  speechAt: string;
  rows: LineResult[];
  passed: number;
  byClass: Record<CheckClass, { pass: number; of: number }>;
}

export function summarizeRun(port: "fake" | "live", rows: LineResult[]): CheckRun {
  const byClass = Object.fromEntries(CLASSES.map((c) => [c, { pass: rows.filter((r) => r.class === c && r.pass).length, of: rows.filter((r) => r.class === c).length }])) as CheckRun["byClass"];
  return { port, linesSha256: LINES_SHA256, speechAt: SPEECH_AT, rows, passed: rows.filter((r) => r.pass).length, byClass };
}

export function rowLine(r: LineResult): string {
  const why = [r.missing.length > 0 ? `missing writes ${r.missing.join(", ")}` : "", r.forbidden.length > 0 ? `wrote neverWrites ${r.forbidden.join(", ")}` : ""].filter((s) => s !== "").join("; ");
  const call = r.result === "failed" ? `failed (${r.error})` : `${r.items} item(s) [${r.plans.join(", ")}]`;
  return `  ${r.id}: ${r.pass ? "pass" : "fail"}${why === "" ? "" : ` (${why})`}, ${call} in ${r.ms} ms`;
}

/** Runs the check. 0 when the run finished; 2 for a bad flag, a changed or malformed lines file, or no live setting. */
export async function main(argv: readonly string[], ctx: CheckCtx): Promise<number> {
  const unknown = argv.filter((a) => a !== "--live");
  if (unknown.length > 0) {
    ctx.log(`extract-check: unknown argument ${unknown.join(" ")}. Usage: run.mjs [--live]`);
    return 2;
  }
  const live = argv.includes("--live");
  const text = readFileSync(join(ctx.dir, "lines.json"), "utf8");
  const sha = linesHash(text);
  if (sha !== LINES_SHA256) {
    ctx.log(`extract-check: refusing: lines.json is not the frozen file (sha256 ${sha}, pinned ${LINES_SHA256}). Labels never change because of a result.`);
    return 2;
  }
  let lines: CheckLine[];
  try {
    lines = parseLines(text);
  } catch (e) {
    ctx.log(`extract-check: lines.json is malformed: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
  let port: ExtractCheckPort;
  try {
    port = ctx.port ?? (live ? liveExtractPort(ctx.env, ctx.clock) : fakeExtractPort());
  } catch (e) {
    ctx.log(`extract-check: can't start a live run: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
  ctx.log(`extract-check: ${lines.length} frozen lines through the ${live ? "LIVE ExtractV1 call (one call per line, no repair)" : "fake port (every answer empty, 0 ms; add --live to measure)"}`);
  const rows: LineResult[] = [];
  for (const line of lines) {
    const row = judgeLine(line, await port.extract(lineSetup(line).packet));
    rows.push(row);
    ctx.log(rowLine(row));
  }
  const run = summarizeRun(live ? "live" : "fake", rows);
  ctx.log(`extract-check: ${run.passed} of ${rows.length} lines pass${live ? "" : " (fake port: this counts the lines that expect no write, nothing more)"}`);
  ctx.log(`  by class: ${CLASSES.map((c) => `${c} ${run.byClass[c].pass} of ${run.byClass[c].of}`).join(", ")}`);
  const clock = ctx.clock ?? liveClockPort;
  const stamp = new Date(clock.read().opsClock.now).toISOString().replace(/[:.]/g, "-");
  const out = join(ctx.dir, ...(live ? ["results"] : ["dist", "dry-run"]));
  mkdirSync(out, { recursive: true });
  const file = join(out, `${stamp}-extract-check.json`);
  writeFileSync(file, `${JSON.stringify(run, null, 2)}\n`, "utf8");
  ctx.log(`extract-check: wrote ${file}`);
  return 0;
}
