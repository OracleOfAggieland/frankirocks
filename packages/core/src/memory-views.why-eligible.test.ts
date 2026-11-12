// Review 028, finding 5: the `why` view quotes only root Evidence that passes the one `eligible` function.
import { describe, expect, it } from "vitest";
import { type ViewContext, type ViewRow, whyView } from "./memory-views";
import type { Evidence } from "./schema/records";
import { sampleEC, sampleSnapshot } from "./testing/eligibility";
import { commonFields, sampleBlock, sampleEvidence, sampleMemory, sampleSlice, testId } from "./testing/samples";

const EID = testId("rootEv");
const OTHER = testId("depEv");
const PROVIDER = testId("provider");
const TEXT = "My dog is called Pip.";

const root: Evidence = sampleEvidence({
  ...commonFields({ rootKeys: [testId("evRoot")] }),
  kind: "turn",
  status: "retained",
  providerKey: PROVIDER,
  text: { kind: "inline", text: TEXT },
  fieldSlices: [sampleSlice({ eid: EID, start: 0, end: TEXT.length })],
} as Partial<Evidence>);
const dep: Evidence = sampleEvidence({ ...commonFields(), kind: "turn", status: "retained", text: { kind: "inline", text: TEXT } } as Partial<Evidence>);
// The root Evidence is named by no dependsOn entry: the route reads it directly.
const row: ViewRow = {
  id: testId("pip"),
  memory: sampleMemory({
    ...commonFields({ rootKeys: [testId("root")], rootSlices: [sampleSlice({ eid: EID, start: 0, end: 6 })], packetEids: [OTHER], dependsOn: [`e:${OTHER}`] }),
    status: "active",
    sourceClass: "U",
    value: { kind: "text", text: "My dog is called Pip" },
  }),
};

function ctxWith(blocks: ReturnType<typeof sampleBlock>[]): ViewContext {
  const snapshot = sampleSnapshot({ memories: [[row.id, row.memory]], evidence: [[OTHER, dep], [EID, root]] }, { blocks });
  return { ec: sampleEC({ purpose: "inspect", operation: "card" }), snapshot, noteFor: (id) => id, expiresAt: "2026-11-03T12:01:00.000Z" };
}

describe("whyView: root Evidence goes through eligible", () => {
  it("quotes the root when nothing blocks it", () => {
    const out = whyView([row], new Map([[EID, root]]), row.id, ctxWith([]));
    expect(out.map((o) => o.kind)).toEqual(["memory", "evidence"]);
  });

  it("does not quote a provider-blocked root Evidence of a shown Memory", () => {
    const block = sampleBlock({ kind: "provider", rootKey: null, providerKey: PROVIDER, key: PROVIDER });
    const out = whyView([row], new Map([[EID, root]]), row.id, ctxWith([block]));
    expect(out.map((o) => o.kind)).toEqual(["memory"]);
  });
});
