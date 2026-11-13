// Feature: forget, part two (brief 047, ruling 9): purge only removes. For any forget run to `done`: the purge cursor
// only advances; `cleanupCompleteAt` is set only once the job is done; every document that existed when purge began
// still exists with its ID and state (Evidence may go from blocked to purged); blocks, overlays, effects, `core/rules`
// and the receipt's counts are untouched by purge; and what purge removes is gone: the text of blocked Evidence, the
// text of the dead request turn, and the values and lines of the Memories the forget blocked or withdrew.
import { type Evidence, type Ledger, type Memory, type Turn, canonicalJSON } from "@franki/core";
import { nrWorldArb, testId } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { paths } from "../store/paths";
import { fakeCallClose } from "./close-port";
import { forgetReceiptId } from "./fence";
import { WORLD_UID, allDone, dumpStore, forgetJobsOf, forgetMemory, oracleDerivatives, stepAll, storeWorld } from "./testing/world";

const COLLECTION_ORDER = ["evidence", "memories", "turns", "effects", "moments"];
const cursorKey = (c: { collection: string; lastId: string | null }): [number, string] => [COLLECTION_ORDER.indexOf(c.collection), c.lastId ?? ""];
const notBefore = (a: [number, string], b: [number, string]) => a[0] > b[0] || (a[0] === b[0] && a[1] >= b[1]);
const TEXT_FIELDS = ["body", "bodyOwn", "bodyQuoted", "subject", "title", "description", "text", "sender"] as const;
const state = (r: Record<string, unknown>) => (r.status ?? r.state ?? null) as string | null;

describe("purge only removes (brief 047, ruling 9)", () => {
  it("advances its cursor, keeps every row and every denial, and leaves no purged text behind", async () => {
    await fc.assert(
      fc.asyncProperty(nrWorldArb, async (w) => {
        const s = await storeWorld(w);
        const { store, hasher } = s.rig.deps;
        const closer = fakeCallClose(() => "closed");
        const fenced = await forgetMemory(s, w.target, "purge-1");
        if (fenced.kind === "refused") throw new Error("refused");
        const receiptPath = paths.ledger(WORLD_UID, forgetReceiptId(fenced.opId, hasher));
        let before: Map<string, Record<string, unknown>> | null = null;
        let last: [number, string] | null = null;
        for (let step = 0; step < 200 && !(await allDone(store)); step++) {
          await stepAll(s, closer);
          const job = (await forgetJobsOf(store)).find((j) => j.id === fenced.jobId)!.job;
          const p = job.payload;
          if (p.kind !== "forget") throw new Error("not a forget job");
          const receipt = (await store.get<Ledger>(WORLD_UID, receiptPath))!.data;
          if (p.phase !== "done") expect(receipt.kind === "forgetReceipt" ? receipt.payload.cleanupCompleteAt : "?", `cleanupCompleteAt set at ${p.phase}`).toBeNull();
          if (p.phase === "purge") {
            if (before === null) before = await dumpStore(store);
            const k = cursorKey(p.cursor);
            if (last !== null) expect(notBefore(k, last), `the purge cursor went back from ${last.join("/")} to ${k.join("/")}`).toBe(true);
            last = k;
          }
        }
        expect(await allDone(store), "the forget never finished").toBe(true);
        const end = await dumpStore(store);
        const receipt = (await store.get<Ledger>(WORLD_UID, receiptPath))!.data;
        expect(receipt.kind === "forgetReceipt" ? receipt.payload.cleanupCompleteAt : null, "cleanupCompleteAt is not set at done").not.toBeNull();
        // Rows and denials kept.
        expect(before, "the job never stopped in purge").not.toBeNull();
        for (const [k, v] of before!) {
          const now = end.get(k);
          expect(now, `${k} was deleted`).toBeDefined();
          if (k.startsWith("evidence/") && state(v) === "blocked") expect(["blocked", "purged"]).toContain(state(now!));
          else if (!k.startsWith("jobs/") && !k.startsWith("ledger/")) expect(state(now!), `${k} changed state`).toBe(state(v));
          if (k.startsWith("blocks/") || k.startsWith("overlays/") || k.startsWith("effects/") || k === "core/rules") expect(canonicalJSON(now), `${k} changed`).toBe(canonicalJSON(v));
        }
        const rb = before!.get(`ledger/${forgetReceiptId(fenced.opId, hasher)}`) as Ledger | undefined;
        if (rb !== undefined && rb.kind === "forgetReceipt" && receipt.kind === "forgetReceipt") {
          expect(receipt.payload.touched).toEqual(rb.payload.touched);
          expect(receipt.payload.withdrawnCount).toBe(rb.payload.withdrawnCount);
          expect(receipt.payload.retainedRuleIds).toEqual(rb.payload.retainedRuleIds);
        }
        // What purge removes is gone.
        for (const [k, v] of end) {
          if (!k.startsWith("evidence/") || (v as Evidence).status === "retained") continue;
          for (const f of TEXT_FIELDS) expect((v as Evidence)[f], `${k}.${f} still holds text`).toBeNull();
          expect((v as Evidence).status).toBe("purged");
        }
        const request = end.get(`turns/${testId("nr-request-purge-1")}`) as Turn | undefined;
        expect(request?.text ?? null, "the dead request turn still holds its text").toBeNull();
        for (const i of oracleDerivatives(w, w.target)) {
          const m = end.get(`memories/${s.memoryIds[i]!}`) as Memory;
          expect(m.value.kind === "text" ? m.value.text : m.value.kind === "none" ? "" : "kept", `memory ${i} still holds its value`).toBe("");
          expect(m.texture, `memory ${i} still holds texture`).toEqual([]);
          expect(m.sayAs, `memory ${i} still holds a line`).toBeNull();
        }
      }),
      { numRuns: 150 },
    );
  }, 600_000);
});
