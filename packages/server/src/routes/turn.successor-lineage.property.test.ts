// Feature: voice-writes (brief 012 wave C, task C1), Property 8, route half for corrections: every successor resolves
// through its span to Evidence text that matches (design section 7, G37; contracts §1 KC03). After one correction turn
// on `/api/turn` (`testing/arb-corrections.ts`), for every Memory the route wrote:
//   - each root slice's Evidence exists and its root keys are that Evidence's;
//   - a text value occurs as whole words in its root slices' text;
//   - it depends on the turn's Evidence and on every Memory of the FastSlots packet except the rows the plan closed.
// And a valid, applicable correction on a speaker-certain turn wrote at least one row (the route ran).
import { type Evidence, type Memory, rootKey } from "@franki/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { paths } from "../store/paths";
import { UID, changedIds, correctionSpecArb, runCorrection } from "../testing/arb-corrections";

const text = (e: Evidence | null) => (e?.text?.kind === "inline" ? e.text.text : "");
const words = (s: string) => s.normalize("NFKC").toLowerCase();

describe("Property 8 (route): successor lineage", () => {
  it("every row a correction writes quotes its Evidence", { timeout: 600_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(correctionSpecArb.map((s) => ({ ...s, extraction: "none" as const })), async (spec) => {
        const t = await runCorrection(spec);
        const written = changedIds(t.before, t.afterRoute).map((id) => [id, t.afterRoute.get(id)!] as const).filter(([, m]) => t.evidenceId !== null && m.packetEids.includes(t.evidenceId));
        const what = `${JSON.stringify(spec)} "${t.text}"`;
        // A retraction writes no successor: only the target moves to `wrong`.
        if (t.applicable && spec.kind !== "retract") expect(written.length, `${what}: the route wrote nothing`).toBeGreaterThan(0);
        const closed = new Set(changedIds(t.before, t.afterRoute).filter((id) => t.before.has(id)));
        for (const [id, m] of written as (readonly [string, Memory])[]) {
          for (const s of m.rootSlices) {
            const ev = (await t.rig.store.get<Evidence>(UID, paths.evidence(UID, s.eid)))?.data ?? null;
            expect(ev, `${what}: ${id} roots in missing Evidence`).not.toBeNull();
            const keys = new Set(ev!.fieldSlices.map((x) => rootKey(x, t.rig.deps.hasher)));
            for (const k of m.rootKeys) if (m.rootSlices.length === 1) expect(keys.has(k), `${what}: ${id} root key not of its Evidence`).toBe(true);
            if (m.value.kind === "text" && s.start !== null && s.end !== null && m.status !== "wrong") expect(words(text(ev).slice(s.start, s.end)), `${what}: ${id} value not in its span`).toContain(words(m.value.text));
          }
          if (m.status === "wrong" || !t.before.has(id)) {
            if (!t.before.has(id) && m.status !== "wrong") {
              expect(m.dependsOn, `${what}: ${id} doesn't depend on the turn`).toContain(`e:${t.evidenceId}`);
              for (const ref of [t.seeded.relId, t.seeded.selfNameId]) if (!closed.has(ref) && m.supportingIds.some((x) => x.id === ref)) expect(m.dependsOn.some((d) => d.includes(ref)), `${what}: ${id} drops packet input ${ref}`).toBe(true);
            }
          }
        }
      }),
      { numRuns: 1000 },
    );
  });
});
