/**
 * The load is the same writes (brief 019 "The load is the same writes"; spec §4 "they enter through the same writes
 * as live data would"). For any zone and clock:
 *   - every row the load wrote passes the validators a live write passes: its closed record schema, and for a Memory
 *     W-LINEAGE against the stored Evidence;
 *   - a seed whose packet quotes a span that is not in its Evidence fails the load with spanNotInEvidence, and the
 *     load writes nothing.
 *
 * Runs: RUNS (each case loads the persona once, about 0.2 s).
 */
import { type Memory, validate } from "@franki/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { lineageFailures, schemaFor } from "../store/checks";
import { parseDocPath, paths } from "../store/paths";
import { testRig } from "../testing/fakes";
import { SEED_ZONES } from "../testing/seed";
import { SeedLoadError } from "./build";
import { listTenantRows } from "./clear";
import { cloneWorldStart } from "./clock";
import type { AuthoredSpan, SeedFixture, SeedLine } from "./fixture";
import { loadSeed } from "./load";
import { PERSONA } from "./persona";

const RUNS = 25;
const UID = "owner-1";
const YEAR_MS = 365 * 86_400_000;
const OPS_FROM = Date.UTC(2026, 0, 1);

const zone = fc.constantFrom(...SEED_ZONES);
const ops = fc.integer({ min: OPS_FROM, max: OPS_FROM + 2 * YEAR_MS });

/** Every authored span of a line, as mutable references. */
function spansOf(line: SeedLine): AuthoredSpan[] {
  if (line.kind === "turn") return [...line.extract.flatMap((i) => [...i.spans, ...(i.mentions ?? []).map((m) => m.span)]), ...(line.privateRead ?? []).flatMap((g) => [...g.support, ...(g.counter ?? [])])];
  if (line.kind === "mail") {
    const c = line.claims ?? {};
    return [
      ...(c.logistics ?? []).flatMap((l) => l.spans),
      ...(c.senderPromises ?? []).flatMap((p) => p.spans),
      ...(c.claimsAboutUser ?? []).flatMap((x) => x.spans),
      ...(c.topicSignals ?? []).flatMap((x) => x.spans),
      ...(line.inbound ?? []).flatMap((x) => x.spans),
    ];
  }
  return [];
}

const SPANNED = PERSONA.lines.map((l, i) => ({ i, n: spansOf(l).length })).filter((x) => x.n > 0);

describe("the seed load is the same writes", () => {
  it("every row passes the validators a live write passes", async () => {
    await fc.assert(
      fc.asyncProperty(zone, ops, async (z, now) => {
        const rig = testRig();
        rig.clock.advance(Math.max(0, now - rig.clock.read().opsClock.now));
        await loadSeed(rig.deps, UID, { fixture: PERSONA, namespace: rig.deps.hasher.id(["ns", now]), zone: z, worldStart: cloneWorldStart(rig.clock.read().opsClock.now, z), core: { epoch: 1, policyRev: 1 } });
        const rows = await listTenantRows(rig.store, UID);
        expect(rows.filter((r) => r.path.includes("/memories/")).length).toBe(43);
        for (const r of rows) {
          const v = validate(schemaFor(parseDocPath(UID, r.path)), r.data);
          expect(v.ok, r.path).toBe(true);
          if (r.path.includes("/memories/")) {
            const failures = await lineageFailures(r.data as Memory, async (eid) => (await rig.store.get(UID, paths.evidence(UID, eid)))?.data as never, rig.deps.hasher);
            expect(failures).toEqual([]);
          }
        }
      }),
      { numRuns: RUNS },
    );
  }, 600_000);

  it("a span that is not in its Evidence fails the load, and nothing is written", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...SPANNED).chain((l) => fc.record({ line: fc.constant(l.i), span: fc.integer({ min: 0, max: l.n - 1 }), edit: fc.constantFrom("append", "case", "drop") })),
        zone,
        async ({ line, span, edit }, z) => {
          const fixture: SeedFixture = structuredClone(PERSONA);
          const target = spansOf(fixture.lines[line]!)[span]!;
          const text = target.quote;
          target.quote = edit === "append" ? `${text} zq` : edit === "case" ? `${text.slice(0, -1)}${text.at(-1) === "Q" ? "q" : "Q"}` : `#${text}`;
          const rig = testRig();
          const error = await loadSeed(rig.deps, UID, { fixture, namespace: rig.deps.hasher.id(["ns", 1]), zone: z, worldStart: cloneWorldStart(rig.clock.read().opsClock.now, z), core: { epoch: 1, policyRev: 1 } }).then(
            () => null,
            (e: unknown) => e,
          );
          expect(error).toBeInstanceOf(SeedLoadError);
          expect((error as SeedLoadError).check).toBe("spanNotInEvidence");
          expect(await listTenantRows(rig.store, UID)).toEqual([]);
        },
      ),
      { numRuns: RUNS },
    );
  }, 600_000);
});
