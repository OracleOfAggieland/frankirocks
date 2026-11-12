// Review 028, finding 4: resolve never answers "exact" after dropping a removal it could not verify.
import { describe, expect, it } from "vitest";
import type { ID } from "../schema/primitives";
import type { Memory } from "../schema/records";
import { sampleCoreDocs, testId } from "../testing/samples";
import { checkResolve, resolveInput } from "./resolve";
import { EID_A, evidenceOf, forgetHasher, memoryOn } from "./testing/arb-forget";

const TEXT = "Danny relapsed. Ana is moving to Austin.";
const evidence = new Map([[EID_A, evidenceOf(EID_A, TEXT, forgetHasher)]]);
const DANNY: { id: ID; memory: Memory } = { id: testId("danny"), memory: { ...memoryOn(EID_A, TEXT, 0, 15, "danny", forgetHasher), value: { kind: "text", text: "Danny relapsed" } } as Memory };
const manifest = resolveInput({
  request: { eid: testId("req"), fieldPath: "text", start: 0, end: 26, quote: "Forget that Danny relapsed" },
  requestText: "Forget that Danny relapsed",
  turns: [{ itemId: "item1", seq: 1, eid: EID_A, text: TEXT, state: "ready" }],
  memories: [DANNY],
  rules: sampleCoreDocs().rules,
});
const answer = (remove: unknown[]) => ({ resolution: "exact", remove, candidateIds: [DANNY.id], entityIds: [], topicKeys: [], needsMore: false, clarification: null });
const check = (remove: unknown[]) => checkResolve({ opId: testId("op"), manifest, requestText: "Forget that Danny relapsed", fragmentGapMs: null, evidence, output: answer(remove) });

describe("checkResolve: a dropped removal holds and asks", () => {
  it("one named candidate plus a misquoted session span is held, not exact", () => {
    const misquoted = { eid: EID_A, fieldPath: "text", start: 16, end: 40, quote: "Ana is moving to Boston." };
    expect(check([misquoted])).toMatchObject({ kind: "scopePending", reason: "invalid" });
  });

  it("a span outside this session and its candidates is held, not exact", () => {
    const foreign = { eid: testId("elsewhere"), fieldPath: "text", start: 0, end: 5, quote: "Hello" };
    expect(check([foreign])).toMatchObject({ kind: "scopePending", reason: "invalid" });
  });

  it("every span verified still goes exact", () => {
    const good = { eid: EID_A, fieldPath: "text", start: 16, end: 40, quote: "Ana is moving to Austin." };
    expect(check([good])).toMatchObject({ kind: "exact", remove: [good] });
  });
});
