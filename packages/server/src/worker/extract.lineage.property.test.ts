/**
 * Lineage property (R24.5, R24.6, R31.3; KC03, W-LINEAGE). Written before the extractor, and run red against the
 * task 11 stub; see tasks.md task 11 for the recorded seed and counterexample.
 *
 * FOR ALL sequences of 1–50 operations (user turn commits, Extract_Job runs, re-runs of the same job, and
 * Fake_OpenAI results with mismatched Span quotes, ranges, Evidence IDs and fields, invalid output, refusals and
 * errors) on the Memory_Store, every stored Memory resolves through `resolveLineage`, together with the Spans of the
 * Item that produced it, with zero failed links.
 */
import { type Memory, type Evidence, type Span, createFakeClock, idParts, resolveLineage, splitsSurrogate } from "@franki/core";
import { testId } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createHasher } from "../crypto";
import { FakeOpenAI, fail, ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { MemoryStore } from "../store/memory-store";
import { paths } from "../store/paths";
import type { StoredDoc } from "../store/port";
import { type CommittedTurn, type SpanDraft, commitUserTurnForTest, extractOutput, factItem } from "../testing/extract-fixtures";
import { runExtractJob } from "./extract";

const UID = "owner-1";
const FAKE_KEY = "test-only-franki-id-hmac-key-0000000000000";
const ENV = { FRANKI_BRAIN_MODEL: "test-brain-model", OPENAI_API_KEY: "test-not-a-key" };

// ---------------------------------------------------------------------------------------------
// Generators

/** Text with ASCII, accents, emoji (surrogate pairs), CRLF and lone CR. */
const textArb = fc
  .array(fc.constantFrom("a", "b", "Pip", " ", "é", "🐶", "😀", "\r\n", "\r", "\n", ".", "My dog ", "is "), { minLength: 1, maxLength: 20 })
  .map((parts) => parts.join(""));

type SpanSpec =
  | { kind: "good"; a: number; b: number }
  | { kind: "badQuote"; a: number; b: number }
  | { kind: "badRange"; over: number }
  | { kind: "badEid"; a: number; b: number }
  | { kind: "otherJobEid"; a: number; b: number }
  | { kind: "surrogateSplit" }
  | { kind: "wrongField"; a: number; b: number };

const frac = fc.double({ min: 0, max: 1, noNaN: true });
const spanSpecArb: fc.Arbitrary<SpanSpec> = fc.oneof(
  { weight: 4, arbitrary: fc.record({ kind: fc.constant("good" as const), a: frac, b: frac }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant("badQuote" as const), a: frac, b: frac }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("badRange" as const), over: fc.integer({ min: 1, max: 5 }) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("badEid" as const), a: frac, b: frac }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("otherJobEid" as const), a: frac, b: frac }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("surrogateSplit" as const) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("wrongField" as const), a: frac, b: frac }) },
);

const itemSpecArb = fc.record({
  act: fc.constantFrom("statement", "statement", "intention", "soft_pref", "joke", "none"),
  target: fc.constantFrom("new", "new", "update", "evidenceOnly"),
  spans: fc.array(spanSpecArb, { minLength: 1, maxLength: 3 }),
});

type OutputSpec =
  | { kind: "items"; items: { act: string; target: string; spans: SpanSpec[] }[] }
  | { kind: "invalidJson" }
  | { kind: "refusal" }
  | { kind: "error" };

const outputArb: fc.Arbitrary<OutputSpec> = fc.oneof(
  { weight: 6, arbitrary: fc.record({ kind: fc.constant("items" as const), items: fc.array(itemSpecArb, { minLength: 0, maxLength: 4 }) }) },
  { weight: 1, arbitrary: fc.constant({ kind: "invalidJson" as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: "refusal" as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: "error" as const }) },
);

