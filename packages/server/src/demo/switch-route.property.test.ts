/**
 * The switch fails closed (brief 054 design, correctness property 11, the `runRoute` half; R15.3, R15.4, R15.5).
 * 1,000 runs. The `demoEnabled` half is `switch.property.test.ts`.
 *   FOR ALL values of FRANKI_DEMO (any string or absent) and ALL requests:
 *   - with an anonymous token while the value is not "on", `runRoute` answers 401 AUTH, the route's logic never runs,
 *     and the store records no read and no write;
 *   - with an anonymous token while the value is "on", the route runs with `ctx.anonymous` true;
 *   - with a non-anonymous token, the answer and the context are the same whatever the value is.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { obj, str } from "@franki/core";
import { type RouteSpec, parseWith, runRoute } from "../routes/runtime";
import { paths } from "../store/paths";
import type { StorePort } from "../store/port";
import { TEST_ENV, fakeRequest, testRig } from "../testing/fakes";
import { DEMO_ENV_VAR } from "./switch";

const RUNS = { numRuns: 1000 };

const value = fc.oneof(
  fc.constantFrom("on", "On", "ON", " on", "on ", "1", "true", "", "off"),
  fc.string({ maxLength: 8 }),
  fc.constant(undefined),
);

/** Counts every store call the route makes. */
function counting(inner: StorePort): { store: StorePort; calls: () => number } {
  let n = 0;
  return {
    store: {
      get: (uid, path) => (n++, inner.get(uid, path)),
      query: (uid, spec) => (n++, inner.query(uid, spec)),
      transaction: (uid, fn) => (n++, inner.transaction(uid, fn)),
    },
    calls: () => n,
  };
}

/** A route that reads the store and opens a transaction, so a refusal that let it run would show up in the count. */
function probe() {
  const seen: { uid: string; anonymous: boolean | undefined }[] = [];
  const spec: RouteSpec<{ note: string }> = {
    name: "probe",
    parse: ({ body }) => parseWith(obj({ note: str(200) }), body ?? { note: "" }),
    run: async (ctx, req) => {
      seen.push({ uid: ctx.uid, anonymous: ctx.anonymous });
      await ctx.deps.store.get(ctx.uid, paths.core(ctx.uid, "state"));
      await ctx.deps.store.transaction(ctx.uid, async (tx) => tx.get(paths.core(ctx.uid, req.note === "" ? "epoch" : "counters")));
      return { ok: true };
    },
  };
  return { spec, seen };
}

describe("the demo switch at the route runtime", () => {
  it("refuses an anonymous token unless the switch is on, and leaves every other token alone", async () => {
    await fc.assert(
      fc.asyncProperty(value, fc.boolean(), fc.constantFrom("GET", "POST"), fc.string({ maxLength: 20 }), async (v, anonymous, method, note) => {
        const env: Record<string, string> = { ...TEST_ENV };
        delete env[DEMO_ENV_VAR];
        if (v !== undefined) env[DEMO_ENV_VAR] = v;
        const rig = testRig(env);
        const c = counting(rig.deps.store);
        const deps = { ...rig.deps, store: c.store };
        const { spec, seen } = probe();
        const token = anonymous ? "anon:visitor-1" : "token:owner-1";
        const http = fakeRequest({ method, token, ...(method === "GET" ? {} : { body: { note } }) });
        const res = await runRoute(spec, http, deps, rig.sched.schedule);

        if (anonymous && v !== "on") {
          expect(res.status).toBe(401);
          expect(res.body).toStrictEqual({ error: "AUTH", retryAfterMs: 0 });
          expect(seen).toEqual([]);
          expect(c.calls()).toBe(0);
          return;
        }
        expect(res.status).toBe(200);
        expect(seen).toEqual([{ uid: anonymous ? "visitor-1" : "owner-1", anonymous }]);
        expect(c.calls()).toBe(2);
      }),
      RUNS,
    );
  });
});
