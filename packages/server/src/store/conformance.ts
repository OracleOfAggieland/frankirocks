/**
 * Store_Port conformance suite (R7.2–R7.5, R7.9, R7.10, R4.6, R4.7, R4.9, R4.12, R4.13, R24.3).
 * One suite, run against the Memory_Store by `npm test` and against the Firestore_Store on the emulator in CI.
 * It uses only the StorePort interface, so it compiles against either store unchanged.
 */
import type { Evidence, Hasher, Memory, Session, Turn } from "@franki/core";
import { rootKey, turnTextSlice } from "@franki/core";
import { UID, sampleEvidence, sampleJob, sampleMemory, sampleSession, sampleTurn, testId } from "@franki/core/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { serializedBytes } from "./checks";
import { StoreError } from "./errors";
import { appendEvidenceRevision, evidenceId } from "./evidence";
import { paths } from "./paths";
import { MAX_RECORD_BYTES, type StoredDoc, type StorePort } from "./port";

export interface ConformanceContext {
  store: StorePort;
  hasher: Hasher;
}

const OTHER = "owner-2";

async function expectStoreError(promise: Promise<unknown>, code: StoreError["code"]): Promise<StoreError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, `expected StoreError ${code}`).toBeInstanceOf(StoreError);
  expect((error as StoreError).code).toBe(code);
  return error as StoreError;
}

/** Evidence whose one Slice really hashes its text, with its eid. */
export function linkedEvidence(hasher: Hasher, label: string, text: string): { eid: string; record: Evidence } {
  const logicalId = hasher.id(["ev", testId(label)]);
  const eid = evidenceId(logicalId, 1, hasher);
  const record = sampleEvidence({
    logicalId,
    text: { kind: "inline", text },
    fieldSlices: [turnTextSlice(eid, text, "U", hasher)],
  });
  return { eid, record };
}

/** A Memory whose lineage passes W-LINEAGE against `ev`. */
export function linkedMemory(hasher: Hasher, ev: { eid: string; record: Evidence }, overrides: Partial<Memory> = {}): Memory {
  const slice = ev.record.fieldSlices[0]!;
  return sampleMemory({
    rootSlices: [slice],
    rootKeys: [rootKey(slice, hasher)],
    packetEids: [ev.eid],
    dependsOn: [`e:${ev.eid}`],
    supportingIds: [{ type: "evidence", id: ev.eid, rev: 1 }],
    ...overrides,
  });
}

