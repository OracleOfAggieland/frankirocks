/**
 * Retrying a typed line the server already saved (`TypedTurns`), against the real routes. The first `/api/turn`
 * is committed by the server but the browser sees a network failure, as when a response is lost after the
 * commit; then the clock moves on and the owner presses send again with the same text.
 *
 * Unlike typed-to-server.test.ts, the browser clock here reads the rig's moving opsClock, so `utteredWorldAt` in
 * the rebuilt body differs between the two presses. Pinned as it behaves today, and red first (`it.fails`) for
 * the behaviour wanted later: the retry is byte-identical and replays the saved answer (R19.3).
 * Test-only imports of server test helpers; no browser module imports the Server_Library.
 */
import type { Turn } from "@franki/core";
import { testId } from "@franki/core/testing";
import { type RouteSpec, closeRoute, openRoute, runRoute, turnRoute } from "@franki/server";
import { describe, expect, it } from "vitest";
import { ok } from "../../../../packages/server/src/openai/fake";
import { completed } from "../../../../packages/server/src/openai/responses";
import { paths } from "../../../../packages/server/src/store/paths";
import { T0_MS, type TestRig, settle, testRig } from "../../../../packages/server/src/testing/fakes";
import { type FetchLike, createApiClient } from "./api";
import { createBrowserClock } from "./clock";
import { TypedTurns } from "./typed-turns";

const UID = "owner-1";
const ROUTES: Record<string, RouteSpec<unknown>> = {
  "/api/session/open": openRoute as RouteSpec<unknown>,
  "/api/session/close": closeRoute as RouteSpec<unknown>,
  "/api/turn": turnRoute as RouteSpec<unknown>,
};

/** Serves the routes from the rig. The first `/api/turn` runs on the server, then its response is lost. */
function serverFetchLosingFirstTurn(rig: TestRig): FetchLike & { turnBodies: string[] } {
  const turnBodies: string[] = [];
  const f = async (input: string, init: RequestInit): Promise<Response> => {
    const url = new URL(input, "http://localhost:3000");
    const body = typeof init.body === "string" ? init.body : "";
    if (url.pathname === "/api/turn") turnBodies.push(body);
    const spec = ROUTES[url.pathname]!;
    const headers = new Map(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    headers.set("origin", "http://localhost:3000");
    const work = runRoute(spec, { method: init.method ?? "GET", url: url.href, header: (n) => headers.get(n.toLowerCase()) ?? null, text: async () => body }, rig.deps, rig.sched.schedule);
    const { value } = await settle(work, rig.clock, rig.timers);
    if (url.pathname === "/api/turn" && turnBodies.length === 1) throw new TypeError("network connection lost");
    return Response.json(value.body, { status: value.status });
  };
  return Object.assign(f, { turnBodies });
}

/** Sends a line whose first response is lost, advances the clock 1 s, and presses send again. */
async function retryAfterLostResponse() {
  const rig = testRig();
  rig.openai.always("responses.create", ok(completed("Pip, got it.")));
  const fetch = serverFetchLosingFirstTurn(rig);
  const api = createApiClient({ getToken: async () => "token:owner-1", fetch });
  const clock = createBrowserClock({ zone: "UTC", monotonic: { timeOrigin: T0_MS, now: () => rig.clock.read().opsClock.now - T0_MS } });
  let n = 0;
  const typed = new TypedTurns({ api, clock, newId: () => testId(`typed-${++n}`) });

  typed.setText("My dog is called Pip");
  const first = await typed.submit();
  const afterFirst = typed.getSnapshot();
  rig.clock.advance(1_000);
  const second = await typed.submit();
  const sessionId = typed.getSnapshot().sessionId!;
  // newId gave the open request 1, the turn request 2 and the turn 3.
  const saved = await rig.store.get<Turn>(UID, paths.turn(UID, sessionId, testId("typed-3")));
  return { first, afterFirst, second, typed, bodies: fetch.turnBodies, savedRole: saved?.data.role ?? null };
}

describe("typed line retried after a lost response", () => {
  it("today: the retry on an advancing clock differs only in utteredWorldAt and answers HASH", async () => {
    const { first, afterFirst, second, typed, bodies, savedRole } = await retryAfterLostResponse();
    expect(first).toBe(false);
    expect(afterFirst.error).toBe("Not sent: could not reach the server.");
    expect(savedRole).toBe("user"); // the server saved the line
    expect(bodies).toHaveLength(2);
    const [a, b] = bodies.map((s) => JSON.parse(s) as Record<string, unknown>);
    expect(Object.keys(a!).filter((k) => JSON.stringify(a![k]) !== JSON.stringify(b![k]))).toEqual(["utteredWorldAt"]);
    expect(second).toBe(false);
    expect(typed.getSnapshot()).toMatchObject({ text: "My dog is called Pip", error: "Not sent: the server answered HASH." });
  });

  it.fails("a retry on an advancing clock sends a byte-identical body and replays", async () => {
    const { first, second, typed, bodies, savedRole } = await retryAfterLostResponse();
    expect(first).toBe(false);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]);
    expect(second).toBe(true);
    expect(typed.getSnapshot()).toMatchObject({ text: "", error: null });
    expect(savedRole).toBe("user");
  });
});
