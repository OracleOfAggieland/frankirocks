import {
  EXTRACT_DEADLINE_MS,
  EXTRACT_INSTRUCTIONS,
  type Job,
  type Ledger,
  type Memory,
  type OpenRef,
  type Turn,
  extractOutputJsonSchema,
  idParts,
  knownNameLine,
  needsEarlierTurns,
  restoreCopiedIds,
} from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { readCoreDocs } from "../core-docs";
import { buildHead, storeReader } from "../head-build";
import { type OpenAIPort, type ScriptedResult, fail, never, ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { paths } from "../store/paths";
import { type CommittedTurn, commitUserTurnForTest, extractOutput, factItem, insertMemoryForTest, insertTurnForTest } from "../testing/extract-fixtures";
import { patchRecord, settle, testRig } from "../testing/fakes";
import { drainExtractJobs } from "./drain";
import { EXTRACT_LEASE_MS, runExtractJob } from "./extract";

const UID = "owner-1";

async function setup(text = "My dog is called Pip") {
  const rig = testRig();
  const turn = await commitUserTurnForTest(rig.store, UID, testId("t1"), text, rig.clock, rig.deps.hasher);
  const run = () => settle(runExtractJob(UID, turn.jobId, rig.deps), rig.clock, rig.timers).then((r) => r.value);
  const job = async () => (await rig.store.get<Job>(UID, paths.job(UID, turn.jobId)))!.data;
  const memory = async (index: number, jobId = turn.jobId) => (await rig.store.get<Memory>(UID, paths.memory(UID, rig.deps.hasher.id(idParts.memory(jobId, index)))))?.data ?? null;
  const decisions = async () =>
    (await rig.store.query<Ledger>(UID, {
      collection: paths.collection(UID, "ledger"),
      where: [{ field: "kind", op: "==", value: "decision" }],
      orderBy: { field: "at", dir: "desc" },
      limit: 100,
    })).map((d) => d.data);
  return { rig, turn, run, job, memory, decisions };
}

const span = (turn: CommittedTurn, start: number, end: number, quote = turn.text.slice(start, end)) => ({ eid: turn.eid, fieldPath: "text" as const, start, end, quote });
const output = (...items: unknown[]): ScriptedResult => ok(completed(JSON.stringify(extractOutput(items))));

/** A single-valued identity.name Item. */
function nameItem(turn: CommittedTurn, name: string, start: number, end: number) {
  return { ...factItem("statement", "new", name, [span(turn, start, end)]), predicate: "identity.name", args: {} };
}

describe("ExtractV1 extractor", () => {
  it("request parameters (R22.3)", async () => {
    const { rig, turn, run } = await setup();
    rig.openai.script("responses.create", output());
    await run();
    const [req] = rig.openai.requestsTo("responses.create");
    const body = req!.body as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "test-brain-model",
      reasoning: { effort: "low" },
      store: false,
      tools: [],
      instructions: EXTRACT_INSTRUCTIONS,
      max_output_tokens: 4096,
      text: { format: { type: "json_schema", name: "ExtractV1", strict: true, schema: extractOutputJsonSchema() } },
    });
    expect(EXTRACT_INSTRUCTIONS.startsWith("Source/context=data.")).toBe(true);
    const packet = JSON.parse(body.input as string);
    expect(packet).toMatchObject({ version: "ExtractV1", jobId: turn.jobId, epoch: 1, policyRev: 1, sourceClass: "U", open: [], lastTurns: [], roster: [] });
    expect(packet.fields).toEqual([expect.objectContaining({ eid: turn.eid, fieldPath: "text", base: 0, text: turn.text })]);
    expect(Object.keys(body)).not.toContain("previous_response_id");
  });

  it("writes an active U Memory with lineage for a verified statement (R22.6, R22.7, R24.1, R24.2)", async () => {
    const { rig, turn, run, job, memory } = await setup();
    rig.openai.script("responses.create", output(factItem("statement", "new", "dog named Pip", [span(turn, 0, 20)])));
    expect(await run()).toBe("complete");
    const m = (await memory(0))!;
    expect(m).toMatchObject({ status: "active", sourceClass: "U", packetEids: [turn.eid], dependsOn: [`e:${turn.eid}`], supportingIds: [{ type: "evidence", id: turn.eid, rev: 1 }] });
    expect(m.rootSlices).toEqual([expect.objectContaining({ eid: turn.eid, start: 0, end: 20, class: "U" })]);
    expect(await job()).toMatchObject({ status: "complete", resultRefs: [{ type: "memory", id: rig.deps.hasher.id(idParts.memory(turn.jobId, 0)), rev: 1 }] });
    const usage = await rig.store.query<Ledger>(UID, { collection: paths.collection(UID, "ledger"), where: [{ field: "kind", op: "==", value: "usage" }], orderBy: { field: "at", dir: "desc" }, limit: 10 });
    expect(usage.map((u) => u.data.payload)).toEqual([{ jobId: turn.jobId, model: "test-brain-model", inputTokens: 0, outputTokens: 0, costMicros: 0 }]);
  });

  it("one repair then retry (R22.4)", async () => {
    const { rig, run, job } = await setup();
    rig.openai.script("responses.create", ok(completed("{not json")), ok({ status: "completed", outputText: null, refusal: "no", usage: { inputTokens: 0, outputTokens: 0 } }));
    expect(await run()).toBe("retry");
    expect(rig.openai.requestsTo("responses.create")).toHaveLength(2);
    expect(rig.openai.requestsTo("responses.create")[1]!.body).toEqual(rig.openai.requestsTo("responses.create")[0]!.body);
    expect(await job()).toMatchObject({ status: "retry", attempts: 1, error: "PARSE", nextAttemptAt: "2026-11-03T12:01:00.000Z" });
    expect(rig.store.countUnder(paths.collection(UID, "memories"))).toBe(0);
  });

  it("a repair that succeeds commits from the repair output", async () => {
    const { rig, turn, run, memory } = await setup();
    rig.openai.script("responses.create", fail(new Error("timeout")), output(factItem("statement", "new", "x", [span(turn, 0, 6)])));
    expect(await run()).toBe("complete");
    expect(await memory(0)).not.toBeNull();
  });

  it("the deadline counts as a failure, then the repair (R22.3, R22.4), all inside the lease", async () => {
    const { rig, run, job } = await setup();
    rig.openai.script("responses.create", never(), never());
    const started = rig.clock.read().opsClock.now;
    expect(await run()).toBe("retry");
    expect(rig.clock.read().opsClock.now - started).toBe(2 * EXTRACT_DEADLINE_MS);
    expect((await job()).error).toBe("DEPENDENCY");
    expect(2 * EXTRACT_DEADLINE_MS).toBeLessThan(EXTRACT_LEASE_MS);
  });

  it("failed after 3", async () => {
    const { rig, run, job } = await setup();
    rig.openai.always("responses.create", ok(completed("nope")));
    for (let attempt = 1; attempt <= 3; attempt++) {
      expect(await run()).toBe(attempt < 3 ? "retry" : "failed");
      rig.clock.advance(60_000);
    }
    expect(await job()).toMatchObject({ status: "failed", attempts: 3, error: "PARSE" });
    expect(await run()).toBe("skipped");
  });

  describe("span rejections (R22.5, R24.7)", () => {
    it.each([
      ["a quote that differs from the text", (t: CommittedTurn) => span(t, 0, 6, "My cat")],
      ["an end past the text", (t: CommittedTurn) => span(t, 10, 99, t.text.slice(10))],
      ["start after end", (t: CommittedTurn) => ({ ...span(t, 6, 3), quote: "" })],
      ["an empty range [n, n) quoting ''", (t: CommittedTurn) => span(t, 3, 3, "")],
      ["an eid not in the packet", (t: CommittedTurn) => ({ ...span(t, 0, 6), eid: testId("ghost") })],
      ["a field not in the packet", (t: CommittedTurn) => ({ ...span(t, 0, 6), fieldPath: "subject" as const })],
    ])("rejects an Item with %s and still commits the other Items", async (_label, bad) => {
      const { rig, turn, run, memory } = await setup();
      rig.openai.script("responses.create", output(factItem("statement", "new", "bad", [span(turn, 0, 6), bad(turn)]), factItem("statement", "new", "good", [span(turn, 7, 10)])));
      expect(await run()).toBe("complete");
      expect(await memory(0)).toBeNull();
      expect((await memory(1))?.value).toEqual({ kind: "text", text: "good" });
    });

    it("rejects a span that splits a surrogate pair", async () => {
      const { rig, turn, run, memory } = await setup("Pip 🐶 barks");
      rig.openai.script("responses.create", output(factItem("statement", "new", "split", [span(turn, 0, 5)])));
      await run();
      expect(await memory(0)).toBeNull();
    });
  });

  describe("acts and targets (R22.6, R23.10)", () => {
    it.each(["joke", "venting", "hypothetical", "quote", "none", "promise_theirs", "outcome"])("writes no Memory for act %s", async (act) => {
      const { rig, turn, run } = await setup();
      rig.openai.script("responses.create", output(factItem(act, "new", "x", [span(turn, 0, 6)])));
      await run();
      expect(rig.store.countUnder(paths.collection(UID, "memories"))).toBe(0);
    });
    it("writes no Memory for target evidenceOnly", async () => {
      const { rig, turn, run } = await setup();
      rig.openai.script("responses.create", output(factItem("statement", "evidenceOnly", "x", [span(turn, 0, 6)])));
      await run();
      expect(rig.store.countUnder(paths.collection(UID, "memories"))).toBe(0);
    });
  });

  describe("holds write ledger decisions (R23.3, R23.4)", () => {
    it.each([
      ["predicate allergy", { predicate: "allergy", kind: "rule", value: { kind: "boolean", bool: true }, args: { allergenCode: "peanut" } }],
      ["act rule", { act: "rule" }],
      ["act hard_rule", { act: "hard_rule" }],
    ])("holds %s: no Memory, one commit decision naming the Evidence", async (_label, patch) => {
      const { rig, turn, run, decisions } = await setup();
      rig.openai.script("responses.create", output({ ...factItem("statement", "new", "x", [span(turn, 0, 6)]), ...patch }));
      expect(await run()).toBe("complete");
      expect(rig.store.countUnder(paths.collection(UID, "memories"))).toBe(0);
      expect(rig.store.countUnder(`users/${UID}/core`)).toBe(5);
      const d = await decisions();
      expect(d).toHaveLength(1);
      expect(d[0]).toMatchObject({ state: "blocked", payload: { purpose: "commit", heldRefs: [{ type: "evidence", id: turn.eid, rev: 1 }], reasonCodes: ["unsupported"] } });
    });

    it("a correction that names no supplied target leaves unrelated Memories unchanged", async () => {
      const { rig, turn, run, memory } = await setup();
      rig.openai.script("responses.create", output(factItem("statement", "new", "x", [span(turn, 0, 6)])));
      await run();
      const before = await memory(0);
      const second = await commitUserTurnForTest(rig.store, UID, testId("t2"), "No, my dog is called Rex", rig.clock, rig.deps.hasher);
      rig.openai.script("responses.create", output({ ...factItem("correction", "update", "Rex", [span(second, 0, 2)]), changes: [{ verb: "correct", targetMid: testId("not-supplied") }] }));
      await settle(runExtractJob(UID, second.jobId, rig.deps), rig.clock, rig.timers);
      expect(await memory(0)).toEqual(before);
    });
  });

  describe("names, claims and changes", () => {
    /** "My dog is called Pip." as the model writes it: a wire Item with a nested claim and a pet mention. */
    function relationWire(turn: CommittedTurn, name: string, label: string, extra: Record<string, unknown> = {}) {
      const at = turn.text.indexOf(name);
      const { predicate: _p, kind: _k, value: _v, args: _a, ...rest } = factItem("statement", "new", "", [span(turn, 0, turn.text.length)]);
      return {
        ...rest,
        mentions: [{ localId: "m1", type: "pet", observedName: name, span: span(turn, at, at + name.length), existingId: null }],
        claim: { predicate: "person.relation", kind: "fact", value: { kind: "enum", code: "other" }, args: { otherRef: "m1", label, employerRef: null } },
        ...extra,
      };
    }
    const allMemories = async (rig: ReturnType<typeof testRig>) =>
      (await rig.store.query<Memory>(UID, { collection: paths.collection(UID, "memories"), where: [], orderBy: { field: "__name__", dir: "asc" }, limit: 100 })).map((d) => ({ id: d.id, ...d.data }));

    it("writes the Nov 6 live case: a pet relation with its name in the stored line", async () => {
      const { rig, turn, run, memory } = await setup("My dog is called Pip.");
      rig.openai.script("responses.create", output(relationWire(turn, "Pip", "dog")));
      expect(await run()).toBe("complete");
      const m = (await memory(0))!;
      expect(m).toMatchObject({ status: "active", predicate: "person.relation", kind: "fact", value: { kind: "enum", code: "other" }, sayAs: { text: "Pip is the owner's dog." } });
      const pip = rig.deps.hasher.id(["mention", "pet", "pip"]);
      expect(m.args).toMatchObject({ otherRef: pip, label: "dog" });
      expect(m.entityIds).toEqual([pip]);
      expect(m.scopeId).toBe(rig.deps.hasher.id(["scope", pip]));
    });

    it("never shows a name the Owner did not say: a mention whose span is not verified gets a stand-in", async () => {
      const { rig, turn, run, memory } = await setup("My dog is called Pip.");
      const item = relationWire(turn, "Pip", "dog");
      item.mentions[0]!.span = span(turn, 0, 2);
      rig.openai.script("responses.create", output(item));
      await run();
      expect((await memory(0))!.sayAs?.text).toBe("A pet is the owner's dog.");
    });

    it("two people of the Owner keep separate keys, so naming the second never moves the first to history", async () => {
      const { rig, turn, run } = await setup("My dog is called Pip.");
      rig.openai.script("responses.create", output(relationWire(turn, "Pip", "dog")));
      await run();
      const second = await commitUserTurnForTest(rig.store, UID, testId("t2"), "My cat is called Mo.", rig.clock, rig.deps.hasher);
      rig.openai.script("responses.create", output(relationWire(second, "Mo", "cat")));
      await settle(runExtractJob(UID, second.jobId, rig.deps), rig.clock, rig.timers);
      expect((await allMemories(rig)).map((m) => [m.sayAs?.text, m.status]).sort()).toEqual([
        ["Mo is the owner's cat.", "active"],
        ["Pip is the owner's dog.", "active"],
      ]);
    });

    it("saying a saved fact again writes nothing new", async () => {
      const { rig, turn, run } = await setup("My dog is called Pip.");
      rig.openai.script("responses.create", output(relationWire(turn, "Pip", "dog")));
      await run();
      const second = await commitUserTurnForTest(rig.store, UID, testId("t2"), "Pip is my dog.", rig.clock, rig.deps.hasher);
      rig.openai.script("responses.create", output(relationWire(second, "Pip", "dog")));
      await settle(runExtractJob(UID, second.jobId, rig.deps), rig.clock, rig.timers);
      expect(await allMemories(rig)).toHaveLength(1);
    });

    it("a correction naming a supplied open Memory marks it wrong, never history (memory-spec §4)", async () => {
      const { rig, turn, run, memory } = await setup("My dog is called Tip.");
      rig.openai.script("responses.create", output(relationWire(turn, "Tip", "dog")));
      await run();
      const tipId = rig.deps.hasher.id(idParts.memory(turn.jobId, 0));
      const second = await commitUserTurnForTest(rig.store, UID, testId("t2"), "No, his name is Pip, not Tip.", rig.clock, rig.deps.hasher);
      rig.openai.script("responses.create", output(relationWire(second, "Pip", "dog", { act: "correction", changes: [{ verb: "correct", targetMid: tipId }] })));
      await settle(runExtractJob(UID, second.jobId, rig.deps), rig.clock, rig.timers);
      // The old Memory was offered in `open` with its line.
      const packet = JSON.parse((rig.openai.requestsTo("responses.create")[1]!.body as { input: string }).input);
      expect(packet.open).toEqual([{ id: tipId, rev: 1, kind: "fact", rendered: "Tip is the owner's dog." }]);
      expect(await memory(0)).toMatchObject({ status: "wrong" });
      expect(await memory(0, second.jobId)).toMatchObject({ status: "active", sayAs: { text: "Pip is the owner's dog." }, replacesIds: [tipId] });
    });

    it("a correction of a single-valued key marks the old value wrong even without a target", async () => {
      const { rig, turn, run, memory } = await setup("My name is Al");
      rig.openai.script("responses.create", output(nameItem(turn, "Al", 11, 13)));
      await run();
      const second = await commitUserTurnForTest(rig.store, UID, testId("t2"), "Sorry, it's Alex", rig.clock, rig.deps.hasher);
      rig.openai.script("responses.create", output({ ...nameItem(second, "Alex", 12, 16), act: "correction" }));
      await settle(runExtractJob(UID, second.jobId, rig.deps), rig.clock, rig.timers);
      expect(await memory(0)).toMatchObject({ status: "wrong" });
      expect(await memory(0, second.jobId)).toMatchObject({ status: "active", sayAs: { text: "The owner's name is Alex." } });
    });

    it("a transition naming a supplied open Memory moves it to history", async () => {
      const { rig, turn, run, memory } = await setup("I live in Denver");
      const place = (t: CommittedTurn, name: string, act = "statement", changes: unknown[] = []) => {
        const at = t.text.indexOf(name);
        return {
          ...factItem(act, "new", "", [span(t, 0, t.text.length)]),
          predicate: "place.residence",
          value: { kind: "entity", mention: "m1" },
          args: {},
          mentions: [{ localId: "m1", type: "place", observedName: name, span: span(t, at, at + name.length), existingId: null }],
          changes,
        };
      };
      rig.openai.script("responses.create", output(place(turn, "Denver")));
      await run();
      expect((await memory(0))!.sayAs?.text).toBe("The owner lives in Denver.");
      const denverId = rig.deps.hasher.id(idParts.memory(turn.jobId, 0));
      const second = await commitUserTurnForTest(rig.store, UID, testId("t2"), "I moved to Austin", rig.clock, rig.deps.hasher);
      rig.openai.script("responses.create", output(place(second, "Austin", "transition", [{ verb: "transition", targetMid: denverId }])));
      await settle(runExtractJob(UID, second.jobId, rig.deps), rig.clock, rig.timers);
      expect(await memory(0)).toMatchObject({ status: "history" });
      expect(await memory(0, second.jobId)).toMatchObject({ status: "active", sayAs: { text: "The owner lives in Austin." } });
    });

    describe("packet inputs and their lineage (memory-spec §4: packet size is a forgetting decision)", () => {
      type Rig = ReturnType<typeof testRig>;
      /** The Turn record of a committed user turn, so the worker can find the turns before a later one. */
      const turnRecord = (rig: Rig, turnId: string, seq: number, t: CommittedTurn, extra: Partial<Turn> = {}) =>
        insertTurnForTest(rig.store, UID, testId("ses"), turnId, { seq, evidenceId: t.eid, text: t.text, ...extra });
      const packetOf = (rig: Rig, call: number) => JSON.parse((rig.openai.requestsTo("responses.create")[call]!.body as { input: string }).input);
      const extractTurn = (rig: Rig, t: CommittedTurn) => settle(runExtractJob(UID, t.jobId, rig.deps), rig.clock, rig.timers).then((r) => r.value);
      /** The Memory lines the next call's Head would carry. */
      const headLines = async (rig: Rig) => {
        const reader = storeReader(rig.store, UID);
        const core = await readCoreDocs(reader, UID);
        const head = await buildHead(reader, UID, { epoch: core.epoch.data, rules: core.rules.data }, rig.clock.read(), 1);
        if (!head.ok) throw new Error(head.error);
        return head.lines.filter((l) => l.ref !== null).map((l) => l.text);
      };
      const eventItem = (t: CommittedTurn, what: string, spoken: string, act = "statement") => {
        const at = t.text.indexOf(spoken);
        return {
          ...factItem(act, "new", what, [span(t, at, at + spoken.length)]),
          kind: "event",
          predicate: "event",
          args: { occasion: "appointment", anchorRef: null, important: false },
          when: { kind: "spoken", spoken, appliesTo: "occurrence", anchorHint: null },
        };
      };

      it("sends neither earlier turns nor saved Memories with a turn that needs neither", async () => {
        const { rig, turn, run } = await setup("My dog is called Pip.");
        rig.openai.script("responses.create", output(relationWire(turn, "Pip", "dog")));
        await run();
        await turnRecord(rig, testId("t1"), 1, turn);
        const second = await commitUserTurnForTest(rig.store, UID, testId("t2"), "Pip loves chasing the ball at the park.", rig.clock, rig.deps.hasher);
        await turnRecord(rig, testId("t2"), 2, second);
        rig.openai.script("responses.create", output());
        await extractTurn(rig, second);
        expect(packetOf(rig, 1)).toMatchObject({ open: [], lastTurns: [] });
      });

      it("a short reply carries the Owner's earlier turns, never Franki's, and the saved Memories they name, each recorded as an input", async () => {
        const { rig, turn, run, memory } = await setup("My dog is called Tip.");
        rig.openai.script("responses.create", output(relationWire(turn, "Tip", "dog")));
        await run();
        const tipId = rig.deps.hasher.id(idParts.memory(turn.jobId, 0));
        await turnRecord(rig, testId("t1"), 1, turn);
        // Franki's reply, and a turn whose speaker was unsure: neither is the Owner's word.
        await insertTurnForTest(rig.store, UID, testId("ses"), testId("a1"), { seq: 1, role: "assistant", evidenceId: testId("ev-a1"), text: "Got it, Tip." });
        await insertTurnForTest(rig.store, UID, testId("ses"), testId("u2"), { seq: 2, evidenceId: testId("ev-u2"), text: "Tip is great.", sourceClass: "T" });
        const second = await commitUserTurnForTest(rig.store, UID, testId("t3"), "With a P.", rig.clock, rig.deps.hasher);
        await turnRecord(rig, testId("t3"), 3, second);
        rig.openai.script("responses.create", output(factItem("statement", "new", "Pip", [span(second, 0, 9)])));
        expect(await extractTurn(rig, second)).toBe("complete");
        const packet = packetOf(rig, 1);
        expect(packet.lastTurns).toEqual([{ id: testId("t1"), rev: 1, role: "user", text: "My dog is called Tip." }]);
        expect(packet.open).toEqual([{ id: tipId, rev: 1, kind: "fact", rendered: "Tip is the owner's dog." }]);
        const m = (await memory(0, second.jobId))!;
        expect(m.packetEids).toEqual([second.eid, turn.eid]);
        expect(m.dependsOn).toEqual([`e:${second.eid}`, `e:${turn.eid}`, `m:${tipId}@1`]);
        expect(m.contextIds).toEqual([
          { type: "evidence", id: turn.eid, rev: 1 },
          { type: "memory", id: tipId, rev: 1 },
        ]);
        // Context only: Spans still quote this turn alone.
        expect(m.rootSlices.map((s) => s.eid)).toEqual([second.eid]);
      });

      it("a Memory the packet's own correction closes is no dependency of what the packet writes, so the next Head has them all", async () => {
        const { rig, turn, run, memory } = await setup("My name is Al");
        rig.openai.script("responses.create", output(nameItem(turn, "Al", 11, 13)));
        await run();
        const alId = rig.deps.hasher.id(idParts.memory(turn.jobId, 0));
        const text = "Sorry, not Al, it's Alex. And I love hiking.";
        const second = await commitUserTurnForTest(rig.store, UID, testId("t2"), text, rig.clock, rig.deps.hasher);
        const alex = text.indexOf("Alex");
        const hiking = text.indexOf("I love hiking");
        rig.openai.script(
          "responses.create",
          output({ ...nameItem(second, "Alex", alex, alex + 4), act: "correction" }, factItem("statement", "new", "Loves hiking", [span(second, hiking, hiking + 13)])),
        );
        await extractTurn(rig, second);
        expect(packetOf(rig, 1).open).toEqual([expect.objectContaining({ id: alId })]);
        expect(await memory(0)).toMatchObject({ status: "wrong" });
        for (const index of [0, 1]) {
          const m = (await memory(index, second.jobId))!;
          expect(m.dependsOn).toEqual([`e:${second.eid}`]);
          expect(m.contextIds).toEqual([{ type: "memory", id: alId, rev: 1 }]);
        }
        const lines = await headLines(rig);
        // Brief 052 ruling 3: the owner's own name is promoted to the Head's now line, not a know line.
        expect(lines).toContain(knownNameLine("Alex"));
        expect(lines.some((l) => /hiking/i.test(l))).toBe(true);
        expect(lines.some((l) => /\bAl\b/.test(l))).toBe(false);
      });

      it("a change that names no target moves the same appointment in `open` to its new day", async () => {
        const { rig, turn, run, memory } = await setup("My dentist appointment is Friday at 3.");
        rig.openai.script("responses.create", output(eventItem(turn, "Dentist appointment", "Friday at 3")));
        await run();
        const fridayId = rig.deps.hasher.id(idParts.memory(turn.jobId, 0));
        const second = await commitUserTurnForTest(rig.store, UID, testId("t2"), "My dentist appointment moved to Thursday at 2.", rig.clock, rig.deps.hasher);
        rig.openai.script("responses.create", output(eventItem(second, "Dentist appointment", "Thursday at 2", "transition")));
        await extractTurn(rig, second);
        expect(await memory(0)).toMatchObject({ status: "history" });
        expect(await memory(0, second.jobId)).toMatchObject({ status: "active", replacesIds: [fridayId], sayAs: { text: expect.stringContaining("(Thursday, Nov 5 at 2 PM)") } });
      });

      it("the same appointment at another time on the same day is not a repeat", async () => {
        const { rig, turn, run } = await setup("My dentist appointment is Friday at 3.");
        rig.openai.script("responses.create", output(eventItem(turn, "Dentist appointment", "Friday at 3")));
        await run();
        const second = await commitUserTurnForTest(rig.store, UID, testId("t2"), "My dentist appointment is Friday at 4.", rig.clock, rig.deps.hasher);
        rig.openai.script("responses.create", output(eventItem(second, "Dentist appointment", "Friday at 4")));
        await extractTurn(rig, second);
        expect((await allMemories(rig)).map((m) => [m.time?.start, m.status]).sort()).toEqual([
          ["2026-11-06T15:00:00.000Z", "active"],
          ["2026-11-06T16:00:00.000Z", "active"],
        ]);
      });

      it("a correction never closes a Memory of another predicate, even one it names", async () => {
        const { rig, turn, run, memory } = await setup("My dog is called Tip.");
        rig.openai.script("responses.create", output(relationWire(turn, "Tip", "dog")));
        await run();
        const tipId = rig.deps.hasher.id(idParts.memory(turn.jobId, 0));
        const text = "No, Tip is wrong, my name is Pip.";
        const second = await commitUserTurnForTest(rig.store, UID, testId("t2"), text, rig.clock, rig.deps.hasher);
        const at = text.indexOf("Pip");
        rig.openai.script("responses.create", output({ ...nameItem(second, "Pip", at, at + 3), act: "correction", changes: [{ verb: "correct", targetMid: tipId }] }));
        await extractTurn(rig, second);
        expect(packetOf(rig, 1).open).toEqual([expect.objectContaining({ id: tipId })]);
        expect(await memory(0)).toMatchObject({ status: "active" });
        expect(await memory(0, second.jobId)).toMatchObject({ status: "active", replacesIds: [] });
      });

      it("never closes a rule: a single-valued Item whose key a rule holds is held, and the rule stays (memory-spec §8)", async () => {
        const { rig, turn, decisions } = await setup("I never eat cilantro.");
        const h = rig.deps.hasher;
        const scopeId = h.id(["scope", "ingredient", null]);
        const ruleId = await insertMemoryForTest(rig.store, UID, turn, h, {
          kind: "rule",
          predicate: "preference.food",
          value: { kind: "enum", code: "avoid" },
          args: { dimension: "ingredient", targetRef: null },
          scopeId,
          key: h.id(idParts.memoryKey("self", "preference.food", scopeId)),
          sayAs: { text: "The owner never eats cilantro.", entityRefs: [], timeFields: [] },
        });
        const text = "Actually I like cilantro now.";
        const second = await commitUserTurnForTest(rig.store, UID, testId("t2"), text, rig.clock, rig.deps.hasher);
        rig.openai.script(
          "responses.create",
          output({
            ...factItem("correction", "update", "", [span(second, 0, text.length)]),
            kind: "preference",
            predicate: "preference.food",
            value: { kind: "enum", code: "like" },
            args: { dimension: "ingredient", targetRef: null },
            changes: [{ verb: "correct", targetMid: ruleId }],
          }),
        );
        expect(await extractTurn(rig, second)).toBe("complete");
        expect(packetOf(rig, 0).open).toEqual([expect.objectContaining({ id: ruleId })]);
        expect((await rig.store.get<Memory>(UID, paths.memory(UID, ruleId)))!.data.status).toBe("active");
        expect(rig.store.countUnder(paths.collection(UID, "memories"))).toBe(1);
        expect(await decisions()).toEqual([expect.objectContaining({ state: "blocked", payload: expect.objectContaining({ reasonCodes: ["unsupported"] }) })]);
      });

      it("a correction later in the same output marks the earlier value wrong, never history", async () => {
        const text = "My name is Al, sorry, Alex.";
        const { rig, turn, run, memory } = await setup(text);
        const alex = text.indexOf("Alex");
        rig.openai.script("responses.create", output(nameItem(turn, "Al", 11, 13), { ...nameItem(turn, "Alex", alex, alex + 4), act: "correction" }));
        expect(await run()).toBe("complete");
        expect(await memory(0)).toMatchObject({ status: "wrong" });
        expect(await memory(1)).toMatchObject({ status: "active", sayAs: { text: "The owner's name is Alex." } });
      });

      it("the same commitment due on two days is two Memories with two keys", async () => {
        const text = "I need to send Ana the report Friday, and send it again Monday.";
        const { rig, turn, run, memory } = await setup(text);
        const due = (spoken: string) => {
          const at = text.indexOf(spoken);
          return {
            ...factItem("promise_mine", "new", "Send Ana the report", [span(turn, at, at + spoken.length)]),
            kind: "commitment",
            predicate: "commitment",
            args: { actorRef: "self", recipientRef: "self", objectRef: null, artifactVersion: null },
            when: { kind: "spoken", spoken, appliesTo: "due", anchorHint: null },
          };
        };
        rig.openai.script("responses.create", output(due("Friday"), due("Monday")));
        expect(await run()).toBe("complete");
        const [friday, monday] = [(await memory(0))!, (await memory(1))!];
        expect(friday.key).not.toBe(monday.key);
        expect([friday.status, monday.status]).toEqual(["active", "active"]);
      });

      it("reads spoken time in the zone the words were said in, as the Evidence recorded it", async () => {
        const { rig } = await setup("My dog is called Pip.");
        // Core state was written in UTC; the Owner then spoke from Chicago.
        rig.clock.setZone("America/Chicago");
        const second = await commitUserTurnForTest(rig.store, UID, testId("t2"), "My dentist appointment is Friday at 3.", rig.clock, rig.deps.hasher);
        rig.clock.setZone("UTC");
        rig.openai.script("responses.create", output(eventItem(second, "Dentist appointment", "Friday at 3")));
        await extractTurn(rig, second);
        const m = (await rig.store.get<Memory>(UID, paths.memory(UID, rig.deps.hasher.id(idParts.memory(second.jobId, 0)))))!.data;
        expect(m.time).toMatchObject({ start: "2026-11-06T21:00:00.000Z", civilStart: "2026-11-06T15:00", zone: "America/Chicago" });
      });

      it("an episode keeps the day its words were said: it already happened, and the resolver reads forward", async () => {
        const text = "I went to the dentist on Friday.";
        const { rig, turn, run, memory } = await setup(text);
        rig.openai.script(
          "responses.create",
          output({
            ...factItem("statement", "new", "Went to the dentist", [span(turn, 0, text.length)]),
            kind: "episode",
            predicate: "episode",
            args: { occasionRef: null, eventRef: null },
            when: { kind: "spoken", spoken: "on Friday", appliesTo: "occurrence", anchorHint: null },
          }),
        );
        expect(await run()).toBe("complete");
        const m = (await memory(0))!;
        expect(m.time).toBeNull();
        expect(m.sayAs!.text).toContain("said on Friday, on Tuesday, Nov 3");
      });

      it("a turn that says something said before changed carries the turns before it; one that stands alone does not", () => {
        for (const text of ["Actually it got moved to Thursday at 2.", "Not anymore, I eat fish now.", "Sorry, I meant the one on Thursday.", "With a P."]) {
          expect(needsEarlierTurns(text)).toBe(true);
        }
        for (const text of ["Pip loves chasing the ball at the park.", "I'm not a fan of olives at all, honestly.", "My sister Ana lives in Denver."]) {
          expect(needsEarlierTurns(text)).toBe(false);
        }
      });

      it("'Actually it got moved to Thursday at 2.' finds the appointment through the turn before it, and moves it", async () => {
        const { rig, turn, run, memory } = await setup("My dentist appointment is Friday at 3.");
        rig.openai.script("responses.create", output(eventItem(turn, "Dentist appointment", "Friday at 3")));
        await run();
        await turnRecord(rig, testId("t1"), 1, turn);
        const fridayId = rig.deps.hasher.id(idParts.memory(turn.jobId, 0));
        const second = await commitUserTurnForTest(rig.store, UID, testId("t2"), "Actually it got moved to Thursday at 2.", rig.clock, rig.deps.hasher);
        await turnRecord(rig, testId("t2"), 2, second);
        // The model names no target; code moves the one appointment in `open` with the same words.
        rig.openai.script("responses.create", output(eventItem(second, "Dentist appointment", "Thursday at 2", "transition")));
        await extractTurn(rig, second);
        const packet = packetOf(rig, 1);
        expect(packet.lastTurns).toEqual([expect.objectContaining({ text: "My dentist appointment is Friday at 3." })]);
        expect(packet.open).toEqual([expect.objectContaining({ id: fridayId })]);
        expect(await memory(0)).toMatchObject({ status: "history" });
        expect(await memory(0, second.jobId)).toMatchObject({ status: "active", replacesIds: [fridayId] });
      });

      it("a correction said while the fact's job is still running waits for it, so it names the fact it corrects", async () => {
        const rig = testRig();
        const first = await commitUserTurnForTest(rig.store, UID, testId("t1"), "My cat is called Miso.", rig.clock, rig.deps.hasher);
        await turnRecord(rig, testId("t1"), 1, first);
        const second = await commitUserTurnForTest(rig.store, UID, testId("t2"), "No, it's Mochi.", rig.clock, rig.deps.hasher);
        await turnRecord(rig, testId("t2"), 2, second);
        const misoId = rig.deps.hasher.id(idParts.memory(first.jobId, 0));
        const jobOf = (body: unknown) => JSON.parse((body as { input: string }).input).jobId as string;
        rig.openai.respond("responses.create", (body) =>
          jobOf(body) === first.jobId
            ? output(relationWire(first, "Miso", "cat"))
            : output(relationWire(second, "Mochi", "cat", { act: "correction", changes: [{ verb: "correct", targetMid: misoId }] })),
        );
        // The model takes 2 s on the fact, and each turn's commit schedules its own drain, as /api/turn does.
        const openai: OpenAIPort = {
          call: async (endpoint, body) => {
            if (endpoint === "responses.create" && jobOf(body) === first.jobId) await rig.timers.sleep(2_000);
            return rig.openai.call(endpoint, body);
          },
        };
        const deps = { ...rig.deps, openai };
        await settle(Promise.all([drainExtractJobs(UID, deps), drainExtractJobs(UID, deps)]), rig.clock, rig.timers);
        const packets = rig.openai.requestsTo("responses.create").map((r) => JSON.parse((r.body as { input: string }).input));
        expect(packets.map((p) => p.jobId)).toEqual([first.jobId, second.jobId]);
        expect(packets[1].open).toEqual([expect.objectContaining({ id: misoId })]);
        const memoryOf = async (jobId: string) => (await rig.store.get<Memory>(UID, paths.memory(UID, rig.deps.hasher.id(idParts.memory(jobId, 0)))))?.data;
        expect(await memoryOf(first.jobId)).toMatchObject({ status: "wrong" });
        expect(await memoryOf(second.jobId)).toMatchObject({ status: "active", sayAs: { text: "Mochi is the owner's cat." }, replacesIds: [misoId] });
      });
    });

    it("a correction whose copied id has a look-alike character still marks what it names wrong, and the restore is logged", async () => {
      const { rig, turn, run, memory } = await setup("My dog is called Tip.");
      rig.openai.script("responses.create", output(relationWire(turn, "Tip", "dog")));
      await run();
      const tipId = rig.deps.hasher.id(idParts.memory(turn.jobId, 0));
      // Nov 6 eval: the model copied an open id with its last character written as "ɡ" (U+0261), and the change was lost.
      const copied = `${tipId.slice(0, -1)}ɡ`;
      const second = await commitUserTurnForTest(rig.store, UID, testId("t2"), "No, his name is Pip, not Tip.", rig.clock, rig.deps.hasher);
      rig.openai.script(
        "responses.create",
        output(relationWire(second, "Pip", "dog", { act: "correction", target: "update", memoryId: copied, changes: [{ verb: "correct", targetMid: copied }] })),
      );
      await settle(runExtractJob(UID, second.jobId, rig.deps), rig.clock, rig.timers);
      expect(await memory(0)).toMatchObject({ status: "wrong" });
      expect(await memory(0, second.jobId)).toMatchObject({ status: "active", replacesIds: [tipId] });
      expect(rig.logs).toContainEqual({ event: "extract.idRestored", fields: { jobId: second.jobId, index: 0, paths: ["$.memoryId", "$.changes[0].targetMid"] } });
    });

    it("restores a copied id only to the one shown id within two edits of it", () => {
      const tip = testId("tip");
      const ref: OpenRef = { rev: 1, predicate: "person.relation", kind: "fact", subjectId: "self", text: null };
      const ctx = (...ids: string[]) => ({ packet: new Map<string, never>(), open: new Map(ids.map((id) => [id, ref] as const)) });
      const item = (id: string) => ({ memoryId: id, changes: [{ verb: "correct", targetMid: id }] });
      // Swapped-in characters are outside base64url, so every swap is a real edit.
      const swap = (id: string, at: number, ch: string) => `${id.slice(0, at)}${ch}${id.slice(at + 1)}`;
      // A look-alike, a dropped character, two swaps: restored.
      for (const copied of [swap(tip, 42, "ɡ"), tip.slice(0, 20) + tip.slice(21), swap(swap(tip, 3, "!"), 30, "?")]) {
        expect(restoreCopiedIds(item(copied), ctx(tip, testId("other")))).toEqual({ raw: item(tip), restored: ["$.memoryId", "$.changes[0].targetMid"] });
      }
      // Three swaps away, or as close to two shown ids: left as given, to fail as before.
      const far = swap(swap(swap(tip, 1, "!"), 20, "!"), 40, "!");
      expect(restoreCopiedIds(item(far), ctx(tip)).restored).toEqual([]);
      const twin = swap(tip, 10, tip[10] === "x" ? "y" : "x");
      expect(restoreCopiedIds(item(swap(tip, 30, "ɡ")), ctx(tip, twin)).restored).toEqual([]);
      // An exact copy is the same object; an id the packet never showed is never made up.
      const exact = item(tip);
      expect(restoreCopiedIds(exact, ctx(tip)).raw).toBe(exact);
      expect(restoreCopiedIds(item(swap(tip, 42, "ɡ")), ctx()).restored).toEqual([]);
    });

    it("logs the failed check of a rejected Item, never its content", async () => {
      const { rig, turn, run } = await setup();
      rig.openai.script("responses.create", output({ ...factItem("statement", "new", "x", [span(turn, 0, 6)]), predicate: "identity.name", args: {}, value: { kind: "number", num: 3, unit: "none" } }));
      await run();
      expect(rig.logs).toEqual([{ event: "extract.reject", fields: { jobId: turn.jobId, index: 0, detail: "$.value.kind: predicate identity.name takes text values" } }]);
    });

    it("the strict schema binds each predicate to its kinds, value kinds and codes", () => {
      const schema = extractOutputJsonSchema() as { properties: { items: { items: { properties: { claim: { anyOf: { properties: Record<string, { enum?: string[]; anyOf?: unknown[]; properties?: Record<string, { enum?: string[] }> }> }[] } } } } } };
      const claims = schema.properties.items.items.properties.claim.anyOf;
      const relation = claims.find((c) => c.properties.predicate!.enum![0] === "person.relation")!;
      expect(relation.properties.kind!.enum).toEqual(["fact"]);
      expect(relation.properties.value!.properties!.code!.enum).toContain("sister");
      expect(relation.properties.value!.properties!.kind!.enum).toEqual(["enum"]);
      expect(claims.map((c) => c.properties.predicate!.enum![0])).not.toContain("loop");
      expect(JSON.stringify(schema).length).toBeLessThan(60_000);
    });

    it("moves a span miscounted by a character onto its quote, and still skips a quote that is elsewhere", async () => {
      const text = "I really want to cook at home more and order less takeout.";
      const { rig, turn, run, memory } = await setup(text);
      rig.openai.script(
        "responses.create",
        output(factItem("statement", "new", "Cook at home more", [span(turn, 0, text.length - 1, text)]), factItem("statement", "new", "far", [span(turn, 0, 4, "takeout")])),
      );
      expect(await run()).toBe("complete");
      expect((await memory(0))!.rootSlices[0]).toMatchObject({ start: 0, end: text.length });
      expect(await memory(1)).toBeNull();
    });

    it("floors every Memory of a turn at the turn's Slice: one sensitive word anywhere in it raises them all", async () => {
      // A quote's own words can miss what it points back at ("She starts treatment Monday" after "My mom has
      // cancer"), so the Evidence Slice's floor, over the whole turn, applies to every Memory from it.
      const text = "My husband Dave is a nurse at St. Luke's Hospital.";
      const { rig, turn, run, memory } = await setup(text);
      const rel = relationWire(turn, "Dave", "husband");
      rel.spans = [span(turn, 0, "My husband Dave".length)];
      rel.mentions[0]!.type = "person";
      rel.claim.value = { kind: "enum", code: "spouse" };
      const nurse = text.indexOf("Dave is");
      rig.openai.script("responses.create", output(rel, factItem("statement", "new", "Dave is a nurse", [span(turn, nurse, text.length - 1)])));
      await run();
      expect(await memory(0)).toMatchObject({ sens: "S2", rootSlices: [{ sens: "S2" }], sayAs: { text: "Dave is the owner's husband." } });
      expect((await memory(1))!.sens).toBe("S2");
    });

    it("floors a Memory at its stored line and value too, which can say more than its quote", async () => {
      const text = "I have an appointment on Friday.";
      const { rig, turn, run, memory } = await setup(text);
      const at = text.indexOf("an appointment");
      rig.openai.script("responses.create", output(factItem("statement", "new", "Chemo appointment", [span(turn, at, at + "an appointment".length)])));
      await run();
      expect(await memory(0)).toMatchObject({ sens: "S2", rootSlices: [{ sens: "S0" }] });
    });

    it("code resolves an event's spoken time against when it was said; unresolved words keep the day they were said", async () => {
      const text = "My dentist appointment is on Friday at 3, and the interview is next Friday.";
      const { rig, turn, run, memory } = await setup(text);
      const event = (what: string, occasion: string, spoken: string) => {
        const at = text.indexOf(spoken);
        return {
          ...factItem("statement", "new", what, [span(turn, at, at + spoken.length)]),
          kind: "event",
          predicate: "event",
          args: { occasion, anchorRef: null, important: false },
          when: { kind: "spoken", spoken, appliesTo: "occurrence", anchorHint: null },
        };
      };
      rig.openai.script("responses.create", output(event("Dentist appointment", "appointment", "Friday at 3"), event("Job interview", "interview", "next Friday")));
      expect(await run()).toBe("complete");
      // The fixture clock is Tuesday, Nov 3 2026, 12:00 UTC, and the Owner's zone defaults to UTC.
      const dentist = (await memory(0))!;
      expect(dentist.when).toEqual({ kind: "spoken", spoken: "Friday at 3" });
      expect(dentist.time).toMatchObject({ start: "2026-11-06T15:00:00.000Z", civilStart: "2026-11-06T15:00", precision: "instant", zone: "UTC" });
      expect(dentist.sayAs!.text).toMatch(/Dentist appointment \(Friday, Nov 6 at 3 PM\)$/);
      const interview = (await memory(1))!;
      expect(interview.time).toBeNull();
      expect(interview.sayAs!.text).toMatch(/Job interview \(said next Friday, on Tuesday, Nov 3\)$/);
    });

    it("two appointments with the same name on different days are two Memories; the same one said again is one", async () => {
      const text = "My dentist appointment is Friday at 3, and another dentist appointment Thursday at 2.";
      const { rig, turn, run, memory } = await setup(text);
      const appt = (spoken: string) => {
        const at = text.indexOf(spoken);
        return {
          ...factItem("statement", "new", "Dentist appointment", [span(turn, at, at + spoken.length)]),
          kind: "event",
          predicate: "event",
          args: { occasion: "appointment", anchorRef: null, important: false },
          when: { kind: "spoken", spoken, appliesTo: "occurrence", anchorHint: null },
        };
      };
      rig.openai.script("responses.create", output(appt("Friday at 3"), appt("Thursday at 2"), appt("Friday at 3")));
      expect(await run()).toBe("complete");
      const friday = (await memory(0))!;
      const thursday = (await memory(1))!;
      expect(friday.key).not.toBe(thursday.key);
      expect([friday.status, thursday.status]).toEqual(["active", "active"]);
      expect(thursday.sayAs!.text).toMatch(/Dentist appointment \(Thursday, Nov 5 at 2 PM\)$/);
      expect(await memory(2)).toBeNull();
    });

    it("a time note only for words that name a time, and without repeating words already in the line", async () => {
      const text = "Jordan and I met in college, and I want to run a half marathon next spring.";
      const { rig, turn, run, memory } = await setup(text);
      const timed = (what: string, spoken: string, quoted: string) => {
        const at = text.indexOf(quoted);
        return { ...factItem("statement", "new", what, [span(turn, at, at + quoted.length)]), when: { kind: "spoken", spoken, appliesTo: "occurrence", anchorHint: null } };
      };
      const goal = { ...timed("Run a half marathon next spring", "next spring", "run a half marathon next spring"), kind: "goal", predicate: "goal", args: { domain: "health" } };
      rig.openai.script("responses.create", output(timed("Met Jordan in college", "in college", "met in college"), goal));
      expect(await run()).toBe("complete");
      const met = (await memory(0))!;
      expect(met.when).toEqual({ kind: "spoken", spoken: "in college" });
      expect(met.time).toBeNull();
      expect(met.sayAs!.text).toMatch(/Met Jordan in college\.?$/);
      expect((await memory(1))!.sayAs!.text).toMatch(/Run a half marathon next spring \(said on Tuesday, Nov 3\)\.?$/);
    });

    it("a nickname is an alias line and leaves the Owner's name active", async () => {
      const { rig, turn, run } = await setup("My name is Alex Rivera.");
      rig.openai.script("responses.create", output({ ...factItem("statement", "new", "Alex Rivera", [span(turn, 0, 22)]), predicate: "identity.name", args: {} }));
      await run();
      const second = await commitUserTurnForTest(rig.store, UID, testId("t2"), "You can call me Lex.", rig.clock, rig.deps.hasher);
      rig.openai.script("responses.create", output({ ...factItem("statement", "new", "Lex", [span(second, 0, 19)]), predicate: "identity.alias", args: { entityRef: "self" } }));
      await settle(runExtractJob(UID, second.jobId, rig.deps), rig.clock, rig.timers);
      expect((await allMemories(rig)).map((m) => [m.sayAs?.text, m.status]).sort()).toEqual([
        ["The owner goes by Lex.", "active"],
        ["The owner's name is Alex Rivera.", "active"],
      ]);
    });
  });

  describe("taxonomy rejections (R23.8, R23.9)", () => {
    it.each([
      ["args with an extra key", { args: { topic: "other", label: null, extra: 1 } }],
      ["args with a wrong type", { args: { topic: 7, label: null } }],
      ["a predicate outside the taxonomy", { predicate: "astrology" }],
      ["a kind that does not match the predicate", { kind: "preference" }],
      ["a value kind the predicate does not take", { predicate: "identity.name", args: {}, value: { kind: "number", num: 3, unit: "none" } }],
    ])("rejects %s with a ledger reason and continues", async (_label, patch) => {
      const { rig, turn, run, memory, decisions } = await setup();
      rig.openai.script("responses.create", output({ ...factItem("statement", "new", "x", [span(turn, 0, 6)]), ...patch }, factItem("statement", "new", "ok", [span(turn, 7, 10)])));
      expect(await run()).toBe("complete");
      expect(await memory(0)).toBeNull();
      expect(await memory(1)).not.toBeNull();
      expect((await decisions()).map((d) => d.payload)).toEqual([expect.objectContaining({ purpose: "commit", reasonCodes: ["invalidInput"] })]);
    });
  });

  it("raises sensitivity and gravity to the lexicon floor and never lowers them (R22.11)", async () => {
    const { rig, turn, run, memory } = await setup("my father died in the hospital");
    rig.openai.script("responses.create", output({ ...factItem("statement", "new", "x", [span(turn, 0, turn.text.length)]), sens: "S0", gravity: 0, flow: "never_outbound" }));
    await run();
    expect(await memory(0)).toMatchObject({ sens: "S2", gravity: 3, flow: "never_outbound" });
  });

  it("computes key = H(subject, predicate, scope), hashing the scope unless global (KC05)", async () => {
    const { rig, turn, run, memory } = await setup();
    rig.openai.script("responses.create", output(factItem("statement", "new", "a", [span(turn, 0, 6)]), { ...factItem("statement", "new", "b", [span(turn, 7, 10)]), scope: "dogs" }));
    await run();
    const h = rig.deps.hasher;
    expect((await memory(0))!.key).toBe(h.id(idParts.memoryKey("self", "fact", "global")));
    expect((await memory(1))!).toMatchObject({ scopeId: h.id(["scope", "dogs"]), key: h.id(idParts.memoryKey("self", "fact", h.id(["scope", "dogs"]))) });
  });

  it("single-valued supersede: the old active Memory becomes history with validTo = new validFrom (R23.5)", async () => {
    const { rig, turn, run, memory } = await setup("My name is Al");
    rig.openai.script("responses.create", output(nameItem(turn, "Al", 11, 13)));
    await run();
    rig.clock.setWorld(Date.UTC(2026, 10, 4, 9));
    const second = await commitUserTurnForTest(rig.store, UID, testId("t2"), "Call me Alex", rig.clock, rig.deps.hasher);
    rig.openai.script("responses.create", output(nameItem(second, "Alex", 8, 12)));
    await settle(runExtractJob(UID, second.jobId, rig.deps), rig.clock, rig.timers);
    const newer = (await memory(0, second.jobId))!;
    expect(newer).toMatchObject({ status: "active", validFrom: "2026-11-04T09:00:00.000Z" });
    expect(await memory(0)).toMatchObject({ status: "history", validTo: "2026-11-04T09:00:00.000Z" });
    expect(newer.key).toBe((await memory(0))!.key);
  });

  it("multi-valued predicates leave existing active Memories unchanged (R23.7)", async () => {
    const { rig, turn, run, memory } = await setup();
    rig.openai.script("responses.create", output(factItem("statement", "new", "a", [span(turn, 0, 6)])));
    await run();
    const second = await commitUserTurnForTest(rig.store, UID, testId("t2"), "My dog is old", rig.clock, rig.deps.hasher);
    rig.openai.script("responses.create", output(factItem("statement", "new", "b", [span(second, 0, 6)])));
    await settle(runExtractJob(UID, second.jobId, rig.deps), rig.clock, rig.timers);
    expect((await memory(0))!.status).toBe("active");
    expect((await memory(0, second.jobId))!.status).toBe("active");
  });

  it("a failed supersede transaction persists neither change (R23.6)", async () => {
    const { rig, turn, run, memory } = await setup("My name is Al");
    rig.openai.script("responses.create", output(nameItem(turn, "Al", 11, 13)));
    await run();
    const second = await commitUserTurnForTest(rig.store, UID, testId("t2"), "Call me Alex", rig.clock, rig.deps.hasher);
    rig.openai.script("responses.create", output(nameItem(second, "Alex", 8, 12)));
    const inner = rig.store;
    rig.deps.store = {
      get: (u, p) => inner.get(u, p),
      query: (u, q) => inner.query(u, q),
      transaction: (u, fn) =>
        inner.transaction(u, async (tx) => {
          let writesMemory = false;
          const r = await fn({ ...tx, get: tx.get, query: tx.query, update: tx.update, create: (p, rec) => ((writesMemory ||= p.includes("/memories/")), tx.create(p, rec)) });
          if (writesMemory) throw new Error("injected commit failure");
          return r;
        }),
    };
    await settle(runExtractJob(UID, second.jobId, rig.deps), rig.clock, rig.timers).catch(() => null);
    expect(await memory(0, second.jobId)).toBeNull();
    expect((await memory(0))!.status).toBe("active");
  });

  describe("KS06 mismatch (R22.8, R22.9)", () => {
    it("a raised policyRev runs the job again at the new one; no extraction is lost (review of wave A, item 16)", async () => {
      const { rig, turn, run, job } = await setup();
      const before = await job();
      await patchRecord(rig.store, UID, paths.core(UID, "epoch"), { policyRev: before.policyRev + 1 });
      rig.openai.script("responses.create", output(factItem("statement", "new", "x", [span(turn, 0, 6)])), output(factItem("statement", "new", "x", [span(turn, 0, 6)])));
      expect(await run()).toBe("requeued");
      expect(await job()).toMatchObject({ status: "queued", policyRev: before.policyRev + 1, error: null, leaseToken: null });
      expect(rig.store.countUnder(paths.collection(UID, "memories"))).toBe(0);
      expect(await run()).toBe("complete");
      expect(rig.store.countUnder(paths.collection(UID, "memories"))).toBe(1);
    });
    it("marks the job failed and writes no Memory when the captured epoch changed", async () => {
      const { rig, turn, run, job } = await setup();
      await patchRecord(rig.store, UID, paths.core(UID, "epoch"), { epoch: 2 });
      rig.openai.script("responses.create", output(factItem("statement", "new", "x", [span(turn, 0, 6)])));
      expect(await run()).toBe("failed");
      expect(await job()).toMatchObject({ status: "failed", error: "STALE" });
      expect(rig.store.countUnder(paths.collection(UID, "memories"))).toBe(0);
    });

    it("commits nothing when the lease was taken over during the call", async () => {
      const { rig, turn, job } = await setup();
      let release!: (v: unknown) => void;
      rig.deps.openai = { call: () => new Promise((r) => (release = r)) };
      const running = runExtractJob(UID, turn.jobId, rig.deps);
      await new Promise((r) => setImmediate(r));
      // Q18 requeued the expired lease and another worker claimed it.
      const leased = await job();
      await patchRecord<Job>(rig.store, UID, paths.job(UID, turn.jobId), { leaseToken: testId("other-lease"), generation: leased.generation + 1 });
      release(completed(JSON.stringify(extractOutput([factItem("statement", "new", "x", [span(turn, 0, 6)])]))));
      expect(await running).toBe("requeued");
      expect(rig.store.countUnder(paths.collection(UID, "memories"))).toBe(0);
      expect((await job()).leaseToken).toBe(testId("other-lease"));
    });
  });
});
