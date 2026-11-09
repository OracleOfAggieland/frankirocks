/**
 * Turn serialization property (R19.7; KV12). FOR ALL N in 1..50 and every permutation of clientSeq 1..N sent as
 * concurrent TurnRequests (each re-sent with the same body after `hold`, STALE or in-flight LIMIT, with random
 * yields so transactions interleave differently), the committed user Turns have gap-free seq 1..N, each equal to
 * its clientSeq, exactly one per clientSeq, and `nextClientSeq` ends at N + 1. Memory_Store; 100 runs.
 * The Firestore_Store is covered by the shared conformance case "turn serialization" on the emulator.
 */
import type { Session, Turn } from "@franki/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { paths } from "../store/paths";
import { fakeRequest, testRig } from "../testing/fakes";
import { openTestSession, typedTurn } from "../testing/session-fixtures";
import { runRoute } from "./runtime";
import { turnRoute } from "./turn";

const UID = "owner-1";
const yieldN = async (n: number) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};

describe("turn serialization property", () => {
  it(
    "1–50 concurrent requests commit gap-free seq",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 50 }).chain((n) =>
            fc.tuple(
              fc.shuffledSubarray(
                Array.from({ length: n }, (_, i) => i + 1),
                { minLength: n, maxLength: n },
              ),
              fc.array(fc.integer({ min: 0, max: 3 }), { minLength: n, maxLength: n }),
            ),
          ),
          async ([order, delays]) => {
            const rig = testRig();
            const s = await openTestSession(rig);
            const statuses = new Map<number, string>();
            const send = async (seq: number, delay: number) => {
              await yieldN(delay);
              const body = typedTurn(s.stamp, seq, `turn number ${seq}`);
              for (let attempt = 0; attempt < 2_000; attempt++) {
                const res = await runRoute(turnRoute, fakeRequest({ body }), rig.deps, rig.sched.schedule);
                const b = res.body as { status?: string; error?: string };
                if (res.status === 200 && b.status === "ordinary") {
                  statuses.set(seq, "ordinary");
                  return;
                }
                const retryable = (res.status === 200 && b.status === "hold") || b.error === "STALE" || b.error === "LIMIT";
                if (!retryable) throw new Error(`seq ${seq}: unexpected ${res.status} ${JSON.stringify(b)}`);
                await yieldN(1 + ((seq + attempt) % 3));
              }
              throw new Error(`seq ${seq} never committed`);
            };
            await Promise.all(order.map((seq, i) => send(seq, delays[i]!)));

            const turns = await rig.store.query<Turn>(UID, {
              collection: paths.turns(UID, s.sessionId),
              where: [{ field: "seq", op: ">", value: 0 }],
              orderBy: { field: "seq", dir: "asc" },
              limit: 100,
            });
            const n = order.length;
            expect(turns.map((t) => t.data.seq)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
            for (const t of turns) expect(t.data.text).toBe(`turn number ${t.data.seq}`);
            expect((await rig.store.get<Session>(UID, paths.session(UID, s.sessionId)))?.data.nextClientSeq).toBe(n + 1);
            expect(rig.store.countUnder(paths.collection(UID, "evidence"))).toBe(n);
          },
        ),
        { numRuns: 100 },
      );
    },
    120_000,
  );
});