export function storeConformance(name: string, setup: () => Promise<ConformanceContext>): void {
  describe(`Store_Port conformance: ${name}`, () => {
    let store: StorePort;
    let hasher: Hasher;

    beforeEach(async () => {
      ({ store, hasher } = await setup());
    });

    const sessionPath = (label: string) => paths.session(UID, testId(label));

    describe("writes and rev", () => {
      it("create sets rev 1 and reads back the same record", async () => {
        const record = sampleSession({ rev: 99 });
        await store.transaction(UID, async (tx) => tx.create(sessionPath("a"), record));
        const doc = await store.get<Session>(UID, sessionPath("a"));
        expect(doc?.data).toEqual({ ...record, rev: 1 });
        expect(doc?.id).toBe(testId("a"));
      });

      it("rev+1 on each committed update", async () => {
        await store.transaction(UID, async (tx) => tx.create(sessionPath("a"), sampleSession()));
        for (const expected of [2, 3]) {
          await store.transaction(UID, async (tx) => {
            const doc = await tx.get<Session>(sessionPath("a"));
            tx.update(sessionPath("a"), { ...doc!.data, referenceCount: doc!.data.referenceCount + 1 });
          });
          expect((await store.get<Session>(UID, sessionPath("a")))?.data.rev).toBe(expected);
        }
        expect((await store.get<Session>(UID, sessionPath("a")))?.data.referenceCount).toBe(2);
      });

      it("applies all writes of a transaction together", async () => {
        await store.transaction(UID, async (tx) => {
          tx.create(sessionPath("a"), sampleSession());
          tx.create(sessionPath("b"), sampleSession());
        });
        expect(await store.get(UID, sessionPath("a"))).not.toBeNull();
        expect(await store.get(UID, sessionPath("b"))).not.toBeNull();
      });

      it("an update needs a read in the transaction or an expected rev", async () => {
        await store.transaction(UID, async (tx) => tx.create(sessionPath("a"), sampleSession()));
        await expectStoreError(store.transaction(UID, async (tx) => tx.update(sessionPath("a"), sampleSession())), "invalidInput");
        await store.transaction(UID, async (tx) => tx.update(sessionPath("a"), sampleSession(), 1));
        expect((await store.get<Session>(UID, sessionPath("a")))?.data.rev).toBe(2);
      });
    });

    describe("CAS", () => {
      it("CAS abort writes nothing", async () => {
        await store.transaction(UID, async (tx) => tx.create(sessionPath("a"), sampleSession()));
        await store.transaction(UID, async (tx) => tx.update(sessionPath("a"), sampleSession({ referenceCount: 5 }), 1));
        await expectStoreError(
          store.transaction(UID, async (tx) => {
            tx.create(sessionPath("b"), sampleSession());
            tx.update(sessionPath("a"), sampleSession({ referenceCount: 9 }), 1);
          }),
          "staleRevision",
        );
        expect(await store.get(UID, sessionPath("b"))).toBeNull();
        const a = await store.get<Session>(UID, sessionPath("a"));
        expect(a?.data.rev).toBe(2);
        expect(a?.data.referenceCount).toBe(5);
      });

      it("create on an existing path is stale and writes nothing", async () => {
        await store.transaction(UID, async (tx) => tx.create(sessionPath("a"), sampleSession()));
        await expectStoreError(
          store.transaction(UID, async (tx) => {
            tx.create(sessionPath("b"), sampleSession());
            tx.create(sessionPath("a"), sampleSession({ referenceCount: 3 }));
          }),
          "staleRevision",
        );
        expect(await store.get(UID, sessionPath("b"))).toBeNull();
        expect((await store.get<Session>(UID, sessionPath("a")))?.data.referenceCount).toBe(0);
      });

      it("update of a missing record is stale", async () => {
        await expectStoreError(store.transaction(UID, async (tx) => tx.update(sessionPath("zz"), sampleSession(), 1)), "staleRevision");
      });
    });

    describe("validation", () => {
      it("an invalid record aborts the whole transaction with invalidInput", async () => {
        const error = await expectStoreError(
          store.transaction(UID, async (tx) => {
            tx.create(sessionPath("a"), sampleSession());
            tx.create(sessionPath("b"), { ...sampleSession(), extra: true });
          }),
          "invalidInput",
        );
        expect(error.message).toContain("$.extra");
        expect(await store.get(UID, sessionPath("a"))).toBeNull();
      });

      it("oversize: over 524,288 bytes is rejected, exactly 524,288 is accepted", async () => {
        const sized = (bytes: number): Evidence => {
          const base = sampleEvidence({
            body: { kind: "inline", text: "" },
            bodyOwn: { kind: "inline", text: "" },
            bodyQuoted: { kind: "inline", text: "" },
            description: { kind: "inline", text: "" },
          });
          let remaining = bytes - serializedBytes(base);
          const fill = (): string => {
            const n = Math.min(remaining, 131072);
            remaining -= n;
            return "a".repeat(n);
          };
          const record: Evidence = {
            ...base,
            body: { kind: "inline", text: fill() },
            bodyOwn: { kind: "inline", text: fill() },
            bodyQuoted: { kind: "inline", text: fill() },
            description: { kind: "inline", text: fill() },
          };
          expect(remaining).toBe(0);
          return record;
        };
        const exact = sized(MAX_RECORD_BYTES);
        const over = sized(MAX_RECORD_BYTES + 1);
        expect(serializedBytes(exact)).toBe(MAX_RECORD_BYTES);
        await expectStoreError(store.transaction(UID, async (tx) => tx.create(paths.evidence(UID, testId("big")), over)), "oversize");
        expect(await store.get(UID, paths.evidence(UID, testId("big")))).toBeNull();
        await store.transaction(UID, async (tx) => tx.create(paths.evidence(UID, testId("big")), exact));
        expect(await store.get(UID, paths.evidence(UID, testId("big")))).not.toBeNull();
      });

      it("a turn's sessionId must match its path", async () => {
        const turn = sampleTurn({ sessionId: testId("other") });
        await expectStoreError(
          store.transaction(UID, async (tx) => tx.create(paths.turn(UID, testId("ses"), testId("t1")), turn)),
          "invalidInput",
        );
      });
    });

    describe("tenant mismatch", () => {
      it("rejects reads, queries and transactions outside the caller's Tenant_Root", async () => {
        await store.transaction(OTHER, async (tx) => tx.create(paths.session(OTHER, testId("a")), sampleSession({ uid: OTHER })));
        await expectStoreError(store.get(UID, paths.session(OTHER, testId("a"))), "tenantMismatch");
        await expectStoreError(
          store.query(UID, { collection: paths.collection(OTHER, "sessions"), where: [], orderBy: { field: "__name__", dir: "asc" }, limit: 10 }),
          "tenantMismatch",
        );
        await expectStoreError(
          store.transaction(UID, async (tx) => {
            await tx.get(paths.session(OTHER, testId("a")));
          }),
          "tenantMismatch",
        );
      });

      it("rejects a record whose uid is another Owner and writes nothing", async () => {
        await expectStoreError(
          store.transaction(UID, async (tx) => {
            tx.create(sessionPath("a"), sampleSession());
            tx.create(sessionPath("b"), sampleSession({ uid: OTHER }));
          }),
          "tenantMismatch",
        );
        expect(await store.get(UID, sessionPath("a"))).toBeNull();
      });
    });

    describe("Evidence immutable (KC02)", () => {
      it("rejects an in-place content change and keeps the stored record", async () => {
        const ev = linkedEvidence(hasher, "e1", "My dog is called Pip");
        const path = paths.evidence(UID, ev.eid);
        await store.transaction(UID, async (tx) => tx.create(path, ev.record));
        await expectStoreError(
          store.transaction(UID, async (tx) => {
            const doc = await tx.get<Evidence>(path);
            tx.update(path, { ...doc!.data, text: { kind: "inline", text: "My dog is called Rex" } });
          }),
          "invalidInput",
        );
        expect((await store.get<Evidence>(UID, path))?.data).toEqual({ ...ev.record, rev: 1 });
      });

      it("rejects an in-place fieldSlices change", async () => {
        const ev = linkedEvidence(hasher, "e1", "My dog is called Pip");
        const path = paths.evidence(UID, ev.eid);
        await store.transaction(UID, async (tx) => tx.create(path, ev.record));
        const slices = [{ ...ev.record.fieldSlices[0]!, sens: "S2" as const }];
        await expectStoreError(
          store.transaction(UID, async (tx) => tx.update(path, { ...ev.record, fieldSlices: slices }, 1)),
          "invalidInput",
        );
      });

      it("allows a status change in place", async () => {
        const ev = linkedEvidence(hasher, "e1", "My dog is called Pip");
        const path = paths.evidence(UID, ev.eid);
        await store.transaction(UID, async (tx) => tx.create(path, ev.record));
        await store.transaction(UID, async (tx) => tx.update(path, { ...ev.record, status: "blocked" }, 1));
        expect((await store.get<Evidence>(UID, path))?.data.status).toBe("blocked");
      });

      it("a content change appends a revision with the same logicalId", async () => {
        const ev = linkedEvidence(hasher, "e1", "My dog is called Pip");
        await store.transaction(UID, async (tx) => tx.create(paths.evidence(UID, ev.eid), ev.record));
        const nextText = "My dog is called Pip Junior";
        const newEid = await store.transaction(UID, async (tx) =>
          appendEvidenceRevision(
            tx,
            UID,
            ev.eid,
            { ...ev.record, text: { kind: "inline", text: nextText }, fieldSlices: [turnTextSlice(evidenceId(ev.record.logicalId, 2, hasher), nextText, "U", hasher)] },
            hasher,
          ),
        );
        expect(newEid).toBe(evidenceId(ev.record.logicalId, 2, hasher));
        const next = await store.get<Evidence>(UID, paths.evidence(UID, newEid));
        expect(next?.data.logicalId).toBe(ev.record.logicalId);
        expect(next?.data.revisionOf).toBe(ev.eid);
        expect((await store.get<Evidence>(UID, paths.evidence(UID, ev.eid)))?.data).toEqual({ ...ev.record, rev: 1 });
      });
    });

    describe("Memory value immutable", () => {
      const setupMemory = async () => {
        const ev = linkedEvidence(hasher, "e1", "My dog is called Pip");
        const memory = linkedMemory(hasher, ev);
        const path = paths.memory(UID, testId("m1"));
        await store.transaction(UID, async (tx) => {
          tx.create(paths.evidence(UID, ev.eid), ev.record);
          tx.create(path, memory);
        });
        return { path, memory };
      };

      it("rejects an in-place value or args change", async () => {
        const { path, memory } = await setupMemory();
        await expectStoreError(
          store.transaction(UID, async (tx) => tx.update(path, { ...memory, value: { kind: "text", text: "Rex" } }, 1)),
          "invalidInput",
        );
        await expectStoreError(
          store.transaction(UID, async (tx) => tx.update(path, { ...memory, args: { topic: "other", label: null } }, 1)),
          "invalidInput",
        );
        expect((await store.get<Memory>(UID, path))?.data).toEqual({ ...memory, rev: 1 });
      });

      it("allows status and validTo to change, with rev+1", async () => {
        const { path, memory } = await setupMemory();
        await store.transaction(UID, async (tx) => tx.update(path, { ...memory, status: "history", validTo: memory.assertedAt }, 1));
        const doc = await store.get<Memory>(UID, path);
        expect(doc?.data.status).toBe("history");
        expect(doc?.data.rev).toBe(2);
      });
    });

    describe("lineage write rejections (W-LINEAGE)", () => {
      const reject = async (build: (ev: { eid: string; record: Evidence }) => Memory, check: string, createEvidence = true) => {
        const ev = linkedEvidence(hasher, "e1", "My dog is called Pip");
        if (createEvidence) await store.transaction(UID, async (tx) => tx.create(paths.evidence(UID, ev.eid), ev.record));
        const path = paths.memory(UID, testId("m1"));
        const error = await expectStoreError(
          store.transaction(UID, async (tx) => {
            tx.create(paths.session(UID, testId("side")), sampleSession());
            tx.create(path, build(ev));
          }),
          "invalidInput",
        );
        expect(error.lineage.some((f) => f.startsWith(check))).toBe(true);
        expect(await store.get(UID, path)).toBeNull();
        expect(await store.get(UID, paths.session(UID, testId("side")))).toBeNull();
      };

      it("empty rootSlices", () => reject((ev) => linkedMemory(hasher, ev, { rootSlices: [], rootKeys: [] }), "emptyRootSlices"));
      it("empty dependsOn", () => reject((ev) => linkedMemory(hasher, ev, { dependsOn: [] }), "emptyDependsOn"));
      it("root Slice Evidence missing", () => reject((ev) => linkedMemory(hasher, ev), "missingEvidence", false));
      it("Slice hash mismatch", () =>
        reject((ev) => {
          const slice = { ...ev.record.fieldSlices[0]!, end: 6 };
          return linkedMemory(hasher, ev, { rootSlices: [slice], rootKeys: [rootKey(slice, hasher)] });
        }, "sliceHashMismatch"));
      it("root key mismatch", () => reject((ev) => linkedMemory(hasher, ev, { rootKeys: [testId("wrong")] }), "rootKeyMismatch"));
      it("missing e:<eid> in dependsOn", () => reject((ev) => linkedMemory(hasher, ev, { dependsOn: ["m:other@1"] }), "missingDependsOn"));
      it("lineage array over its bound is a schema rejection", async () => {
        const ev = linkedEvidence(hasher, "e1", "My dog is called Pip");
        await store.transaction(UID, async (tx) => tx.create(paths.evidence(UID, ev.eid), ev.record));
        const deps = Array.from({ length: 1025 }, (_, i) => `e:${i}`);
        await expectStoreError(
          store.transaction(UID, async (tx) => tx.create(paths.memory(UID, testId("m1")), linkedMemory(hasher, ev, { dependsOn: deps }))),
          "invalidInput",
        );
      });
      it("accepts a Memory whose Evidence is created in the same transaction", async () => {
        const ev = linkedEvidence(hasher, "e1", "My dog is called Pip");
        await store.transaction(UID, async (tx) => {
          tx.create(paths.evidence(UID, ev.eid), ev.record);
          tx.create(paths.memory(UID, testId("m1")), linkedMemory(hasher, ev));
        });
        expect(await store.get(UID, paths.memory(UID, testId("m1")))).not.toBeNull();
      });
    });

    describe("queries", () => {
      it("Q14 cursor order: turns by seq > cursor, ascending, limited", async () => {
        const ses = testId("ses");
        await store.transaction(UID, async (tx) => {
          for (const seq of [3, 1, 5, 2, 4]) tx.create(paths.turn(UID, ses, testId(`turn${seq}`)), sampleTurn({ seq }));
        });
        const page = await store.query<Turn>(UID, {
          collection: paths.turns(UID, ses),
          where: [{ field: "seq", op: ">", value: 1 }],
          orderBy: { field: "seq", dir: "asc" },
          limit: 3,
        });
        expect(page.map((d) => d.data.seq)).toEqual([2, 3, 4]);
      });

      it("Q28 cursor order: pages by document ID with no repeats", async () => {
        const ids = Array.from({ length: 7 }, (_, i) => testId(`s${i}`));
        await store.transaction(UID, async (tx) => {
          for (const id of [...ids].reverse()) tx.create(paths.session(UID, id), sampleSession());
        });
        const seen: string[] = [];
        let cursor: string | null = null;
        for (;;) {
          const page: StoredDoc[] = await store.query(UID, {
            collection: paths.collection(UID, "sessions"),
            where: cursor === null ? [] : [{ field: "__name__", op: ">", value: cursor }],
            orderBy: { field: "__name__", dir: "asc" },
            limit: 3,
          });
          if (page.length === 0) break;
          seen.push(...page.map((d) => d.id));
          cursor = page[page.length - 1]!.id;
        }
        expect(seen).toEqual([...ids].sort());
      });

      it("Q17 jobs due: status equality, nextAttemptAt range, ascending", async () => {
        await store.transaction(UID, async (tx) => {
          tx.create(paths.job(UID, testId("j1")), sampleJob({ status: "queued", nextAttemptAt: "2026-11-03T12:00:02.000Z" }));
          tx.create(paths.job(UID, testId("j2")), sampleJob({ status: "queued", nextAttemptAt: "2026-11-03T12:00:01.000Z" }));
          tx.create(paths.job(UID, testId("j3")), sampleJob({ status: "queued", nextAttemptAt: "2026-11-03T12:09:00.000Z" }));
          tx.create(paths.job(UID, testId("j4")), sampleJob({ status: "complete", nextAttemptAt: "2026-11-03T12:00:00.000Z" }));
        });
        const due = await store.query(UID, {
          collection: paths.collection(UID, "jobs"),
          where: [
            { field: "status", op: "==", value: "queued" },
            { field: "nextAttemptAt", op: "<=", value: "2026-11-03T12:05:00.000Z" },
          ],
          orderBy: { field: "nextAttemptAt", dir: "asc" },
          limit: 100,
        });
        expect(due.map((d) => d.id)).toEqual([testId("j2"), testId("j1")]);
      });

      it("Q03 supersede lookup: key and status equality, validFromKey descending", async () => {
        const ev = linkedEvidence(hasher, "e1", "My dog is called Pip");
        const key = testId("k");
        await store.transaction(UID, async (tx) => {
          tx.create(paths.evidence(UID, ev.eid), ev.record);
          tx.create(paths.memory(UID, testId("m1")), linkedMemory(hasher, ev, { key, validFromKey: "2026-01-01T00:00:00.000Z" }));
          tx.create(paths.memory(UID, testId("m2")), linkedMemory(hasher, ev, { key, validFromKey: "2026-06-01T00:00:00.000Z" }));
          tx.create(paths.memory(UID, testId("m3")), linkedMemory(hasher, ev, { key, status: "history" }));
          tx.create(paths.memory(UID, testId("m4")), linkedMemory(hasher, ev, { key: testId("k2") }));
        });
        const rows = await store.query(UID, {
          collection: paths.collection(UID, "memories"),
          where: [
            { field: "key", op: "==", value: key },
            { field: "status", op: "==", value: "active" },
            { field: "validFromKey", op: "<=", value: "2026-11-03T12:00:00.000Z" },
          ],
          orderBy: { field: "validFromKey", dir: "desc" },
          limit: 32,
        });
        expect(rows.map((d) => d.id)).toEqual([testId("m2"), testId("m1")]);
      });

      it("rejects a query shape with no declared index, and limits over 100", async () => {
        const jobs = paths.collection(UID, "jobs");
        await expectStoreError(
          store.query(UID, { collection: jobs, where: [{ field: "kind", op: "==", value: "extract" }], orderBy: { field: "nextAttemptAt", dir: "asc" }, limit: 10 }),
          "invalidInput",
        );
        await expectStoreError(store.query(UID, { collection: jobs, where: [], orderBy: { field: "__name__", dir: "asc" }, limit: 101 }), "invalidInput");
      });
    });
  });
}
