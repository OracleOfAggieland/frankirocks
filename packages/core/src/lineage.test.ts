import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJSON, type Hasher, rootKey } from "./ids";
import { resolveLineage } from "./lineage";
import { turnTextSlice } from "./slices";
import { sampleEvidence, sampleMemory, testId } from "./testing/samples";

const hasher: Hasher = {
  id: (parts) => createHash("sha256").update(canonicalJSON(parts)).digest("base64url"),
  sha256: (bytes) => createHash("sha256").update(bytes).digest("hex"),
};

const TEXT = "My dog is called Pip";
const EID = testId("ev1");
const evidence = sampleEvidence({ text: { kind: "inline", text: TEXT }, fieldSlices: [turnTextSlice(EID, TEXT, "U", hasher)] });
const slice = evidence.fieldSlices[0]!;
const memory = sampleMemory({ rootSlices: [slice], rootKeys: [rootKey(slice, hasher)], dependsOn: [`e:${EID}`] });
const map = new Map([[EID, evidence]]);

const kinds = (r: ReturnType<typeof resolveLineage>) => (r.ok ? [] : r.failures.map((f) => f.kind));

describe("resolveLineage", () => {
  it("resolves a valid Memory to its Evidence text", () => {
    const r = resolveLineage({ memory, evidence: map, hasher, spans: [{ eid: EID, fieldPath: "text", start: 17, end: 20, quote: "Pip" }] });
    expect(r.ok).toBe(true);
    expect(r.links.map((l) => l.text)).toEqual([TEXT]);
    expect(r.spans.map((s) => s.text)).toEqual(["Pip"]);
  });

  it("missing Evidence, including another Owner's", () => {
    expect(kinds(resolveLineage({ memory, evidence: new Map(), hasher }))).toEqual(["missingEvidence"]);
    const foreign = new Map([[EID, { ...evidence, uid: "owner-2" }]]);
    expect(kinds(resolveLineage({ memory, evidence: foreign, hasher }))).toEqual(["missingEvidence"]);
  });

  it("Slice hash mismatch", () => {
    const bad = { ...slice, end: 6 };
    const m = { ...memory, rootSlices: [bad], rootKeys: [rootKey(bad, hasher)] };
    expect(kinds(resolveLineage({ memory: m, evidence: map, hasher }))).toEqual(["sliceHashMismatch"]);
  });

  it("Span quote mismatch, bad range and unknown eid", () => {
    const r = resolveLineage({
      memory,
      evidence: map,
      hasher,
      spans: [
        { eid: EID, fieldPath: "text", start: 17, end: 20, quote: "Rex" },
        { eid: EID, fieldPath: "text", start: 17, end: 99, quote: "Pip" },
        { eid: testId("nope"), fieldPath: "text", start: 0, end: 2, quote: "My" },
      ],
    });
    expect(kinds(r)).toEqual(["spanQuoteMismatch", "spanQuoteMismatch", "missingEvidence"]);
  });

  it("an empty Span [n, n) with quote '' is a Span quote mismatch", () => {
    const r = resolveLineage({ memory, evidence: map, hasher, spans: [{ eid: EID, fieldPath: "text", start: 3, end: 3, quote: "" }] });
    expect(kinds(r)).toEqual(["spanQuoteMismatch"]);
  });

  it("an empty root Slice [n, n) is a Slice hash mismatch, even with the hash of ''", () => {
    const empty = { ...slice, start: 3, end: 3, contentHash: hasher.sha256(new TextEncoder().encode("")) };
    const m = { ...memory, rootSlices: [empty], rootKeys: [rootKey(empty, hasher)] };
    expect(kinds(resolveLineage({ memory: m, evidence: map, hasher }))).toEqual(["sliceHashMismatch"]);
  });

  it("root key mismatch", () => {
    expect(kinds(resolveLineage({ memory: { ...memory, rootKeys: [testId("x")] }, evidence: map, hasher }))).toEqual(["rootKeyMismatch"]);
    expect(kinds(resolveLineage({ memory: { ...memory, rootKeys: [] }, evidence: map, hasher }))).toEqual(["rootKeyMismatch"]);
  });

  it("missing dependsOn entry", () => {
    expect(kinds(resolveLineage({ memory: { ...memory, dependsOn: ["m:x@1"] }, evidence: map, hasher }))).toEqual(["missingDependsOn"]);
  });

  it("is deterministic", () => {
    const input = { memory: { ...memory, dependsOn: [] }, evidence: map, hasher };
    expect(resolveLineage(input)).toEqual(resolveLineage(input));
  });
});
