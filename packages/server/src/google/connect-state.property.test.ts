// Brief 049 property "State": a connect whose state was issued to another owner, was already used, was superseded
// by a later start, has expired, or was never issued reaches Google zero times, and its answer carries no state.
// A fresh state of the owner's own reaches Google exactly once. Seed recorded in docs/briefs/049-report.md.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { testId } from "@franki/core/testing";
import { callRoute } from "../testing/fakes";
import { OWNER, OTHER, googleRig, stateOf } from "../testing/google-rig";
import { PENDING_TTL_MS } from "./oauth";
import { googleConnectRoute, googleStartRoute } from "./routes";

const KINDS = ["valid", "other", "reused", "expired", "superseded", "forged"] as const;

describe("property: a state that is not the owner's fresh one never reaches Google (brief 049)", () => {
  it("1,000 runs", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...KINDS),
        fc.integer({ min: 0, max: 2 }),
        fc.integer({ min: 0, max: 5 * 60_000 }),
        fc.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        async (kind, extraStarts, lateBy, forged) => {
          const { rig, google } = googleRig();
          const start = async (uid: string) => {
            const res = await callRoute(rig, googleStartRoute, {}, { token: `token:${uid}` });
            expect(res.status).toBe(200);
            return stateOf(res.body.url);
          };
          let mine = await start(OWNER);
          for (let i = 0; i < extraStarts; i++) mine = await start(OWNER);
          const theirs = await start(OTHER);
          const connect = (state: string, n: number) => callRoute(rig, googleConnectRoute, { requestId: testId(`gc-${n}`), code: "4/0AQSTgQ-test-code", state }, { token: `token:${OWNER}` });

          let expected = 0;
          let last: Awaited<ReturnType<typeof connect>>;
          if (kind === "valid") {
            last = await connect(mine, 1);
            expected = 1;
            expect(last.status).toBe(200);
          } else if (kind === "other") {
            last = await connect(theirs, 1);
          } else if (kind === "reused") {
            await connect(mine, 1);
            expected = 1;
            last = await connect(mine, 2);
          } else if (kind === "expired") {
            rig.clock.advance(PENDING_TTL_MS + lateBy);
            last = await connect(mine, 1);
          } else if (kind === "superseded") {
            const old = mine;
            await start(OWNER);
            last = await connect(old, 1);
          } else {
            last = await connect(forged === mine ? `${forged.slice(0, 42)}${forged.endsWith("A") ? "B" : "A"}` : forged, 1);
          }
          expect(google.calls.filter((c) => c.method === "exchangeCode")).toHaveLength(expected);
          if (kind !== "valid") expect(last.status).toBe(409);
          const answer = JSON.stringify(last.body);
          expect(answer).not.toContain(mine);
          expect(answer).not.toContain(theirs);
        },
      ),
      { numRuns: 1000 },
    );
  });
});
