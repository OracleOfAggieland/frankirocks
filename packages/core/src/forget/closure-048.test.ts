// Brief 048: rulings 1, 16 and 17 on the pure planners.
import { describe, expect, it } from "vitest";
import { sampleEvidence, sampleMemory, sampleTurn, testId } from "../testing/samples";
import { planClosure } from "./closure";
import { planPurge, purgedArgs } from "./purge";
import { evidenceOf, forgetHasher as hasher, memoryOn } from "./testing/arb-forget";

const stamps = { epoch: 3, policyRev: 2 };
const now = "2026-11-13T12:00:00.000Z";
const S = testId("session");

function input(over: Partial<Parameters<typeof planClosure>[0]> = {}): Parameters<typeof planClosure>[0] {
  return { opId: testId("op"), stamps, now, hasher, targetIds: [], blockedEids: [], blockedKeys: [], providerBlocks: [], requestTurns: [], memories: [], evidence: [], effects: [], moments: [], turns: [], sessions: [], ...over };
}

describe("ruling 16: a restamp never cleans a row", () => {
  it("an unrelated survivor that was dirty keeps dirty: true; only its epoch moves", () => {
    const E = testId("e-unrelated");
    const m = { ...memoryOn(E, "I like tea.", 0, 11, "tea", hasher), epoch: 2, dirty: true };
    const plan = planClosure(input({ memories: [{ id: testId("m"), memory: m }], evidence: [{ id: E, evidence: { ...evidenceOf(E, "I like tea.", hasher), epoch: 2, dirty: true } }] }));
    const writes = plan.groups.flatMap((g) => g.writes);
    const mem = writes.find((w) => w.collection === "memories");
    const ev = writes.find((w) => w.collection === "evidence");
    expect(mem?.doc).toMatchObject({ epoch: 3, dirty: true });
    expect(ev?.doc).toMatchObject({ epoch: 3, dirty: true });
  });

  it("a survivor already at the epoch is not written, dirty or not", () => {
    const E = testId("e-now");
    const m = { ...memoryOn(E, "I like tea.", 0, 11, "tea", hasher), epoch: 3, dirty: true };
    expect(planClosure(input({ memories: [{ id: testId("m"), memory: m }] })).groups).toEqual([]);
  });
});

describe("a forget queued behind the barrier owns its own request Evidence", () => {
  it("closure neither restamps nor blocks a queued request's Evidence written below the epoch", () => {
    const Q = testId("e-queued");
    const plan = planClosure(input({ evidence: [{ id: Q, evidence: { ...evidenceOf(Q, "Forget the tea.", hasher), epoch: 2 } }], queuedEids: [Q] }));
    expect(plan.groups.flatMap((g) => g.writes).filter((w) => w.id === Q)).toEqual([]);
  });
});

