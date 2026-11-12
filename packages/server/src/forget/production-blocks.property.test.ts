/**
 * A blocked root denies its siblings in production (review 028, finding 3; contracts §4 clause 10b; brief 021).
 * 100 runs.
 *   FOR ALL stores of Memories over a few shared root keys, and any one of them named as the forget target with a
 *   root block on each of its root keys (as install writes them), the Snapshot that production code builds
 *   (`snapshotFor` over the store) makes `eligible` deny every Memory that was NOT the target but shares a blocked
 *   root, and still allow every Memory that shares none.
 * This is about blocks on the row's own roots through the one `eligible` function, not about closure.
 */
import { type Block, type Memory, docRef, eligible } from "@franki/core";
import { sampleBlock, sampleCoreDocs, sampleEC, sampleMemory, testId } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { snapshotFor, storeReader } from "../head-build";
import { paths } from "../store/paths";
import { testRig } from "../testing/fakes";

const UID = sampleCoreDocs().epoch.uid;
const ROOTS = [testId("rootA"), testId("rootB"), testId("rootC"), testId("rootD")];

const caseArb = fc
  .array(fc.subarray(ROOTS, { minLength: 1 }), { minLength: 2, maxLength: 6 })
  .chain((roots) => fc.tuple(fc.constant(roots), fc.integer({ min: 0, max: roots.length - 1 })));

describe("a blocked root denies its siblings through a production-built Snapshot", () => {
  it("denies every non-target Memory sharing a blocked root, and allows the rest", async () => {
    await fc.assert(
      fc.asyncProperty(caseArb, async ([roots, target]) => {
        const { store } = testRig();
        const rows = roots.map((keys, i) => {
          const memory: Memory = sampleMemory({ rootKeys: keys, dependsOn: [], packetEids: [], key: testId(`key${i}`), logicalId: testId(`log${i}`) });
          return { id: testId(`m${i}`), memory };
        });
        const blocked = new Set(roots[target]!);
        const blocks: Block[] = [...blocked].map((k) => sampleBlock({ uid: UID, kind: "root", rootKey: k, key: k, createdFrom: { type: "memory", id: rows[target]!.id, rev: 1 } }));
        // The Memories are handed to `snapshotFor` as read; the blocks are only in the store.
        await store.transaction(UID, async (tx) => {
          blocks.forEach((b, i) => tx.create(paths.block(UID, testId(`block${i}`)), b));
        });
        const snapshot = await snapshotFor(storeReader(store, UID), UID, rows, sampleCoreDocs().epoch, 1);
        const ec = sampleEC();
        rows.forEach((r, i) => {
          if (i === target) return;
          const verdict = eligible({ ref: docRef("memories", r.id, r.memory.rev), row: r.memory }, ec, snapshot);
          const shares = r.memory.rootKeys.some((k) => blocked.has(k));
          expect(verdict.allow, `m${i} ${shares ? "shares a blocked root and was allowed" : "shares none and was denied"}`).toBe(!shares);
        });
      }),
      { numRuns: 100 },
    );
  });
});
