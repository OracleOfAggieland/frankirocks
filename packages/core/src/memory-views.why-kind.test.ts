// Review 028, finding 9: the `why` view sends the Evidence kind as a code; the browser words it (ui/copy.ts).
import { describe, expect, it } from "vitest";
import { whyView } from "./memory-views";
import { buildStore } from "./testing/memory-store-arb";

describe("whyView: a root's label is its Evidence kind code", () => {
  it.each(["turn", "message", "calendar"] as const)("labels a %s root with its code, not words", (kind) => {
    const s = buildStore({
      audience: "private",
      evidence: [{ kind, status: "retained", sens: "S0" }],
      decisions: [],
      memories: [{ status: "active", sourceClass: "U", sens: "S0", flow: "open", forgotten: false, dirty: false, dep: 0, text: "My dog is called Pip", assertedDay: 1 }],
    });
    const roots = whyView(s.rows, s.evidence, s.rows[0]!.id, s.ctx).filter((i) => i.kind === "evidence");
    expect(roots.map((r) => r.label)).toEqual([kind]);
  });
});
