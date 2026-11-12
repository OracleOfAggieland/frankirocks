// Feature: voice-writes (brief 012 wave C, task C1), Property 7: no double apply (design section 7, section 5). The
// on-turn route followed by extraction equals the route alone, for what the route handled. After one correction turn
// (`testing/arb-corrections.ts`) and then its Extract_Job, with a Fake_OpenAI output that repeats the handled item,
// says the new name as a mention, or adds an unrelated item: let D be every Memory that differs between the store
// before the route's transaction and after it, plus every target the correction named when the route applied it (a deferred correction is extraction's to apply). After extraction:
//   - every Memory in D is unchanged;
//   - no new Memory has the key of a Memory in D;
//   - an unrelated item is written as usual;
//   - every single-valued key has at most one active row.
// `handled` is not used as the oracle.
import { type Memory, PREDICATE_SPECS } from "@franki/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { changedIds, correctionSpecArb, runCorrection } from "../testing/arb-corrections";

describe("Property 7: no double apply", () => {
  it("extraction after the route changes nothing the route handled", { timeout: 600_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(correctionSpecArb, async (spec) => {
        const t = await runCorrection(spec);
        const what = `${JSON.stringify(spec)} "${t.text}"`;
        const named = spec.kind === "value" ? [t.seeded.selfNameId] : spec.kind === "unknownTarget" ? [] : [t.seeded.relId];
        const D = new Set([...changedIds(t.before, t.afterRoute), ...(t.applicable ? named : [])]);
        for (const id of D) expect(t.afterExtract.get(id), `${what}: extraction changed ${id}`).toEqual(t.afterRoute.get(id));
        const keys = new Set([...D].flatMap((id) => (t.afterRoute.has(id) ? [t.afterRoute.get(id)!.key] : [])));
        const added = [...t.afterExtract.entries()].filter(([id]) => !t.afterRoute.has(id));
        for (const [id, m] of added) expect(keys.has(m.key), `${what}: extraction wrote ${id} (${m.predicate} ${JSON.stringify(m.value)}) on a handled key`).toBe(false);
        if (spec.extraction === "unrelated" && t.status === 200) {
          const said = t.text.slice(0, -1);
          expect(added.some(([, m]) => m.value.kind === "text" && m.value.text === said), `${what}: the unrelated item was not written`).toBe(true);
        }
        const active = new Map<string, number>();
        for (const m of t.afterExtract.values() as Iterable<Memory>) if (m.status === "active" && PREDICATE_SPECS[m.predicate as keyof typeof PREDICATE_SPECS]?.single === true) active.set(m.key, (active.get(m.key) ?? 0) + 1);
        for (const [k, n] of active) expect(n, `${what}: ${n} active rows on single-valued key ${k}`).toBeLessThanOrEqual(1);
      }),
      { numRuns: 1000 },
    );
  });
});
