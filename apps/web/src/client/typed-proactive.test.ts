/**
 * Brief 030 part A: a Proactive an open returns on the typed path is shown on the screen, and the browser's two
 * receipts record it as shown. Against the real server routes on a seeded clone, as in typed-to-server.test.ts.
 */
import type { Moment, Proactive } from "@franki/core";
import { testId } from "@franki/core/testing";
import { type RouteSpec, openRoute, receiptRoute, runRoute, turnRoute } from "@franki/server";
import { describe, expect, it } from "vitest";
import { ok } from "../../../../packages/server/src/openai/fake";
import { completed } from "../../../../packages/server/src/openai/responses";
import { T0_MS, type TestRig, settle, testRig } from "../../../../packages/server/src/testing/fakes";
import { resetAs } from "../../../../packages/server/src/testing/seed";
import { momentsOf, ofKind } from "../../../../packages/server/src/time/testing";
import { type FetchLike, createApiClient } from "./api";
import { createBrowserClock } from "./clock";
import { ProactiveShelf } from "./proactive-shelf";
import { confirmShown, shownResponseId } from "./proactive-shown";
import { TypedTurns } from "./typed-turns";

const ROUTES: Record<string, RouteSpec<unknown>> = {
  "/api/session/open": openRoute as RouteSpec<unknown>,
  "/api/turn": turnRoute as RouteSpec<unknown>,
  "/api/receipt": receiptRoute as RouteSpec<unknown>,
};

function serverFetch(rig: TestRig): FetchLike & { paths: string[] } {
  const paths: string[] = [];
  const f = async (input: string, init: RequestInit): Promise<Response> => {
    const url = new URL(input, "http://localhost:3000");
    paths.push(url.pathname);
    const spec = ROUTES[url.pathname];
    if (spec === undefined) return Response.json({ error: "PARSE", retryAfterMs: 0 }, { status: 404 });
    const headers = new Map(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    if ((init.method ?? "GET") !== "GET") headers.set("origin", "http://localhost:3000");
    const body = typeof init.body === "string" ? init.body : "";
    const work = runRoute(spec, { method: init.method ?? "GET", url: url.href, header: (n) => headers.get(n.toLowerCase()) ?? null, text: async () => body }, rig.deps, rig.sched.schedule);
    const { value } = await settle(work, rig.clock, rig.timers);
    return Response.json(value.body, { status: value.status });
  };
  return Object.assign(f, { paths });
}

describe("a typed open's Proactive (brief 030 part A)", () => {
  it("is shown on the screen, and its admitted and pendingRendered receipts are accepted", async () => {
    const rig = testRig();
    await resetAs(rig, "owner-1", "v1", "r1", "America/Chicago");
    const fetch = serverFetch(rig);
    const api = createApiClient({ getToken: async () => "token:owner-1", fetch });
    const clock = createBrowserClock({ zone: "America/Chicago", monotonic: { timeOrigin: T0_MS, now: () => 0 } });
    let n = 0;
    const newId = () => testId(`browser-${++n}`);
    const shelf = new ProactiveShelf();
    let confirmed: Promise<boolean> | null = null;
    let seen: Proactive | null = null;
    const typed = new TypedTurns({
      api,
      clock,
      newId,
      visitId: () => testId("visit-v1"),
      onProactive: (p) => {
        seen = p;
        shelf.show(p, typed.getSnapshot().entries.length);
        confirmed = confirmShown(api, p, newId);
      },
    });
    rig.openai.script("responses.create", ok(completed("Thanks.")));
    typed.setText("Morning");
    await typed.submit();
    expect(shelf.getSnapshot()?.text).toBe("Good luck at 2 PM: Tessellate Labs final interview.");
    expect(await confirmed).toBe(true);
    const [[wishId, wish]] = ofKind(await momentsOf(rig, "owner-1"), "wish") as [[string, Moment]];
    expect(seen!.permit.momentIds).toEqual([wishId]);
    expect(wish).toMatchObject({ status: "admitted", responseId: shownResponseId(seen!) });
  });
});
