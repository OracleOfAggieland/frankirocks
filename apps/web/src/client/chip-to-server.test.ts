/**
 * The chip "What do you know about me?" against the real routes (brief 020; spec §15). The chip's words go down the
 * typed path as the owner's own (`source:"typed"`, no audio), the reply is told to the memory model, and the readout
 * reads GET /api/memory through the same view-model as the main screen.
 * Test-only imports of server test helpers; no browser module imports the Server_Library.
 */
import { testId } from "@franki/core/testing";
import { type RouteSpec, closeRoute, memoryRoute, openRoute, runRoute, turnRoute } from "@franki/server";
import { describe, expect, it } from "vitest";
import { ok } from "../../../../packages/server/src/openai/fake";
import { completed } from "../../../../packages/server/src/openai/responses";
import { commitUserTurnForTest, insertMemoryForTest } from "../../../../packages/server/src/testing/extract-fixtures";
import { T0_MS, type TestRig, settle, testRig } from "../../../../packages/server/src/testing/fakes";
import { readoutCard } from "../ui/memory-screen";
import { type FetchLike, createApiClient } from "./api";
import { createBrowserClock } from "./clock";
import { MAIN_CHIPS, MemoryModel } from "./memory-model";
import { TypedTurns } from "./typed-turns";

const UID = "owner-1";
const ROUTES: Record<string, RouteSpec<unknown>> = {
  "/api/session/open": openRoute as RouteSpec<unknown>,
  "/api/session/close": closeRoute as RouteSpec<unknown>,
  "/api/turn": turnRoute as RouteSpec<unknown>,
  "/api/memory": memoryRoute as RouteSpec<unknown>,
};

function serverFetch(rig: TestRig): FetchLike & { turnBodies: string[] } {
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
    return Response.json(value.body, { status: value.status });
  };
  return Object.assign(f, { turnBodies });
}

describe("the chip, typed path to the server (brief 020)", () => {
  it("sends the chip's words as a typed line, leaves the box alone, and reads the readout from GET /api/memory", async () => {
    const rig = testRig();
    rig.openai.always("responses.create", ok(completed("I know a few things.")));
    const t = await commitUserTurnForTest(rig.store, UID, testId("src0"), "My dog is called Pip", rig.clock, rig.deps.hasher);
    await insertMemoryForTest(rig.store, UID, t, rig.deps.hasher, {}, "m0");
    const fetch = serverFetch(rig);
    const api = createApiClient({ getToken: async () => "token:owner-1", fetch });
    const clock = createBrowserClock({ zone: "UTC", monotonic: { timeOrigin: T0_MS, now: () => rig.clock.read().opsClock.now - T0_MS } });
    const memory = new MemoryModel({ api });
    const replies: string[] = [];
    let n = 0;
    const typed = new TypedTurns({ api, clock, newId: () => testId(`chip-${++n}`), onReply: (r) => (replies.push(r.transcript), memory.onReply(r)) });

    typed.setText("half a thought");
    expect(await typed.sendLine(MAIN_CHIPS[0]!)).toBe(true);
    const sent = JSON.parse(fetch.turnBodies[0]!);
    expect(sent).toMatchObject({ source: "typed", items: [], judge: "typed", transcriptState: "final", transcript: "What do you know about me?" });
    expect(typed.getSnapshot().text).toBe("half a thought");
    expect(replies).toEqual(["What do you know about me?"]);

    await memory.openReadout();
    const pages = memory.getSnapshot().readout!;
    const card = readoutCard(pages, () => {});
    expect(card.kind === "read" && card.lines).toEqual(["fact: My dog is called Pip"]);
  });
});
