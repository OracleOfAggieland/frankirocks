/**
 * The browser's typed-turn and Debug_Panel clients against the real Server_Library routes (task 28 checkpoint).
 * The fetch passed to the ApiClient runs each request through `runRoute` on the Memory_Store with Fake_OpenAI and
 * the fake Clock_Port, so this checks that the bodies the browser builds are the ones the routes accept.
 * Test-only imports of server test helpers; no browser module imports the Server_Library.
 */
import { testId } from "@franki/core/testing";
import { type RouteSpec, closeRoute, debugMemoryRoute, openRoute, runRoute, turnRoute } from "@franki/server";
import { describe, expect, it } from "vitest";
import { ok } from "../../../../packages/server/src/openai/fake";
import { completed } from "../../../../packages/server/src/openai/responses";
import { extractOutput, factItem } from "../../../../packages/server/src/testing/extract-fixtures";
import { T0_MS, type TestRig, runScheduled, settle, testRig } from "../../../../packages/server/src/testing/fakes";
import { turnEvidenceId } from "../../../../packages/server/src/turns";
import { type FetchLike, createApiClient } from "./api";
import { createBrowserClock } from "./clock";
import { DebugPanelModel } from "./debug-panel";
import { TypedTurns } from "./typed-turns";

const ROUTES: Record<string, RouteSpec<unknown>> = {
  "/api/session/open": openRoute as RouteSpec<unknown>,
  "/api/session/close": closeRoute as RouteSpec<unknown>,
  "/api/turn": turnRoute as RouteSpec<unknown>,
  "/api/debug/memory": debugMemoryRoute as RouteSpec<unknown>,
};

/** A same-origin fetch that serves the routes from the test rig. */
function serverFetch(rig: TestRig): FetchLike & { paths: string[] } {
  const paths: string[] = [];
  const f = async (input: string, init: RequestInit): Promise<Response> => {
    const url = new URL(input, "http://localhost:3000");
    paths.push(url.pathname);
    const spec = ROUTES[url.pathname];
    if (spec === undefined) return Response.json({ error: "PARSE", retryAfterMs: 0 }, { status: 404 });
    const headers = new Map(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    // The browser adds Origin to same-origin POSTs.
    if ((init.method ?? "GET") !== "GET") headers.set("origin", "http://localhost:3000");
    const body = typeof init.body === "string" ? init.body : "";
    const work = runRoute(spec, { method: init.method ?? "GET", url: url.href, header: (n) => headers.get(n.toLowerCase()) ?? null, text: async () => body }, rig.deps, rig.sched.schedule);
    const { value } = await settle(work, rig.clock, rig.timers);
    return Response.json(value.body, { status: value.status });
  };
  return Object.assign(f, { paths });
}

describe("browser clients against the server routes", () => {
  it("a typed line from TypedTurns becomes a Memory the Debug_Panel shows with lineage", async () => {
    const rig = testRig();
    const fetch = serverFetch(rig);
    const api = createApiClient({ getToken: async () => "token:owner-1", fetch });
    const clock = createBrowserClock({ zone: "America/Chicago", monotonic: { timeOrigin: T0_MS, now: () => 0 } });
    let n = 0;
    const typed = new TypedTurns({ api, clock, newId: () => testId(`browser-${++n}`) });
    const panel = new DebugPanelModel({ api, clock });

    rig.openai.script("responses.create", ok(completed("Pip, got it.")));
    typed.setText("My dog is called Pip");
    expect(await typed.submit()).toBe(true);
    expect(typed.getSnapshot().entries.map((e) => e.text)).toEqual(["My dog is called Pip", "Pip, got it."]);
    expect(fetch.paths).toEqual(["/api/session/open", "/api/turn"]);

    // The turn's Evidence ID comes from its turnId: newId gave the open request 1, the turn request 2, the turn 3.
    const eid = turnEvidenceId(testId("browser-3"), rig.deps.hasher);
    const item = factItem("statement", "new", "The owner's dog is called Pip", [{ eid, fieldPath: "text", start: 17, end: 20, quote: "Pip" }]);
    rig.openai.script("responses.create", ok(completed(JSON.stringify(extractOutput([item])))));
    await runScheduled(rig);

    await panel.refresh();
    const s = panel.getSnapshot();
    expect(s.stale).toBe(false);
    expect(s.data!.turns.map((t) => [t.record.seq, t.record.role, t.record.evidenceId])).toEqual([[1, "user", eid]]);
    expect(s.data!.jobs.map((j) => j.record.status)).toEqual(["complete"]);
    expect(s.data!.memories).toHaveLength(1);
    expect(s.data!.memories[0]!.lineage).toMatchObject({ ok: true, failures: [] });
    expect(s.data!.memories[0]!.lineage.links.map((l) => l.text)).toEqual(["Pip"]);
    expect(s.data!.ledger.some((l) => l.permitKind === "slowOrdinary")).toBe(true);
    expect(s.data!.head?.head?.text).not.toContain("The owner's dog is called Pip");

    // A second line uses clientSeq 2 on the same Session.
    rig.openai.script("responses.create", ok(completed("Noted.")));
    typed.setText("He is three");
    expect(await typed.submit()).toBe(true);
    await runScheduled(rig);
    await panel.refresh();
    expect(panel.getSnapshot().data!.turns.map((t) => t.record.seq)).toEqual([1, 2]);
  });
});
