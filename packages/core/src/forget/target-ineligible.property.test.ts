// Feature: forget (brief 021), Property FP6: a direct target is ineligible after install (spec §8 step 5, "Eligibility";
// contracts §4 eligible; KC06). For any forget, after `planInstall`'s writes are applied, every Memory the resolve
// named and every Evidence whose range it named is denied by `eligible` in every context: each stage, each execution.
// To make the check bite, the post-install store is read as resume would leave it: barrier cleared and every row
// restamped to the new epoch, so neither the barrier nor the epoch fence does the denying.
// This is about named targets only. It says nothing about rows derived from them.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type DocRef, ELIGIBILITY_STAGES, type Snapshot, type SnapshotRow, eligible } from "../eligible";
import type { ID } from "../schema/primitives";
import type { Block, Evidence, Memory } from "../schema/records";
import { sampleEC } from "../testing/eligibility";
import { UID, sampleCoreDocs, sampleJob, sampleSession, testId } from "../testing/samples";
import { planInstall } from "./install";
import { forgetStoreArb } from "./testing/arb-forget";

const EXECUTIONS = ["browser", "serverForeground", "worker"] as const;

describe("FP6: a direct target is ineligible after install", () => {
  it("every named Memory and every named Evidence is denied in every context", () => {
    fc.assert(
      fc.property(forgetStoreArb, (st) => {
        const plan = planInstall(st.input);
        const { epoch, policyRev } = st.input.stamps;
        const restamp = <T extends { epoch: number; policyRev: number }>(r: T): T => ({ ...r, epoch, policyRev });
        const memories = new Map<ID, Memory>([...st.input.targets, ...st.others].map((m) => [m.id, m.memory]));
        const evidence = new Map<ID, Evidence>(st.input.evidence);
        const overlays = new Map<ID, SnapshotRow>();
        const blocks: Block[] = [];
        for (const w of plan.writes) {
          if (w.collection === "memories") memories.set(w.id, w.doc);
          if (w.collection === "evidence") evidence.set(w.id, w.doc);
          if (w.collection === "overlays") overlays.set(w.id, w.doc);
          if (w.collection === "blocks") blocks.push(w.doc);
        }
        const refs: DocRef[] = [];
        const rows: SnapshotRow[] = [];
        const add = (collection: DocRef["collection"], id: ID, row: SnapshotRow) => {
          refs.push({ collection, id, parentId: null, rev: row.rev });
          rows.push(restamp(row));
        };
        for (const [id, m] of memories) add("memories", id, m);
        for (const [id, e] of evidence) add("evidence", id, e);
        for (const [id, o] of overlays) add("overlays", id, o);
        const core = sampleCoreDocs();
        const job = sampleJob({ leaseToken: testId("lease"), generation: 1 });
        const s: Snapshot = {
          uid: UID,
          epoch: { ...core.epoch, epoch, policyRev, barrier: null },
          session: sampleSession({ generation: 1 }),
          job,
          localGeneration: 1,
          refs,
          rows,
          blocks: blocks.map(restamp),
          coverage: { state: "complete", from: null, to: null, missingRanges: [], generation: 0 },
          complete: true,
        };
        const named: { ref: DocRef; row: SnapshotRow }[] = [];
        for (const t of st.input.targets) named.push({ ref: { collection: "memories", id: t.id, parentId: null, rev: 1 }, row: restamp(memories.get(t.id)!) });
        for (const eid of new Set(st.input.remove.filter((r) => r.end > r.start).map((r) => r.eid))) {
          named.push({ ref: { collection: "evidence", id: eid, parentId: null, rev: 1 }, row: restamp(evidence.get(eid)!) });
        }
        for (const stage of ELIGIBILITY_STAGES) {
          for (const execution of EXECUTIONS) {
            const c = sampleEC({ epoch, policyRev, stage, execution, generation: 1, leaseToken: testId("lease"), jobGeneration: 1 });
            for (const x of named) {
              const er = eligible({ ref: { ...x.ref, rev: x.row.rev }, row: x.row as Memory | Evidence }, c, s);
              expect(er.allow, `${x.ref.collection}/${x.ref.id} allowed at ${stage}/${execution}`).toBe(false);
            }
          }
        }
      }),
      { numRuns: 1000 },
    );
  });
});