describe("ruling 1: Franki's own words after the earliest forgotten Evidence are withheld", () => {
  const ROOT = testId("e-root");
  const BEFORE = testId("e-before");
  const AFTER = testId("e-after");
  const FIXED = testId("e-fixed");
  const at = (ms: number) => new Date(Date.parse(now) - ms).toISOString();
  const world = () => {
    const target = { ...memoryOn(ROOT, "Danny loves gumbo.", 0, 18, "gumbo", hasher), epoch: 2 };
    const ev = (id: string, text: string, createdAt: string) => ({ id, evidence: { ...evidenceOf(id, text, hasher), epoch: 2, createdAt } });
    const turn = (id: string, eid: string, text: string, seq: number) => ({ sessionId: S, id: testId(id), turn: sampleTurn({ role: "assistant", seq, evidenceId: eid, text, sourceClass: "M", state: "transcribed" }) });
    return input({
      targetIds: [testId("m-target")],
      blockedEids: [ROOT],
      memories: [{ id: testId("m-target"), memory: target }],
      evidence: [ev(ROOT, "Danny loves gumbo.", at(60_000)), ev(BEFORE, "Hello there.", at(120_000)), ev(AFTER, "I'm sorry about Danny.", at(30_000)), ev(FIXED, "Sorry, say that again?", at(10_000))],
      turns: [turn("t-before", BEFORE, "Hello there.", 1), turn("t-after", AFTER, "I'm sorry about Danny.", 2), turn("t-fixed", FIXED, "Sorry, say that again?", 3)],
    });
  };

  it("blocks the reply written after the root, keeps the one before it and a Fixed_Line, and restamps neither blocked one", () => {
    const plan = planClosure(world());
    expect(plan.withheldTurns.map((t) => t.eid)).toEqual([AFTER]);
    const writes = plan.groups.flatMap((g) => g.writes);
    expect(writes.filter((w) => w.collection === "evidence" && w.id === AFTER).map((w) => (w.doc as { status: string }).status)).toEqual(["blocked"]);
    expect(writes.find((w) => w.collection === "evidence" && w.id === BEFORE)?.doc).toMatchObject({ epoch: 3, status: "retained" });
  });

  it("purge empties the withheld reply's Evidence and its Turn's text, and keeps the row and its link", () => {
    const w = world();
    const blocked = w.evidence.map((e) => (e.id === AFTER ? { ...e, evidence: { ...e.evidence, status: "blocked" as const } } : e));
    const writes = planPurge({ now, blockedEids: [], memoryIds: [], requestTurns: [], evidence: blocked, memories: [], turns: w.turns });
    expect(writes.find((x) => x.collection === "evidence" && x.id === AFTER)?.doc).toMatchObject({ status: "purged", text: null });
    const turn = writes.find((x) => x.collection === "turns");
    expect(turn?.doc).toMatchObject({ text: null, evidenceId: AFTER });
    expect(writes.filter((x) => x.collection === "turns")).toHaveLength(1);
  });

  it("a delivered moment worded from a derivative loses its rendered line and keeps its state", () => {
    const w = world();
    const moment = { id: testId("mo"), moment: { ...sampleMomentLike(), memoryId: testId("m-target"), status: "delivered" as const, rendered: { noteId: testId("n"), text: "How's Danny?", tokens: [], at: now } } };
    const plan = planClosure({ ...w, moments: [moment as never] });
    const write = plan.groups.flatMap((g) => g.writes).find((x) => x.collection === "moments");
    expect(write?.doc).toMatchObject({ status: "delivered", rendered: null });
  });
});

describe("ruling 17: purge empties the owner's words in args and alternatives", () => {
  it("a label in args goes, the predicate's required keys stay valid, and a hypothesis loses its alternatives", () => {
    const m = sampleMemory({ status: "retracted", args: { topic: "relationship", label: "brother" } });
    expect(purgedArgs(m).label).not.toBe("brother");
    const withHyp = { ...m, id: testId("m2"), hypothesis: { premiseIds: [], alternatives: ["he relapsed"], confidence: 0.5 } } as never;
    const writes = planPurge({ now, blockedEids: [], memoryIds: [testId("m"), testId("m2")], requestTurns: [], evidence: [], memories: [{ id: testId("m"), memory: m }, { id: testId("m2"), memory: withHyp }], turns: [] });
    const doc = writes.find((w) => w.id === testId("m"))!.doc as { args: Record<string, unknown> };
    expect(JSON.stringify(doc.args)).not.toContain("brother");
    const hyp = writes.find((w) => w.id === testId("m2"))!.doc as unknown as { hypothesis: { alternatives: string[] } };
    expect(hyp.hypothesis.alternatives).toEqual([]);
  });
});

/** The fields closure reads of a Moment, from a sample Evidence's common fields. */
function sampleMomentLike() {
  const e = sampleEvidence();
  return { ...e, rollupId: null, actionId: null, kind: "checkIn", rendered: null, leaseToken: null, leaseUntil: null, cancelReason: null };
}