type Op =
  | { kind: "commit"; text: string }
  /** Runs the Extract_Job of turn `job` (mod the number of committed turns). */
  | { kind: "run"; job: number; outputs: OutputSpec[] }
  /** Runs the most recently run Extract_Job again, whatever its status. */
  | { kind: "retry"; outputs: OutputSpec[] };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ kind: fc.constant("commit" as const), text: textArb }),
  fc.record({ kind: fc.constant("run" as const), job: fc.nat(), outputs: fc.array(outputArb, { minLength: 2, maxLength: 2 }) }),
  fc.record({ kind: fc.constant("retry" as const), outputs: fc.array(outputArb, { minLength: 2, maxLength: 2 }) }),
);

const opsArb = fc.array(opArb, { minLength: 1, maxLength: 50 });

// ---------------------------------------------------------------------------------------------
// Turning specs into concrete Spans against the job's Evidence text

function range(text: string, a: number, b: number): [number, number] {
  let start = Math.min(text.length, Math.floor(a * text.length));
  let end = start + Math.floor(b * (text.length - start));
  if (splitsSurrogate(text, start)) start -= 1;
  if (splitsSurrogate(text, end)) end += 1;
  return [start, Math.min(end, text.length)];
}

function concreteSpan(spec: SpanSpec, turn: CommittedTurn, other: CommittedTurn | undefined): SpanDraft {
  const t = turn.text;
  switch (spec.kind) {
    case "good": {
      const [s, e] = range(t, spec.a, spec.b);
      return { eid: turn.eid, fieldPath: "text", start: s, end: e, quote: t.slice(s, e) };
    }
    case "badQuote": {
      const [s, e] = range(t, spec.a, spec.b);
      return { eid: turn.eid, fieldPath: "text", start: s, end: e, quote: `${t.slice(s, e)}!` };
    }
    case "badRange": {
      const s = Math.max(0, t.length - 1);
      return { eid: turn.eid, fieldPath: "text", start: s, end: t.length + spec.over, quote: t.slice(s) };
    }
    case "badEid": {
      const [s, e] = range(t, spec.a, spec.b);
      return { eid: testId("ghost-evidence"), fieldPath: "text", start: s, end: e, quote: t.slice(s, e) };
    }
    case "otherJobEid": {
      // A real Evidence ID that was not in this job's packet.
      const [s, e] = range(t, spec.a, spec.b);
      return { eid: other?.eid ?? testId("ghost-2"), fieldPath: "text", start: s, end: e, quote: t.slice(s, e) };
    }
    case "surrogateSplit": {
      for (let i = 1; i < t.length; i++) {
        if (splitsSurrogate(t, i)) return { eid: turn.eid, fieldPath: "text", start: i, end: Math.min(t.length, i + 1), quote: t.slice(i, i + 1) };
      }
      return { eid: turn.eid, fieldPath: "text", start: 0, end: t.length + 1, quote: t };
    }
    case "wrongField": {
      const [s, e] = range(t, spec.a, spec.b);
      return { eid: turn.eid, fieldPath: "subject", start: s, end: e, quote: t.slice(s, e) };
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The property

async function listMemories(store: MemoryStore): Promise<StoredDoc<Memory>[]> {
  const all: StoredDoc<Memory>[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page: StoredDoc<Memory>[] = await store.query<Memory>(UID, {
      collection: paths.collection(UID, "memories"),
      where: cursor === null ? [] : [{ field: "__name__", op: ">", value: cursor }],
      orderBy: { field: "__name__", dir: "asc" },
      limit: 100,
    });
    if (page.length === 0) return all;
    all.push(...page);
    cursor = page[page.length - 1]!.id;
  }
}

async function runOps(ops: Op[]): Promise<void> {
  const hasher = createHasher(FAKE_KEY);
  const store = new MemoryStore(hasher);
  const clock = createFakeClock({ world: Date.UTC(2026, 10, 3, 12), ops: Date.UTC(2026, 10, 3, 12), zone: "America/Chicago" });
  const openai = new FakeOpenAI();
  const turns: CommittedTurn[] = [];
  /** Spans of the Item that created each stored Memory, by memory document ID. */
  const producedBy = new Map<string, Span[]>();
  let lastRun: CommittedTurn | undefined;

  for (const [n, op] of ops.entries()) {
    clock.advance(1000);
    if (op.kind === "commit") {
      turns.push(await commitUserTurnForTest(store, UID, testId(`turn${n}`), op.text, clock, hasher));
      continue;
    }
    if (turns.length === 0) continue;
    const turn = op.kind === "run" ? turns[op.job % turns.length]! : (lastRun ?? turns[0]!);
    lastRun = turn;
    const other = turns.find((t) => t.eid !== turn.eid);
    // Each run may make one repair call, so script two results. Keep each output's Item spans by index.
    const spansByOutput: Span[][][] = [];
    for (const out of op.outputs) {
      if (out.kind === "items") {
        const items = out.items.map((it) =>
          factItem(it.act, it.target, "a fact", it.spans.map((s: SpanSpec) => concreteSpan(s, turn, other))),
        );
        spansByOutput.push(items.map((it) => it.spans));
        openai.script("responses.create", ok(completed(JSON.stringify(extractOutput(items)))));
      } else {
        spansByOutput.push([]);
        if (out.kind === "error") openai.script("responses.create", fail(new Error("fake timeout")));
        else if (out.kind === "invalidJson") openai.script("responses.create", ok(completed("{not json")));
        else openai.script("responses.create", ok({ status: "completed", outputText: null, refusal: "no", usage: { inputTokens: 0, outputTokens: 0 } }));
      }
    }
    const before = new Set((await listMemories(store)).map((d) => d.id));
    const callsBefore = openai.requestsTo("responses.create").length;
    try {
      await runExtractJob(UID, turn.jobId, { store, openai, clock, hasher, env: ENV });
    } catch {
      // A failed run is allowed; the invariant is about what is stored.
    }
    // The run committed from the last output it consumed. Drop the rest so the next op starts clean.
    const consumed = openai.requestsTo("responses.create").length - callsBefore;
    const committedSpans = consumed > 0 ? spansByOutput[consumed - 1]! : [];
    openai.drain("responses.create");
    for (const doc of await listMemories(store)) {
      if (before.has(doc.id)) continue;
      const index = committedSpans.findIndex((_, i) => hasher.id(idParts.memory(turn.jobId, i)) === doc.id);
      // An ID outside H("mem", jobId, itemIndex) leaves the Memory with no known producer, which fails below.
      if (index >= 0) producedBy.set(doc.id, committedSpans[index]!);
    }
  }

  for (const doc of await listMemories(store)) {
    const memory = doc.data;
    const spans = producedBy.get(doc.id);
    expect(spans, `memory ${doc.id} has no known producing Item`).toBeDefined();
    const evidence = new Map<string, Evidence>();
    for (const eid of new Set([...memory.rootSlices.map((s) => s.eid), ...spans!.map((s) => s.eid)])) {
      const e = await store.get<Evidence>(UID, paths.evidence(UID, eid)).catch(() => null);
      if (e !== null) evidence.set(eid, e.data);
    }
    const result = resolveLineage({ memory, evidence, hasher, spans: spans! });
    expect(result.ok ? [] : result.failures, `memory ${doc.id} lineage`).toEqual([]);
  }
}

describe("lineage property", () => {
  // RED against the task 11 stub, by design (R31.3). `it.fails` asserts that the property fails, so `npm test`
  // stays green while the stub exists and turns red if the stub ever passes. Task 22 changes this to `it`.
  it.fails(
    "every stored memory resolves to evidence spans",
    async () => {
      await fc.assert(fc.asyncProperty(opsArb, runOps), { numRuns: 1000 });
    },
    120_000,
  );
});
