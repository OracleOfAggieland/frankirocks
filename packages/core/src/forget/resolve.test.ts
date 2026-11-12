import { describe, expect, it } from "vitest";
import type { ID, Span } from "../schema/primitives";
import type { Memory } from "../schema/records";
import { sampleCoreDocs, sampleMemory, testId } from "../testing/samples";
import { RESOLVE_FLOOR_MAX, RESOLVE_PAGE, checkResolve, resolveInput, targetRefs } from "./resolve";
import { EID_A, evidenceOf, forgetHasher, memoryOn } from "./testing/arb-forget";

const TEXT = "Danny relapsed. Ana is moving to Austin.";
const evidence = new Map([[EID_A, evidenceOf(EID_A, TEXT, forgetHasher)]]);
const fact = (label: string, text: string, start: number, end: number): { id: ID; memory: Memory } => ({
  id: testId(label),
  memory: { ...memoryOn(EID_A, TEXT, start, end, label, forgetHasher), value: { kind: "text", text } },
});
const DANNY = fact("danny", "Danny relapsed", 0, 15);
const ANA = fact("ana", "Ana is moving to Austin", 16, 40);
const REQUEST: Span = { eid: testId("req"), fieldPath: "text", start: 0, end: 21, quote: "Forget that Danny relapsed" };

function manifest(memories = [DANNY, ANA], requestText = "Forget that Danny relapsed") {
  return resolveInput({
    request: REQUEST,
    requestText,
    turns: [{ itemId: "item1", seq: 1, eid: EID_A, text: TEXT, state: "ready" }],
    memories,
    rules: sampleCoreDocs().rules,
  });
}

const answer = (o: Partial<Record<string, unknown>> = {}) => ({
  resolution: "exact",
  remove: [],
  candidateIds: [DANNY.id],
  entityIds: [],
  topicKeys: [],
  needsMore: false,
  clarification: null,
  ...o,
});

const check = (output: unknown, o: { requestText?: string; fragmentGapMs?: number | null; memories?: { id: ID; memory: Memory }[] } = {}) =>
  checkResolve({ opId: testId("op"), manifest: manifest(o.memories, o.requestText), requestText: o.requestText ?? "Forget that Danny relapsed", fragmentGapMs: o.fragmentGapMs ?? null, evidence, output });

describe("resolveInput (contracts §5 ForgetResolveV1)", () => {
  it("puts current-session candidates first and labels them from their line, at most 80 units", () => {
    const other = { ...sampleMemory({ logicalId: testId("o") }), value: { kind: "text" as const, text: "x".repeat(200) } };
    const m = manifest([{ id: testId("other"), memory: other }, DANNY]);
    expect(m.input.candidates[0]!.id).toBe(DANNY.id);
    expect(m.input.candidates.every((c) => c.label.length <= 80)).toBe(true);
    expect(m.complete).toBe(true);
  });

  it("gives the model at most one page and marks a scan past the floor incomplete", () => {
    const many = Array.from({ length: RESOLVE_FLOOR_MAX + 1 }, (_, i) => ({ id: testId(`m${i}`), memory: sampleMemory() }));
    const m = manifest(many);
    expect(m.input.candidates.length).toBe(RESOLVE_PAGE);
    expect(m.complete).toBe(false);
  });
});

describe("checkResolve (spec §8 step 4)", () => {
  it("an exact named match goes", () => {
    const r = check(answer());
    expect(r.kind).toBe("exact");
    expect(targetRefs(r)).toEqual([{ type: "memory", id: DANNY.id, rev: 1 }]);
  });

  it("removes only spans whose quote verifies on this session's text, and holds when one does not (review 028)", () => {
    const good = { eid: EID_A, fieldPath: "text", start: 0, end: 15, quote: "Danny relapsed." };
    const bad = { eid: EID_A, fieldPath: "text", start: 0, end: 15, quote: "Something else." };
    expect(check(answer({ remove: [good] }))).toMatchObject({ kind: "exact", remove: [good] });
    expect(check(answer({ remove: [good, bad] }))).toMatchObject({ kind: "scopePending", reason: "invalid" });
  });

  it.each([
    ["ambiguous", answer({ resolution: "ambiguous", candidateIds: [DANNY.id, ANA.id] }), {}],
    ["vague cue over two memories", answer({ candidateIds: [DANNY.id, ANA.id] }), { requestText: "Forget all that" }],
    ["fragment under a second", answer(), { fragmentGapMs: 400 }],
    ["needsMore", answer({ needsMore: true }), {}],
    ["none", answer({ resolution: "none", candidateIds: [] }), {}],
    ["an unknown candidate only", answer({ candidateIds: [testId("ghost")] }), {}],
    ["an invalid answer", { resolution: "everything" }, {}],
  ] as const)("holds and asks on %s, removing nothing", (_why, output, o) => {
    const r = check(output, o);
    expect(r.kind).toBe("scopePending");
    if (r.kind === "scopePending") {
      expect(r.card.options.length).toBeLessThanOrEqual(4);
      for (const opt of r.card.options) expect(Object.keys(opt).sort()).toEqual(["kind", "optionId", "ordinal", "saidOn"]);
    }
  });

  it("two memories both named by the request go together", () => {
    expect(check(answer({ candidateIds: [DANNY.id, ANA.id] }), { requestText: "Forget Danny and Ana" }).kind).toBe("exact");
  });

  it("never removes a hard rule named as a candidate", () => {
    const rules = { ...sampleCoreDocs().rules, allergies: [{ id: testId("rule"), subjectId: "self", code: "shellfish", state: "active" as const, anonymous: false, proof: null, proofRev: null, rootKeys: [], dependsOn: [] }] };
    const m = resolveInput({ request: REQUEST, requestText: "Forget my allergy", turns: [], memories: [DANNY], rules });
    const r = checkResolve({ opId: testId("op"), manifest: m, requestText: "Forget my allergy", fragmentGapMs: null, evidence, output: answer({ candidateIds: [testId("rule")] }) });
    expect(r).toMatchObject({ kind: "scopePending", reason: "protectedRule" });
  });
});
