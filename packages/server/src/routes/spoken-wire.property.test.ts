/**
 * Spoken grade on the wire (R28.6; R28.1–R28.3; KC09). At least 100 runs.
 *
 * FOR ALL sets of Memories covering every Sensitivity × Source_Class combination (S0, S1, S2 × U, C, O, T, M),
 * plus extra Memories with random status and flow, each with a unique marker word in its value and its Evidence
 * text: after session open, a voice Turn, a state refresh and a recall call answered by an adversarial
 * Fake_OpenAI (it echoes packet text and quotes, and cites supplied refs, ghost refs and every Memory ID it can
 * name), no marker of a Memory that fails Spoken_Grade appears in the Head, any Deck, the recall notes, the whole
 * tool output, the Realtime instructions (`session.update` and `response.create`) or the RecallAllV1 request.
 */
import { type Memory, RECALL_TOOL, sessionUpdate } from "@franki/core";
import { testId } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type ScriptedResult, fail, ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { commitUserTurnForTest, insertMemoryForTest } from "../testing/extract-fixtures";
import { callRoute, testRig } from "../testing/fakes";
import { asrTurn, openTestSession } from "../testing/session-fixtures";
import { stateRoute } from "./state";
import { toolRoute } from "./tool";
import { turnRoute } from "./turn";

const UID = "owner-1";
const SENS = ["S0", "S1", "S2"] as const;
const CLASSES = ["U", "C", "O", "T", "M"] as const;

interface Spec {
  sens: (typeof SENS)[number];
  cls: (typeof CLASSES)[number];
  status: Memory["status"];
  flow: Memory["flow"];
}

const fails = (s: Spec) => s.sens === "S2" || !["U", "C", "O"].includes(s.cls) || s.status !== "active" || s.flow !== "open";

const combos: Spec[] = SENS.flatMap((sens) => CLASSES.map((cls) => ({ sens, cls, status: "active" as const, flow: "open" as const })));
const extraArb = fc.array(
  fc.record({
    sens: fc.constantFrom(...SENS),
    cls: fc.constantFrom(...CLASSES),
    status: fc.constantFrom<Memory["status"]>("active", "history", "alleged", "blocked"),
    flow: fc.constantFrom<Memory["flow"]>("open", "never_outbound"),
  }),
  { maxLength: 8 },
);
/** Which adversarial statements the fake model returns (indexes into its candidate list), at most 4. */
const pickArb = fc.array(fc.nat(), { minLength: 0, maxLength: 4 });

const marker = (i: number) => `zqmark${i}x`;

async function runOnce(specs: Spec[], picks: number[]): Promise<void> {
  const rig = testRig();
  const ids: string[] = [];
  for (const [i, s] of specs.entries()) {
    // The marker is in the Evidence text, so it is also in every root Span quote of the Memory.
    const t = await commitUserTurnForTest(rig.store, UID, testId(`src${i}`), `secret ${marker(i)}`, rig.clock, rig.deps.hasher);
    ids.push(await insertMemoryForTest(rig.store, UID, t, rig.deps.hasher, { sens: s.sens, sourceClass: s.cls, status: s.status, flow: s.flow }, `m${i}`));
  }

  // The fake model sees only what it is sent, and tries to leak: it echoes every packet line and quote and cites
  // supplied refs, ghost refs and every Memory ID in the store.
  rig.openai.respond("responses.create", (body): ScriptedResult => {
    const b = body as { model: string; input: string };
    if (b.model !== "test-bg-model") return fail(new Error("no extraction here"));
    const input = JSON.parse(b.input) as { packet: { text: string; roots: unknown[]; refs: unknown[] }[] };
    const candidates = [
      ...input.packet.map((p) => ({ text: `${p.text} ${p.roots.map((r) => (r as { quote: string }).quote).join(" ")}`.slice(0, 240), citations: [p.refs[0]], memoryIds: [] })),
      ...input.packet.flatMap((p) => p.roots.map((r) => ({ text: (r as { quote: string }).quote.slice(0, 240), citations: [r], memoryIds: [] }))),
      ...ids.map((id, i) => ({ text: `guess ${marker(i)}`, citations: [{ type: "memory", id, rev: 1 }], memoryIds: [] })),
      { text: `ghost ${marker(0)}`, citations: [{ type: "memory", id: testId("ghost"), rev: 1 }], memoryIds: [] },
    ];
    const statements = picks.length === 0 || candidates.length === 0 ? [] : picks.map((n) => candidates[n % candidates.length]!);
    return ok(completed(JSON.stringify({ kind: "supported", statements, alternatives: [] })));
  });

  const s = await openTestSession(rig);
  const open = s.deck;
  const turn = await callRoute(rig, turnRoute, asrTurn(s.stamp, 1, "what secret do you know", [{ itemId: "item_1", commitSeq: 1 }]));
  const state = await callRoute(rig, stateRoute, { sessionId: s.sessionId, generation: 1, seen: { epoch: open.epoch, policyRev: open.policyRev, bundleRev: open.bundleRev, rulesRev: open.rulesRev }, ackStamp: null, speechStartedOpsAt: null });
  const stamp = { ...s.stamp, turnId: testId("turn-1") };
  const tool = await callRoute(rig, toolRoute, {
    requestId: testId("tool"),
    stamp,
    callId: "call_1",
    tool: { name: "recall", args: { purpose: "answer", query: "secret", entityRefs: [], roleTuple: null, predicate: null, asOf: null, anchorId: null, sourceMode: "canonical" } },
  });
  expect(tool.body.status).toBe("ready");

  // What the browser would send to the Realtime model from these responses.
  const instructions = [JSON.stringify(sessionUpdate(open.head.text, "m")), JSON.stringify(RECALL_TOOL)];
  const wire = {
    head: open.head.text,
    decks: JSON.stringify([open, turn.body.deck, state.body.deck, tool.body.deck]),
    notes: JSON.stringify(tool.body.result.notes),
    toolOutput: JSON.stringify(tool.body.result),
    instructions: instructions.join("\n"),
    recallRequest: JSON.stringify(rig.openai.requestsTo("responses.create").filter((r) => (r.body as { model: string }).model === "test-bg-model").map((r) => r.body)),
  };
  for (const [i, spec] of specs.entries()) {
    if (!fails(spec)) continue;
    for (const [where, text] of Object.entries(wire)) {
      expect(text.includes(marker(i)), `${where} leaks failing Memory ${i} (${JSON.stringify(spec)})`).toBe(false);
    }
  }
  // Not vacuous: passing Memories do reach the model's packet.
  const passing = specs.findIndex((x) => !fails(x));
  if (passing >= 0) expect(wire.recallRequest.includes(marker(passing))).toBe(true);
}

describe("spoken grade on the wire", () => {
  it("no failing Memory text in Head, Deck, notes or instructions (all S×Class combinations)", async () => {
    await fc.assert(
      fc.asyncProperty(extraArb, pickArb, (extra, picks) => runOnce([...combos, ...extra], picks)),
      { numRuns: 100 },
    );
  }, 120_000);
});
