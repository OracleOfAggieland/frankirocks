/**
 * Pasted text is T (brief 012 G34, brief 018 task B10), against the real routes: a line a paste event supplied goes
 * as `source: "pasted"` and writes nothing in `core/rules`, however short; the same line typed is the owner's own.
 * Test-only imports of server test helpers; no browser module imports the Server_Library.
 */
import type { CoreRules } from "@franki/core";
import { testId } from "@franki/core/testing";
import { type RouteSpec, closeRoute, openRoute, runRoute, turnRoute } from "@franki/server";
import { describe, expect, it } from "vitest";
import { ok } from "../../../../packages/server/src/openai/fake";
import { completed } from "../../../../packages/server/src/openai/responses";
import { paths } from "../../../../packages/server/src/store/paths";
import { T0_MS, type TestRig, settle, testRig } from "../../../../packages/server/src/testing/fakes";
import { type FetchLike, createApiClient } from "./api";
import { createBrowserClock } from "./clock";
import { PASTE_STICKS_UNTIL_CLEARED, TypedTurns } from "./typed-turns";

const UID = "owner-1";
const ROUTES: Record<string, RouteSpec<unknown>> = {
  "/api/session/open": openRoute as RouteSpec<unknown>,
  "/api/session/close": closeRoute as RouteSpec<unknown>,
  "/api/turn": turnRoute as RouteSpec<unknown>,
};
const LINE = "I'm allergic to peanuts, please no satay";

function serverFetch(rig: TestRig): FetchLike & { turnBodies: string[] } {
  const turnBodies: string[] = [];
  const f = async (input: string, init: RequestInit): Promise<Response> => {
    const url = new URL(input, "http://localhost:3000");
    const body = typeof init.body === "string" ? init.body : "";
    if (url.pathname === "/api/turn") turnBodies.push(body);
    const headers = new Map(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    headers.set("origin", "http://localhost:3000");
    const work = runRoute(ROUTES[url.pathname]!, { method: init.method ?? "GET", url: url.href, header: (n) => headers.get(n.toLowerCase()) ?? null, text: async () => body }, rig.deps, rig.sched.schedule);
    const { value } = await settle(work, rig.clock, rig.timers);
    return Response.json(value.body, { status: value.status });
  };
  return Object.assign(f, { turnBodies });
}

function setup() {
  const rig = testRig();
  rig.openai.always("responses.create", ok(completed("All right.")));
  const fetch = serverFetch(rig);
  const api = createApiClient({ getToken: async () => "token:owner-1", fetch });
  const clock = createBrowserClock({ zone: "UTC", monotonic: { timeOrigin: T0_MS, now: () => rig.clock.read().opsClock.now - T0_MS } });
  let n = 0;
  const typed = new TypedTurns({ api, clock, newId: () => testId(`paste-${++n}`) });
  const rules = async () => (await rig.store.get<CoreRules>(UID, paths.core(UID, "rules")))!.data;
  return { rig, fetch, typed, rules };
}

describe("pasted text is T (B10)", () => {
  it("a pasted one-line allergy goes as pasted and writes nothing in core/rules", async () => {
    const { rig, fetch, typed, rules } = setup();
    typed.markPasted();
    typed.setText(LINE);
    expect(await typed.submit()).toBe(true);
    expect(JSON.parse(fetch.turnBodies[0]!).source).toBe("pasted");
    const r = await rules();
    expect(r.allergies).toEqual([]);
    expect(r.proposals).toEqual([]);
    expect(rig.fastSlots.calls).toHaveLength(0);
    // The box is clear and the next line is the owner's own again.
    expect(typed.getSnapshot()).toMatchObject({ text: "", pasted: false });
  });

  it("the same line typed is the owner's own: the route runs and the rule fails closed at least", async () => {
    const { fetch, typed, rules } = setup();
    typed.setText(LINE);
    expect(await typed.submit()).toBe(true);
    expect(JSON.parse(fetch.turnBodies[0]!).source).toBe("typed");
    expect((await rules()).allergies.length).toBeGreaterThan(0);
  });

  it("typing around pasted words keeps the line pasted until the box is cleared", async () => {
    const { typed } = setup();
    expect(PASTE_STICKS_UNTIL_CLEARED).toBe(true);
    typed.setText("She said: ");
    typed.markPasted();
    typed.setText(`She said: ${LINE}`);
    typed.setText(`She said: ${LINE}. Hm.`);
    expect(typed.getSnapshot().pasted).toBe(true);
    typed.setText("");
    expect(typed.getSnapshot().pasted).toBe(false);
  });

  it("a chip's words are never pasted, whatever is in the box", async () => {
    const { fetch, typed } = setup();
    typed.markPasted();
    typed.setText(LINE);
    expect(await typed.sendLine("What do you remember?")).toBe(true);
    expect(JSON.parse(fetch.turnBodies[0]!).source).toBe("typed");
    expect(typed.getSnapshot()).toMatchObject({ text: LINE, pasted: true });
  });
});
