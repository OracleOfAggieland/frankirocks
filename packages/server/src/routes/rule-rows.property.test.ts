// Brief 042 item 6 (question W-166): every change the hard-rule route makes to `core/rules` has its ledger row, and
// every row names a change that happened. After sequences of allergy turns on `/api/turn` (`testing/arb-rule-turns.ts`),
// for each turn:
//   - each rule new after the turn is named by a ruleWritten, pendingWritten or proposalInstalled row;
//   - each pending rule gone after the turn is named by a pendingResolved row;
//   - each subject added to or removed from noneConfirmed is named by a noneConfirmed row;
//   - a turn the route recorded as notAllergy or denialRecorded has that row, citing its Evidence;
//   - a ruleWritten row citing the turn's Evidence names only rules active after it;
//   - no row carries a quote.
import type { Ledger, RuleRowPayload } from "@franki/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { listTenantRows } from "../seed/clear";
import { UID, handledFor, runRuleSequence, sequenceArb } from "../testing/arb-rule-turns";

const SEED = 42066;

describe("brief 042 item 6: no rule change without its row", () => {
  it("every change to core/rules has a row, and every row a change", { timeout: 1_800_000 }, async () => {
    let changes = 0;
    await fc.assert(
      fc.asyncProperty(sequenceArb(), async (seq) => {
        const trace = await runRuleSequence(seq);
        const rows: RuleRowPayload[] = (await listTenantRows(trace.rig.store, UID)).filter((r) => r.path.includes("/ledger/") && (r.data as Ledger).kind === "rule").map((r) => (r.data as Extract<Ledger, { kind: "rule" }>).payload);
        expect(JSON.stringify(rows)).not.toContain("quote");
        const named = (decisions: RuleRowPayload["decision"][]) => new Set(rows.filter((r) => decisions.includes(r.decision)).flatMap((r) => r.rules.map((x) => x.ruleId)));
        const made = named(["ruleWritten", "pendingWritten", "proposalInstalled"]);
        const resolved = named(["pendingResolved"]);
        const none = rows.filter((r) => r.decision === "noneConfirmed").flatMap((r) => r.subjects.map((s) => `${s.change}:${s.subjectId}`));
        for (const [i, t] of trace.turns.entries()) {
          const at = `turn ${i + 1} (${t.spec.kind}, ${t.spec.slots})`;
          const before = new Map(t.rulesBefore.allergies.map((r) => [r.id, r]));
          const after = new Map(t.rulesAfter.allergies.map((r) => [r.id, r]));
          for (const r of t.rulesAfter.allergies) {
            if (before.has(r.id)) continue;
            changes++;
            expect(made.has(r.id), `${at}: new rule ${r.subjectId}:${r.code}:${r.state} has no row`).toBe(true);
          }
          for (const r of t.rulesBefore.allergies) {
            if (r.state !== "pending" || after.has(r.id)) continue;
            changes++;
            expect(resolved.has(r.id), `${at}: pending ${r.subjectId}:${r.code} gone with no row`).toBe(true);
          }
          for (const s of t.rulesAfter.noneConfirmed.filter((x) => !t.rulesBefore.noneConfirmed.includes(x))) expect(none, `${at}: none added`).toContain(`added:${s}`);
          for (const s of t.rulesBefore.noneConfirmed.filter((x) => !t.rulesAfter.noneConfirmed.includes(x))) expect(none, `${at}: none removed`).toContain(`removed:${s}`);
          const mine = rows.filter((r) => r.eid === t.evidenceId);
          const outcomes = handledFor(t.rulesAfter, t.evidenceId).filter((h) => h.route === "hardRule").map((h) => h.outcome);
          if (outcomes.includes("notAllergy")) expect(mine.some((r) => r.decision === "notAllergy"), `${at}: notAllergy`).toBe(true);
          if (outcomes.includes("denialRecorded")) expect(mine.some((r) => r.decision === "denialRecorded"), `${at}: denialRecorded`).toBe(true);
          for (const r of mine.filter((x) => x.decision === "ruleWritten" && (x.source === "turn" || x.source === "late"))) {
            for (const x of r.rules) expect(t.rulesAfter.allergies.some((a) => a.id === x.ruleId && a.state === "active"), `${at}: ruleWritten names ${x.code}, not active`).toBe(true);
          }
        }
      }),
      { numRuns: 1000, seed: SEED },
    );
    expect(changes).toBeGreaterThan(0);
  });
});
