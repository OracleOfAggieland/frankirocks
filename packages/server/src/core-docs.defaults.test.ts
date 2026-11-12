// Brief 018 task B2: `core/rules` written before wave B lacks `subjectLabels`, `proposals`, `handled` and `ask`.
// `readCoreDocs` fills them, so a read for update writes a document that passes the closed schema.
import { type CoreRules, withRulesDefaults } from "@franki/core";
import { describe, expect, it } from "vitest";
import { ensureCoreDocs, readCoreDocs } from "./core-docs";
import { paths } from "./store/paths";
import { testRig } from "./testing/fakes";

const UID = "owner-1";

describe("core/rules defaults read", () => {
  it("fills wave B's fields on a document written before them, and the update passes the schema", async () => {
    const rig = testRig();
    await ensureCoreDocs(UID, rig.deps);
    // Strip the new fields from the stored document, as a pre-change write left it.
    const raw = (rig.store as unknown as { docs: Map<string, Record<string, unknown>> }).docs.get(paths.core(UID, "rules"))!;
    for (const k of ["subjectLabels", "proposals", "handled", "ask"]) delete raw[k];
    const read = await rig.store.transaction(UID, async (tx) => {
      const core = await readCoreDocs(tx, UID);
      tx.update(paths.core(UID, "rules"), { ...core.rules.data, rulesRev: core.rules.data.rulesRev + 1 });
      return core.rules.data;
    });
    expect({ subjectLabels: read.subjectLabels, proposals: read.proposals, handled: read.handled, ask: read.ask }).toEqual({ subjectLabels: [], proposals: [], handled: [], ask: { sessionId: null, q: { kind: "none" } } });
    const after = (await rig.store.get<CoreRules>(UID, paths.core(UID, "rules")))!.data;
    expect(after.rulesRev).toBe(2);
    expect(after.ask).toEqual({ sessionId: null, q: { kind: "none" } });
  });
  it("leaves a current document as it is", () => {
    const r = { subjectLabels: [{ subjectId: "e1", label: "your brother" }], proposals: [], handled: [], ask: { sessionId: "s1", q: { kind: "none" } } } as unknown as CoreRules;
    expect(withRulesDefaults(r)).toEqual(r);
  });
});
