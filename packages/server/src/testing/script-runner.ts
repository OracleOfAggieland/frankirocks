/**
 * The script runner (brief 029; spec §13 "Score what's said, not recall"). A script is data: a sequence of steps
 * (load the seed, open a session, type or say a line, press a chip, a trusted tap, call a tool, advance the world
 * clock, a limb event, run the worker, read the screen's route), each with the model answers it assumes and the
 * assertions that follow it.
 *
 * It drives the real route functions over the in-memory store, with the fake ports and the fixture clock. It never
 * starts a server and never calls a model: every model answer is written in the script beside the step that needs
 * it, and a step that makes a model call it did not declare (or declares one it never makes) fails.
 *
 * Expected-fail steps: a step marked `waits` is one the merged build cannot do yet. In the green run its actions
 * still run but its assertions are not checked; each such step is checked in its own `it.fails` test, which runs
 * the script up to and including that step and fails only at that step (an earlier failure turns the test red).
 */
import {
  type Evidence,
  type ID,
  type Ledger,
  type Memory,
  type CoreRules,
  type CoreState,
  canonicalJSON,
  msFromTs,
} from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, it } from "vitest";
import { ensureCoreDocs } from "../core-docs";
import { type OpenAIEndpoint, type ScriptedResult, ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { closeRoute } from "../routes/close";
import { memoryRoute } from "../routes/memory";
import { openRoute } from "../routes/open";
import type { RouteContext } from "../routes/runtime";
import { seedResetRoute } from "../routes/seed-reset";
import { toolRoute } from "../routes/tool";
import { turnRoute } from "../routes/turn";
import { buildSeed } from "../seed/build";
import { listTenantRows } from "../seed/clear";
import { relInstant } from "../seed/clock";
import { setWorldClock } from "../seed/clock-state";
import { type BankLine, type CalendarLine, type MailLine, type RelTime, type SeedFixture, at } from "../seed/fixture";
import { PERSONA, PERSONA_FIXTURE_ID } from "../seed/persona";
import { paths } from "../store/paths";
import { turnEvidenceId } from "../turns";
import { runDueJobs } from "../worker/tick";
import { drainExtractJobs } from "../worker/drain";
import { decisionAnswer } from "./decisions";
import { extractOutput } from "./extract-fixtures";
import { type TestRig, callRoute, runScheduled, settle, testRig } from "./fakes";

export const SCRIPT_UID = "owner-1";
/** The seed's zone in every script. */
export const SCRIPT_ZONE = "America/Chicago";

// ---------------------------------------------------------------------------------------------
// Outputs: everything Franki says, shows or hands back, in one list.

export type Channel = "note" | "card" | "proactive" | "tool" | "read" | "head" | "model" | "probe";

export interface Output {
  step: string;
  channel: Channel;
  /** Spoken or shown text where there is one, else the canonical JSON. */
  text: string;
  /** The canonical JSON of the whole thing, for ID checks. */
  json: string;
}

// ---------------------------------------------------------------------------------------------
// The world a script runs in.

export interface World {
  rig: TestRig;
  uid: string;
  zone: string;
  /** Set by the `seed` step. */
  namespace: ID | null;
  /** The clone's Friday as a local date (from the seed's world start). */
  friday: string | null;
  sessionId: string | null;
  stamp: { sessionId: string; epoch: number; policyRev: number; bundleRev: number; rulesRev: number; generation: number } | null;
  nextSeq: number;
  lastTurn: { turnId: string; text: string; source: "typed" | "asr" } | null;
  outputs: Output[];
  /** The last route answer of each step, by step label. */
  answers: Map<string, { status: number; body: any }>;
  /** Named values a step leaves for a later one (a pending ID, a loop ID). */
  vars: Map<string, unknown>;
  ctx: RouteContext;
  counter: number;
}

// ---------------------------------------------------------------------------------------------
// Model answers, declared per step.

export interface Answer {
  endpoint: OpenAIEndpoint;
  /** What the model is assumed to say, in plain words, for the reader of the script. */
  why: string;
  result: ScriptedResult | ((w: World) => ScriptedResult);
}

/** The typed reply's Responses answer. */
export const reply = (text: string): Answer => ({ endpoint: "responses.create", why: `reply: "${text}"`, result: ok(completed(text)) });

/** The slow parse's Decisions answer. Probabilities default to 0.01 each: an ordinary line. */
export const parse = (p: Parameters<typeof decisionAnswer>[0] = {}, why = "parse: ordinary"): Answer => ({ endpoint: "decisions.create", why, result: ok(decisionAnswer(p)) });

/** A span over the last user turn's text: `quote` at its `nth` occurrence. */
export function spanOf(w: World, quote: string, nth = 0) {
  const turn = lastTurn(w);
  let at = -1;
  for (let i = 0; i <= nth; i++) at = turn.text.indexOf(quote, at + 1);
  if (at < 0) throw new Error(`spanOf: "${quote}" is not in "${turn.text}"`);
  return { eid: turnEvidenceId(turn.turnId as ID, w.rig.deps.hasher), fieldPath: "text" as const, start: at, end: at + quote.length, quote };
}

function lastTurn(w: World) {
  if (w.lastTurn === null) throw new Error("no user turn yet");
  return w.lastTurn;
}

/** The extraction's Responses answer for the last user turn: ExtractV1 items built against that turn's Evidence. */
export const extract = (why: string, items: (w: World) => unknown[]): Answer => ({
  endpoint: "responses.create",
  why: `extract: ${why}`,
  result: (w) => ok(completed(JSON.stringify(extractOutput(items(w))))),
});

// ---------------------------------------------------------------------------------------------
// Assertions.

/**
 * Spoken templates, by ID. A template is matched on its fixed words, never on loose wording; `numbers` then pins the
 * figures. A template the build has no wording for yet is `null`: a script that asks for it fails, naming the wait.
 */
export const TEMPLATES = {
  /** patterns/words.ts heroOfferLine. */
  "hero.offer": /You've spent \$[\d,.]+ on takeout in this window, mostly on (nights|days) with meetings after 6\./,
  /** patterns/words.ts comparisonLines, first line. */
  "hero.comparison": /Takeout's \$[\d,.]+, down from \$[\d,.]+ over the same /,
  /** patterns/words.ts comparisonLines, second line. */
  "hero.less": /\$[\d,.]+ less on takeout\./,
  /** The Lab's sentence (spec §15 beat 4): read {n} emails, guessed {g} private things, said {s}. No server wording. */
  "lab.line": null,
  /** An occasion's wish on open (spec §15 beat 1). No moment wording on the server yet (brief 023, 024). */
  "occasion.wish": null,
  /** The check-in after an occasion (spec §15 beat 2). No moment wording yet (brief 023, 024). */
  "occasion.checkin": null,
  /** "Gone." after a completed forget (spec §8 step 7). Reserved in brief 021. */
  "forget.gone": null,
  /** Care before help on a hard disclosure (spec §15 beat 4). Persona and policy wording: brief 024. */
  "care.first": null,
} as const satisfies Record<string, RegExp | null>;
export type TemplateId = keyof typeof TEMPLATES;

export type Say =
  | { template: TemplateId; numbers?: string[]; channel?: Channel; times?: number }
  | { numbers: string[]; channel?: Channel; times?: number }
  | { note: true }
  | { card: string };

/** Something that must never be said: a token (case-insensitive) or the IDs of the Memories a selector picks. */
export type Never = string | { memory: string; pick: (m: Memory, id: string) => boolean };

export type Expectation =
  | { mustSay: Say }
  | { neverSay: Never[]; channels?: Channel[] }
  | { mayUse: { what: string; pick: (m: Memory, id: string) => boolean } }
  | { store: string; check: (w: World) => Promise<true | string> }
  | { lab: Partial<Record<LabField, number | ((w: World) => number)>> }
  | { status: number };

export type LabField = "readEmails" | "privateGuesses" | "guessLinesSpoken" | "delivered" | "held" | "blocked";

// ---------------------------------------------------------------------------------------------
// Steps.

export type Action =
  | { do: "seed"; visit: string }
  | { do: "open" }
  | { do: "close" }
  | { do: "type"; text: string }
  | { do: "say"; text: string }
  | { do: "chip"; text: string }
  | { do: "tap"; control: string }
  | { do: "tool"; tool: (w: World) => { name: string; args: unknown } }
  | { do: "advance"; to: RelTime; label: string }
  | { do: "mail"; lines: MailLine[] }
  | { do: "bank"; lines: BankLine[] }
  | { do: "calendar"; lines: CalendarLine[] }
  | { do: "work" }
  | { do: "read"; view: "overview" | "lab" | "strip" | "receipt" | "item" | "why"; id?: (w: World) => string }
  /** A built function that no route calls yet. Each probe is a finding: the seam is built and unwired. */
  | { do: "probe"; name: string; run: (w: World) => Promise<unknown> }
  /** Setup that stands in for a missing writer. Each is named in the report. */
  | { do: "setup"; what: string; run: (w: World) => Promise<void> };

export type Step = Action & {
  label: string;
  answers?: Answer[];
  expect?: Expectation[];
  /** The seam or lane this step waits for. Its assertions are expected to fail today. */
  waits?: string;
};

export interface Script {
  name: string;
  /** The spec line or beat it scores. */
  scores: string;
  steps: Step[];
  /** Checked against every output from the step labeled `from` (or the first step) to the end. */
  neverSay?: { from?: string; tokens: Never[]; channels?: Channel[] };
}

export class ScriptFailure extends Error {
  constructor(
    readonly script: string,
    readonly step: string,
    readonly expectation: string,
    readonly actual: string,
  ) {
    super(`script "${script}", step "${step}"\n  expected: ${expectation}\n  actual:   ${actual}`);
    this.name = "ScriptFailure";
  }
}

// ---------------------------------------------------------------------------------------------
// Running.

export interface RunOptions {
  /** Check this waiting step's assertions and stop after it. */
  check?: string;
}

export function newWorld(): World {
  const rig = testRig();
  return {
    rig,
    uid: SCRIPT_UID,
    zone: SCRIPT_ZONE,
    namespace: null,
    friday: null,
    sessionId: null,
    stamp: null,
    nextSeq: 1,
    lastTurn: null,
    outputs: [],
    answers: new Map(),
    vars: new Map(),
    ctx: { uid: SCRIPT_UID, deps: rig.deps, schedule: rig.sched.schedule },
    counter: 0,
  };
}

/** Runs a script. Resolves with the world, or throws a ScriptFailure at the first failed assertion. */
export async function runScript(script: Script, opts: RunOptions = {}): Promise<World> {
  const w = newWorld();
  if (opts.check !== undefined && !script.steps.some((s) => s.label === opts.check && s.waits !== undefined)) {
    throw new Error(`runScript: no waiting step "${opts.check}" in ${script.name}`);
  }
  for (const step of script.steps) {
    const checked = step.waits === undefined || step.label === opts.check;
    try {
      await runStep(script, step, w, checked);
      if (checked && script.neverSay !== undefined) await checkScriptNever(script, w, step.label);
    } catch (error) {
      if (opts.check !== undefined && step.label !== opts.check) {
        // A failure before the step under check is not the expected one: log it and return, so `it.fails` turns red.
        console.error(`expected-fail run of "${script.name}" broke before "${opts.check}":`, error);
        return w;
      }
      throw error;
    }
    if (step.label === opts.check) break;
  }
  return w;
}

async function runStep(script: Script, step: Step, w: World, checked: boolean): Promise<void> {
  const before = w.rig.openai.requests.length;
  const declared = new Map<OpenAIEndpoint, number>();
  const endpoints: OpenAIEndpoint[] = ["responses.create", "decisions.create", "realtime.calls.create", "realtime.calls.hangup"];
  for (const e of endpoints) w.rig.openai.drain(e);
  for (const a of step.answers ?? []) {
    w.rig.openai.script(a.endpoint, typeof a.result === "function" ? a.result(w) : a.result);
    declared.set(a.endpoint, (declared.get(a.endpoint) ?? 0) + 1);
  }
  const outputsBefore = w.outputs.length;
  const res = await act(step, w);
  const made = w.rig.openai.requests.slice(before);
  for (const r of made) push(w, step.label, "model", r.body);
  if (res !== null) w.answers.set(step.label, res);
  for (const e of endpoints) w.rig.openai.drain(e);

  // Model calls: exactly the declared ones, in this step. Checked in every run, waiting or not, because an
  // undeclared answer would make the script lie about what the model said.
  for (const e of endpoints) {
    const n = made.filter((r) => r.endpoint === e).length;
    const d = declared.get(e) ?? 0;
    if (n !== d) {
      const why = (step.answers ?? []).filter((a) => a.endpoint === e).map((a) => a.why);
      fail(script, step, `${d} ${e} call(s) as declared (${why.join("; ") || "none"})`, `${n} call(s)`);
    }
  }
  if (!checked) return;
  const mine = w.outputs.slice(outputsBefore);
  if (res !== null && !(step.expect ?? []).some((e) => "status" in e) && res.status !== 200) {
    fail(script, step, "HTTP 200", `${res.status} ${canonicalJSON(res.body)}`);
  }
  for (const e of step.expect ?? []) await assertOne(script, step, w, mine, res, e);
}

function fail(script: Script, step: Step, expectation: string, actual: string): never {
  throw new ScriptFailure(script.name, step.label, expectation, actual);
}

function push(w: World, step: string, channel: Channel, value: unknown, text?: string) {
  const json = typeof value === "string" ? value : canonicalJSON(value);
  w.outputs.push({ step, channel, text: text ?? json, json });
}

function nextId(w: World, kind: string) {
  w.counter += 1;
  return testId(`${kind}-${w.counter}`);
}

type Res = { status: number; body: any } | null;

async function act(step: Step, w: World): Promise<Res> {
  const { rig } = w;
  switch (step.do) {
    case "seed": {
      await ensureCoreDocs(w.uid, rig.deps, w.zone);
      const res = await callRoute(rig, seedResetRoute, { requestId: nextId(w, "reset"), sessionId: null, fixtureId: PERSONA_FIXTURE_ID, visitId: testId(`visit-${step.visit}`) });
      if (res.status === 200) {
        w.namespace = res.body.fixtureNamespace;
        const state = (await rig.store.get<CoreState>(w.uid, paths.core(w.uid, "state")))!.data;
        w.friday = localDateOf(msFromTs(state.worldClock!), w.zone);
      }
      return { status: res.status, body: res.body };
    }
    case "open": {
      const res = await callRoute(rig, openRoute, { requestId: nextId(w, "open"), initiator: "user", previousSessionId: w.sessionId, clientZone: w.zone, visitId: null });
      if (res.status === 200 && res.body.deck !== null) {
        const deck = res.body.deck;
        w.sessionId = res.body.sessionId;
        w.stamp = { sessionId: res.body.sessionId, epoch: deck.epoch, policyRev: deck.policyRev, bundleRev: deck.bundleRev, rulesRev: deck.rulesRev, generation: 1 };
        w.nextSeq = 1;
        push(w, step.label, "head", deck.head, deck.head.text);
      }
      if (res.status === 200 && res.body.proactive !== null) push(w, step.label, "proactive", res.body.proactive, proactiveText(res.body.proactive));
      return res;
    }
    case "close": {
      if (w.sessionId === null) throw new Error("close: no session");
      return callRoute(rig, closeRoute, { requestId: nextId(w, "close"), sessionId: w.sessionId, generation: 1, reason: "user" });
    }
    case "type":
    case "chip":
    case "say":
    case "tap":
      return turn(step, w);
    case "tool": {
      if (w.stamp === null || w.lastTurn === null) throw new Error("tool: no turn");
      const res = await callRoute(rig, toolRoute, { requestId: nextId(w, "tool"), stamp: { ...w.stamp, turnId: w.lastTurn.turnId }, callId: "call_1", tool: step.tool(w) });
      if (res.status === 200) {
        push(w, step.label, "tool", res.body.result ?? null);
        for (const n of res.body.notes ?? []) push(w, step.label, "note", n, n.text);
        for (const c of res.body.result?.cards ?? []) push(w, step.label, "card", c, cardText(c));
      }
      return res;
    }
    case "advance": {
      if (w.namespace === null || w.friday === null) throw new Error("advance: no seed");
      const to = relInstant(w.friday, step.to, w.zone);
      await rig.store.transaction(w.uid, (tx) => setWorldClock(tx, w.uid, w.namespace!, to, rig.clock.read().opsClock.now));
      return null;
    }
    case "mail":
    case "bank":
    case "calendar":
      await arrive(w, step.lines);
      return null;
    case "work":
      await work(w);
      return null;
    case "read": {
      const qs = new URLSearchParams({ view: step.view, ...(step.id === undefined ? {} : { id: step.id(w) }) });
      const res = await callRoute(rig, memoryRoute, undefined, { method: "GET", url: `http://localhost:3000/api/memory?${qs}`, origin: null });
      if (res.status === 200) {
        push(w, step.label, "read", res.body);
        for (const c of res.body.items ?? []) push(w, step.label, "card", c, cardText(c));
        for (const n of res.body.snapshot?.overview?.recentTold ?? []) push(w, step.label, "note", n, n.text);
      }
      return res;
    }
    case "probe": {
      const value = await step.run(w);
      push(w, step.label, "probe", value ?? null);
      w.vars.set(step.name, value);
      return null;
    }
    case "setup":
      await step.run(w);
      return null;
    default:
      step satisfies never;
      return null;
  }
}

async function turn(step: Step & { do: "type" | "chip" | "say" | "tap" }, w: World): Promise<Res> {
  if (w.stamp === null) throw new Error(`${step.do}: no session`);
  const seq = w.nextSeq;
  const turnId = nextId(w, "turn");
  const text = step.do === "tap" ? "" : step.text;
  const base = {
    ...w.stamp,
    turnId,
    requestId: nextId(w, "req"),
    clientSeq: seq,
    source: "typed",
    items: [] as unknown[],
    utteredWorldAt: "2026-11-03T12:00:00.000Z",
    transcript: text,
    transcriptState: "final",
    judge: "typed",
    pendingId: null,
    choiceId: null,
    supersedesRequestId: null,
    uiControl: null as unknown,
  };
  let body: Record<string, unknown> = base;
  // A chip's text counts as the owner's words and goes down the typed path (spec §15; brief 020 task 5).
  if (step.do === "say") body = { ...base, source: "asr", judge: "timeout", items: [{ itemId: `item_${seq}_${w.counter}`, commitSeq: seq, final: true, audioEndOpsAt: "2026-11-03T12:00:00.000Z", audioDurationMs: 800 }] };
  if (step.do === "tap") body = { ...base, source: "trustedTap", judge: "typed", transcriptState: "final", transcript: step.control, uiControl: step.control };
  const res = await callRoute(w.rig, turnRoute, body);
  if (res.status === 200 && res.body.status !== "stale" && res.body.status !== "hold") {
    w.nextSeq = seq + 1;
    w.lastTurn = { turnId, text, source: step.do === "say" ? "asr" : "typed" };
    if (res.body.stamp !== undefined) w.stamp = { ...w.stamp, epoch: res.body.stamp.epoch, policyRev: res.body.stamp.policyRev, bundleRev: res.body.stamp.bundleRev, rulesRev: res.body.stamp.rulesRev };
  }
  if (res.status === 200) {
    for (const n of res.body.notes ?? []) push(w, step.label, "note", n, n.text);
    for (const c of res.body.cards ?? []) push(w, step.label, "card", c, cardText(c));
    if (res.body.deck?.head !== undefined && res.body.deck !== null) push(w, step.label, "head", res.body.deck.head, res.body.deck.head.text);
  }
  return res;
}

/** Runs the worker until idle: scheduled work, due jobs, the extraction drain, then scheduled work again. */
export async function work(w: World): Promise<void> {
  const { rig } = w;
  for (let i = 0; i < 4; i++) {
    await runScheduled(rig);
    await settle(runDueJobs(w.ctx), rig.clock, rig.timers);
    await settle(drainExtractJobs(w.uid, rig.deps), rig.clock, rig.timers);
    if (rig.sched.pending === 0) break;
  }
  await runScheduled(rig);
}

/** A limb event: rows arrive the way the seed writes them (the one load's builder), in the clone's namespace. */
async function arrive(w: World, lines: (MailLine | BankLine | CalendarLine)[]): Promise<void> {
  if (w.namespace === null) throw new Error("limb event: no seed");
  const state = (await w.rig.store.get<CoreState>(w.uid, paths.core(w.uid, "state")))!.data;
  const epoch = (await w.rig.store.get<{ epoch: number; policyRev: number }>(w.uid, paths.core(w.uid, "epoch")))!.data;
  const fixture: SeedFixture = { id: PERSONA.id, origin: "authored", windowDays: PERSONA.windowDays, lines };
  const worldStart = relInstant(w.friday!, at(0, "08:40"), w.zone);
  const rows = await buildSeed(fixture, {
    uid: w.uid,
    namespace: w.namespace,
    zone: w.zone,
    worldStart,
    opsNow: w.rig.clock.read().opsClock.now,
    core: { epoch: epoch.epoch, policyRev: epoch.policyRev },
    hasher: w.rig.deps.hasher,
  });
  void state;
  await w.rig.store.transaction(w.uid, async (tx) => {
    for (const g of rows.groups) {
      for (const wr of g.writes) {
        // A calendar move writes only the revisions not already stored; the current flag moves to the newest.
        const existing = await tx.get<Evidence>(wr.path);
        if (existing === null) tx.create(wr.path, wr.record);
        else if (canonicalJSON(existing.data) !== canonicalJSON(wr.record)) tx.update(wr.path, wr.record);
      }
    }
  });
}

function localDateOf(ms: number, zone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
}

function proactiveText(p: unknown): string {
  const o = p as { text?: string; line?: string } | null;
  return o?.text ?? o?.line ?? canonicalJSON(p);
}

function cardText(c: unknown): string {
  const o = c as { title?: string; lines?: string[] };
  return [o.title ?? "", ...(o.lines ?? [])].join(" | ");
}

// ---------------------------------------------------------------------------------------------
// Assertions.

const SPOKEN: Channel[] = ["note", "card", "proactive", "tool", "read", "probe"];
const DEFAULT_NEVER: Channel[] = ["note", "card", "proactive", "tool", "read", "head"];

function summary(outputs: readonly Output[], channels: readonly Channel[] = SPOKEN): string {
  const rows = outputs.filter((o) => channels.includes(o.channel)).map((o) => `[${o.channel}] ${o.text.slice(0, 240)}`);
  return rows.length === 0 ? "nothing" : rows.join("\n            ");
}

async function assertOne(script: Script, step: Step, w: World, mine: Output[], res: Res, e: Expectation): Promise<void> {
  if ("status" in e) {
    if (res === null || res.status !== e.status) fail(script, step, `HTTP ${e.status}`, res === null ? "no route call" : `${res.status} ${canonicalJSON(res.body)}`);
    return;
  }
  if ("mustSay" in e) return mustSay(script, step, mine, e.mustSay);
  if ("neverSay" in e) return neverSay(script, step, w, mine, e.neverSay, e.channels ?? DEFAULT_NEVER);
  if ("mayUse" in e) {
    const memories = await allMemories(w);
    const allowed = new Set(memories.filter((m) => e.mayUse.pick(m.data, m.id)).map((m) => m.id));
    const used = memories.filter((m) => mine.some((o) => o.channel !== "head" && o.channel !== "model" && o.json.includes(m.id))).map((m) => m.id);
    const extra = used.filter((id) => !allowed.has(id));
    if (extra.length > 0) fail(script, step, `outputs draw only on ${e.mayUse.what}`, `also on ${extra.map((id) => memoryLabel(memories, id)).join("; ")}`);
    return;
  }
  if ("store" in e) {
    const r = await e.check(w);
    if (r !== true) fail(script, step, e.store, r);
    return;
  }
  if ("lab" in e) {
    const res2 = await callRoute(w.rig, memoryRoute, undefined, { method: "GET", url: "http://localhost:3000/api/memory?view=lab", origin: null });
    if (res2.status !== 200 || res2.body.lab === null) fail(script, step, "the Lab view", `${res2.status} ${canonicalJSON(res2.body)}`);
    for (const [k, v] of Object.entries(e.lab)) {
      const want = typeof v === "function" ? v(w) : v;
      const got = res2.body.lab[k];
      if (got !== want) fail(script, step, `Lab ${k} = ${want}`, `Lab ${k} = ${got} (${canonicalJSON(res2.body.lab)})`);
    }
    return;
  }
  e satisfies never;
}

function mustSay(script: Script, step: Step, mine: Output[], say: Say): void {
  if ("note" in say) {
    if (!mine.some((o) => o.channel === "note")) fail(script, step, "a reply note", summary(mine));
    return;
  }
  if ("card" in say) {
    if (!mine.some((o) => o.channel === "card" && o.text.includes(say.card))) fail(script, step, `a card titled "${say.card}"`, summary(mine));
    return;
  }
  const pool = mine.filter((o) => SPOKEN.includes(o.channel) && (say.channel === undefined || o.channel === say.channel));
  let matcher: RegExp | null = null;
  if ("template" in say) {
    matcher = TEMPLATES[say.template];
    if (matcher === null) fail(script, step, `template ${say.template}`, `the build has no wording for ${say.template} yet; ${summary(mine)}`);
  }
  const hits = pool.filter((o) => (matcher === null || matcher.test(o.text)) && (say.numbers ?? []).every((n) => o.text.includes(n)));
  const want = say.times ?? null;
  const label = `${"template" in say ? `template ${say.template}` : "a line"}${say.numbers === undefined ? "" : ` with ${say.numbers.join(", ")}`}${say.channel === undefined ? "" : ` on ${say.channel}`}${want === null ? "" : `, ${want} time(s)`}`;
  if (want === null ? hits.length === 0 : hits.length !== want) fail(script, step, label, summary(mine));
}

async function neverSay(script: Script, step: Step, w: World, outputs: Output[], tokens: Never[], channels: readonly Channel[]): Promise<void> {
  const pool = outputs.filter((o) => channels.includes(o.channel));
  const memories = tokens.some((t) => typeof t !== "string") ? await allMemories(w) : [];
  for (const t of tokens) {
    if (typeof t === "string") {
      const hit = pool.find((o) => o.text.toLowerCase().includes(t.toLowerCase()) || o.json.toLowerCase().includes(t.toLowerCase()));
      if (hit !== undefined) fail(script, step, `never "${t}" on ${channels.join(", ")}`, `[${hit.channel} at ${hit.step}] ${hit.text.slice(0, 400)}`);
    } else {
      const ids = memories.filter((m) => t.pick(m.data, m.id)).map((m) => m.id);
      for (const id of ids) {
        const hit = pool.find((o) => o.json.includes(id));
        if (hit !== undefined) fail(script, step, `never ${t.memory} (${id}) on ${channels.join(", ")}`, `[${hit.channel} at ${hit.step}] ${hit.text.slice(0, 400)}`);
      }
    }
  }
}

async function checkScriptNever(script: Script, w: World, label: string): Promise<void> {
  const n = script.neverSay!;
  const from = n.from === undefined ? 0 : script.steps.findIndex((s) => s.label === n.from);
  const at = script.steps.findIndex((s) => s.label === label);
  if (from < 0 || at < from) return;
  const labels = new Set(script.steps.slice(from, at + 1).filter((s) => s.waits === undefined || s.label === label).map((s) => s.label));
  const step = script.steps[at]!;
  await neverSay(script, step, w, w.outputs.filter((o) => labels.has(o.step)), n.tokens, n.channels ?? DEFAULT_NEVER);
}

// ---------------------------------------------------------------------------------------------
// Store reads for checks.

export async function allMemories(w: World): Promise<{ id: string; data: Memory }[]> {
  return (await listTenantRows(w.rig.store, w.uid)).filter((r) => r.path.includes("/memories/")).map((r) => ({ id: r.id, data: r.data as Memory }));
}

export async function allLedger(w: World): Promise<{ id: string; data: Ledger }[]> {
  return (await listTenantRows(w.rig.store, w.uid)).filter((r) => r.path.includes("/ledger/")).map((r) => ({ id: r.id, data: r.data as Ledger }));
}

export async function allEvidence(w: World): Promise<{ id: string; data: Evidence }[]> {
  return (await listTenantRows(w.rig.store, w.uid)).filter((r) => r.path.includes("/evidence/")).map((r) => ({ id: r.id, data: r.data as Evidence }));
}

export async function rulesOf(w: World): Promise<CoreRules> {
  return (await w.rig.store.get<CoreRules>(w.uid, paths.core(w.uid, "rules")))!.data;
}

export function memoryText(m: Memory): string {
  const v = m.value as { kind: string; text?: string; code?: string };
  return v.text ?? v.code ?? canonicalJSON(m.value);
}

function memoryLabel(memories: { id: string; data: Memory }[], id: string): string {
  const m = memories.find((x) => x.id === id);
  return m === undefined ? id : `${m.data.predicate} "${memoryText(m.data).slice(0, 60)}"`;
}

// ---------------------------------------------------------------------------------------------
// Registering a script with vitest.

/** The waiting steps of a script, in order. */
export const waitingSteps = (script: Script) => script.steps.filter((s): s is Step & { waits: string } => s.waits !== undefined);

/**
 * One `it` for the script's green steps, and one `it.fails` per waiting step. When a waiting step starts to pass,
 * its `it.fails` turns red: drop its `waits` in the commit that makes it pass.
 */
export function scriptSuite(script: Script): void {
  describe(`${script.name} (${script.scores})`, () => {
    it("green steps", async () => {
      await runScript(script);
    });
    for (const s of waitingSteps(script)) {
      it.fails(`expected-fail: ${s.label} (waits for ${s.waits})`, async () => {
        await runScript(script, { check: s.label });
      });
    }
  });
}

export type { ID };
