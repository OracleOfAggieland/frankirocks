import { EXTRACT_INSTRUCTIONS, type Job, type Ledger, type Memory, extractOutputJsonSchema, idParts } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { type ScriptedResult, fail, never, ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { paths } from "../store/paths";
import { type CommittedTurn, commitUserTurnForTest, extractOutput, factItem } from "../testing/extract-fixtures";
import { patchRecord, settle, testRig } from "../testing/fakes";
import { runExtractJob } from "./extract";

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

  it("the 10 s deadline counts as a failure, then the repair (R22.3, R22.4)", async () => {
    const { rig, run, job } = await setup();
    rig.openai.script("responses.create", never(), never());
    const started = rig.clock.read().opsClock.now;
    expect(await run()).toBe("retry");
    expect(rig.clock.read().opsClock.now - started).toBe(20_000);
    expect((await job()).error).toBe("DEPENDENCY");
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
      ["act correction", { act: "correction" }],
      ["act transition", { act: "transition" }],
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

    it("a correction leaves existing Memories unchanged", async () => {
      const { rig, turn, run, memory } = await setup();
      rig.openai.script("responses.create", output(factItem("statement", "new", "x", [span(turn, 0, 6)])));
      await run();
      const before = await memory(0);
      const second = await commitUserTurnForTest(rig.store, UID, testId("t2"), "No, my dog is called Rex", rig.clock, rig.deps.hasher);
      rig.openai.script("responses.create", output(factItem("correction", "update", "Rex", [span(second, 0, 2)])));
      await settle(runExtractJob(UID, second.jobId, rig.deps), rig.clock, rig.timers);
      expect(await memory(0)).toEqual(before);
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
