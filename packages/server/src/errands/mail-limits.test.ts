/**
 * Owner ruling, Nov 19 (lane mail-limits): no time limits on a Gmail errand. Fakes only: the in-request hand-off
 * (`hand-off.ts`, `run-endpoint.ts`), one planner step's tool calls run together, the lease kept through a long run,
 * and a broad mail ask spoken with each sender named by code.
 */
import { type CoreEpoch, ERRAND_LEASE_RENEW_MS, ERRAND_SILENCE_MS, type ID, type Job, msFromTs, tsFromMs } from "@franki/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeResponse } from "../openai/live";
import { stateRoute } from "../routes/state";
import { toolRoute } from "../routes/tool";
import { paths } from "../store/paths";
import { ERRAND_OWNER as UID, type ErrandSetup, errandOf, plannerRequests, poll, errandSetup as setup, scriptPlanner, searchTool, testMailAgent, tool } from "../testing/errand-agent";
import { callRoute, patchRecord, runScheduled, settle } from "../testing/fakes";
import { gmailMessage } from "../testing/fake-google";
import { dmarcPass, googleErrand, readerSays } from "../testing/google-errand";
import type { ErrandTool } from "./agent";
import { pickUp } from "./deliver";
import { dropAllErrands } from "./forget";
import { ERRAND_HANDOFF_WINDOW_MS, ERRAND_RUN_PATH, errandRunBinding, errandRunCapability, errandRunOrigin, handOffErrandRun } from "./hand-off";
import { errandRunEndpoint } from "./run-endpoint";

const ORIGIN = "https://frankirocks.com";
const FOUND = "The plumber comes Thursday at 9.";
const answered = { outcome: "answered" as const, lines: [{ text: FOUND, refs: ["r1"] }] };
const ctxOf = (x: ErrandSetup) => ({ uid: UID, deps: x.rig.deps, schedule: x.rig.sched.schedule });
const callsResponse = (items: Record<string, unknown>[]) => normalizeResponse({ status: "completed", output: items } as never);
const fcall = (id: string, name: string, args: unknown) => ({ type: "function_call", status: "completed", call_id: id, name, arguments: JSON.stringify(args) });
const withOrigin = (x: ErrandSetup) => {
  x.rig.deps.env = { ...x.rig.deps.env, FRANKI_ERRAND_RUN_ORIGIN: ORIGIN };
};
/** A capability's body re-signed with the ID key, the way only this app can. */
const signed = (x: ErrandSetup, binding: unknown) => {
  const body = Buffer.from(JSON.stringify(binding)).toString("base64url");
  return `Bearer ${body}.${x.rig.deps.hasher.id(["errand-run-capability", body])}`;
};
const runRequest = (authorization: string | null, init: { method?: string; origin?: string } = {}) =>
  new Request(`${ORIGIN}${ERRAND_RUN_PATH}`, {
    method: init.method ?? "POST",
    headers: { ...(authorization === null ? {} : { authorization }), ...(init.origin === undefined ? {} : { origin: init.origin }) },
    ...(init.method === "GET" ? {} : { body: "{}" }),
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the hand-off's origin", () => {
  it("is used only when it is exactly one of the app's own origins", () => {
    expect(errandRunOrigin({})).toBeNull();
    expect(errandRunOrigin({ FRANKI_ERRAND_RUN_ORIGIN: "" })).toBeNull();
    expect(errandRunOrigin({ FRANKI_ERRAND_RUN_ORIGIN: ORIGIN })).toBe(ORIGIN);
    for (const bad of ["https://evil.example", `${ORIGIN}/`, `${ORIGIN}/api`, "https://user:pw@frankirocks.com", "not a url"]) {
      expect(errandRunOrigin({ FRANKI_ERRAND_RUN_ORIGIN: bad })).toBeNull();
    }
  });
});

describe("the hand-off's capability", () => {
  it("round-trips the owner and the Errand", async () => {
    const x = await setup([]);
    const b = errandRunBinding(x.rig.deps, `Bearer ${errandRunCapability(x.rig.deps, UID, x.errandId)}`);
    expect(b).toMatchObject({ uid: UID, errandId: x.errandId });
  });

  it("refuses a forged proof, a changed body, a wrong scheme and an expired one", async () => {
    const x = await setup([]);
    const cap = errandRunCapability(x.rig.deps, UID, x.errandId);
    const [body, proof] = cap.split(".") as [string, string];
    const flipped = `${proof.slice(0, -1)}${proof.endsWith("A") ? "B" : "A"}`;
    expect(errandRunBinding(x.rig.deps, `Bearer ${body}.${flipped}`)).toBeNull();
    const other = Buffer.from(JSON.stringify({ uid: "someone-else", errandId: x.errandId, until: Number.MAX_SAFE_INTEGER })).toString("base64url");
    expect(errandRunBinding(x.rig.deps, `Bearer ${other}.${proof}`)).toBeNull();
    expect(errandRunBinding(x.rig.deps, `Basic ${cap}`)).toBeNull();
    expect(errandRunBinding(x.rig.deps, cap)).toBeNull();
    expect(errandRunBinding(x.rig.deps, "")).toBeNull();
    x.rig.clock.advance(ERRAND_HANDOFF_WINDOW_MS + 1);
    expect(errandRunBinding(x.rig.deps, `Bearer ${cap}`)).toBeNull();
  });

  it("refuses a correctly signed body that is not a binding", async () => {
    const x = await setup([]);
    const until = x.rig.clock.read().opsClock.now + 1_000;
    expect(errandRunBinding(x.rig.deps, signed(x, null))).toBeNull();
    expect(errandRunBinding(x.rig.deps, signed(x, { uid: UID, errandId: "../jobs/x", until }))).toBeNull();
    expect(errandRunBinding(x.rig.deps, signed(x, { uid: "", errandId: x.errandId, until }))).toBeNull();
    expect(errandRunBinding(x.rig.deps, signed(x, { uid: "u".repeat(129), errandId: x.errandId, until }))).toBeNull();
    expect(errandRunBinding(x.rig.deps, signed(x, { uid: UID, errandId: x.errandId, until: "soon" }))).toBeNull();
    expect(errandRunBinding(x.rig.deps, signed(x, { uid: UID, errandId: x.errandId, until }))).toMatchObject({ uid: UID });
  });
});

describe("handOffErrandRun", () => {
  it("with no origin configured, sends nothing and leaves the run here", async () => {
    const x = await setup([]);
    const f = vi.fn<typeof fetch>();
    expect(await handOffErrandRun(ctxOf(x), x.errandId, f)).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it("posts a capability for this owner and Errand to the app's own origin, refusing redirects", async () => {
    const x = await setup([]);
    withOrigin(x);
    const f = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ran: true }));
    expect(await handOffErrandRun(ctxOf(x), x.errandId, f)).toBe(true);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe(`${ORIGIN}${ERRAND_RUN_PATH}`);
    expect(init).toMatchObject({ method: "POST", redirect: "error" });
    const auth = (init!.headers as Record<string, string>).authorization!;
    expect(errandRunBinding(x.rig.deps, auth)).toMatchObject({ uid: UID, errandId: x.errandId });
  });

  it("a failed answer or a thrown fetch leaves the run here", async () => {
    const x = await setup([]);
    withOrigin(x);
    expect(await handOffErrandRun(ctxOf(x), x.errandId, vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 })))).toBe(false);
    expect(await handOffErrandRun(ctxOf(x), x.errandId, vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed")))).toBe(false);
  });
});

describe("POST /api/errand/run", () => {
  it("refuses another method, any browser request and a bad capability", async () => {
    const x = await setup([]);
    const cap = `Bearer ${errandRunCapability(x.rig.deps, UID, x.errandId)}`;
    expect((await errandRunEndpoint(runRequest(cap, { method: "GET" }), x.rig.sched.schedule, x.rig.deps)).status).toBe(405);
    expect((await errandRunEndpoint(runRequest(cap, { origin: ORIGIN }), x.rig.sched.schedule, x.rig.deps)).status).toBe(403);
    expect((await errandRunEndpoint(runRequest(null), x.rig.sched.schedule, x.rig.deps)).status).toBe(401);
    expect((await errandRunEndpoint(runRequest("Bearer x.y"), x.rig.sched.schedule, x.rig.deps)).status).toBe(401);
    expect(plannerRequests(x.rig)).toHaveLength(0);
  });

  it("the run is handed off, ends inside the hand-off request, and a repeat does nothing", async () => {
    const x = await setup([{ call: "search_mail" }, answered]);
    withOrigin(x);
    const seen: { status: number; outcome: string | undefined }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      const res = await errandRunEndpoint(new Request(url, init), x.rig.sched.schedule, x.rig.deps);
      // The answer comes only once the run has ended, so Cloud Run kept the CPU on for all of it.
      seen.push({ status: res.status, outcome: (await errandOf(x))?.outcome ?? undefined });
      return res;
    });
    await callRoute(x.rig, toolRoute, tool(x));
    await runScheduled(x.rig);
    // The setup turn's own scheduled work may hand the same Errand off again; only one claim runs it.
    expect(seen.length).toBeGreaterThanOrEqual(1);
    expect(seen.every((s) => s.status === 200 && s.outcome === "answered")).toBe(true);
    expect(plannerRequests(x.rig)).toHaveLength(2);
    // A second hand-off (a poll's pick-up racing the first) finds the Job done and runs nothing.
    const again = await settle(errandRunEndpoint(runRequest(`Bearer ${errandRunCapability(x.rig.deps, UID, x.errandId)}`), x.rig.sched.schedule, x.rig.deps), x.rig.clock, x.rig.timers);
    expect(again.value.status).toBe(200);
    expect(plannerRequests(x.rig)).toHaveLength(2);
    expect((await errandOf(x))?.lines[0]?.text).toBe(FOUND);
  });

  it("when the hand-off can't be made (here, fetch is blocked), the run happens where it was scheduled", async () => {
    const x = await setup([{ call: "search_mail" }, answered]);
    withOrigin(x);
    await callRoute(x.rig, toolRoute, tool(x));
    await runScheduled(x.rig);
    expect((await errandOf(x))?.outcome).toBe("answered");
    expect(x.rig.logs.some((l) => l.event === "errand.handOff" && l.fields.error !== undefined)).toBe(true);
  });
});

describe("one planner step's tool calls run together", () => {
  it("three slow calls overlap, and each gets exactly one output, in the order asked", async () => {
    const x = await setup([{ raw: callsResponse(["a", "b", "c"].map((q) => fcall(`call_${q}`, "search_mail", { query: q }))) }, answered]);
    let inFlight = 0;
    let most = 0;
    const finished: string[] = [];
    const slow: ErrandTool = {
      ...searchTool(() => x.mail),
      async run(ctx, args) {
        const q = (args as { query: string }).query;
        inFlight++;
        most = Math.max(most, inFlight);
        // The first asked finishes last.
        await x.rig.deps.timers.sleep({ a: 9_000, b: 6_000, c: 3_000 }[q]!);
        inFlight--;
        finished.push(q);
        const out = (await searchTool(() => x.mail).run(ctx, args)) as Record<string, unknown>;
        return { ...out, query: q };
      },
    };
    x.rig.deps.errandAgents = [{ ...testMailAgent(() => x.mail), tools: [slow] }];
    const t0 = x.rig.clock.read().opsClock.now;
    await callRoute(x.rig, toolRoute, tool(x));
    await runScheduled(x.rig);
    expect(most).toBe(3);
    expect(finished).toEqual(["c", "b", "a"]);
    expect(x.rig.clock.read().opsClock.now - t0).toBeLessThan(18_000);
    const input = (plannerRequests(x.rig)[1]!.body as { input: { type?: string; call_id?: string; output?: string }[] }).input;
    const outs = input.filter((i) => i.type === "function_call_output");
    expect(outs.map((o) => o.call_id)).toEqual(["call_a", "call_b", "call_c"]);
    expect(outs.map((o) => (JSON.parse(o.output!) as { data: { query: string } }).data.query)).toEqual(["a", "b", "c"]);
    expect((await errandOf(x))?.outcome).toBe("answered");
  });
});

describe("a long run keeps its lease, so a poll's pick-up never starts a second runner", () => {
  it("45 s into a 50 s tool call (past the 20 s lease), pickUp schedules nothing", async () => {
    const x = await setup([{ call: "search_mail" }, answered]);
    let toolStarted: () => void = () => {};
    const started = new Promise<void>((r) => (toolStarted = r));
    const slow: ErrandTool = {
      ...searchTool(() => x.mail),
      async run(ctx, args) {
        toolStarted();
        await x.rig.deps.timers.sleep(50_000);
        return searchTool(() => x.mail).run(ctx, args);
      },
    };
    x.rig.deps.errandAgents = [{ ...testMailAgent(() => x.mail), tools: [slow] }];
    await callRoute(x.rig, toolRoute, tool(x));
    let added = -1;
    let job: Job | null = null;
    let at = 0;
    const watch = (async () => {
      await started;
      await x.rig.deps.timers.sleep(45_000);
      const before = x.rig.sched.pending;
      await pickUp(ctxOf(x), x.errandId as ID);
      added = x.rig.sched.pending - before;
      at = x.rig.clock.read().opsClock.now;
      job = (await x.rig.store.get<Job>(UID, paths.job(UID, x.errandId)))?.data ?? null;
    })();
    await settle(Promise.all([x.rig.sched.runAll(), watch]), x.rig.clock, x.rig.timers);
    expect(added).toBe(0);
    expect(job).toMatchObject({ status: "leased" });
    expect(msFromTs((job as unknown as Job).leaseUntil!)).toBeGreaterThan(at);
    expect(plannerRequests(x.rig)).toHaveLength(2);
    expect((await errandOf(x))?.outcome).toBe("answered");
  });
});

describe("with no deadline, a forget still stops a long call at the next beat", () => {
  async function stoppedBy(forget: (x: ErrandSetup) => Promise<void>) {
    const x = await setup([{ call: "search_mail" }, answered]);
    let toolStarted: () => void = () => {};
    const started = new Promise<void>((r) => (toolStarted = r));
    let signal: AbortSignal | undefined;
    let abortedAt = 0;
    const slow: ErrandTool = {
      ...searchTool(() => x.mail),
      async run(ctx, args) {
        signal = ctx.signal;
        ctx.signal.addEventListener("abort", () => (abortedAt = x.rig.clock.read().opsClock.now), { once: true });
        toolStarted();
        await x.rig.deps.timers.sleep(120_000, ctx.signal);
        return searchTool(() => x.mail).run(ctx, args);
      },
    };
    x.rig.deps.errandAgents = [{ ...testMailAgent(() => x.mail), tools: [slow] }];
    await callRoute(x.rig, toolRoute, tool(x));
    let forgotAt = 0;
    const watch = (async () => {
      await started;
      await x.rig.deps.timers.sleep(10_000);
      forgotAt = x.rig.clock.read().opsClock.now;
      await forget(x);
    })();
    await settle(Promise.all([x.rig.sched.runAll(), watch]), x.rig.clock, x.rig.timers);
    return { x, signal, stoppedAfter: abortedAt - forgotAt };
  }

  it("the Errand dropped by a forget: the tool is told to stop within one beat, and nothing is written", async () => {
    const { x, signal, stoppedAfter } = await stoppedBy((x) => dropAllErrands(x.rig.store, UID, tsFromMs(x.rig.clock.read().opsClock.now)).then(() => {}));
    expect(signal?.aborted).toBe(true);
    expect(stoppedAfter).toBeGreaterThanOrEqual(0);
    expect(stoppedAfter).toBeLessThanOrEqual(ERRAND_LEASE_RENEW_MS);
    expect(plannerRequests(x.rig)).toHaveLength(1);
    expect((await errandOf(x))?.reads ?? []).toEqual([]);
  });

  it("the epoch moved: the same", async () => {
    const { x, signal, stoppedAfter } = await stoppedBy(async (x) => {
      const ep = paths.core(UID, "epoch");
      const e = (await x.rig.store.get<CoreEpoch>(UID, ep))!.data;
      await patchRecord<CoreEpoch>(x.rig.store, UID, ep, { epoch: e.epoch + 1 });
    });
    expect(signal?.aborted).toBe(true);
    expect(stoppedAfter).toBeLessThanOrEqual(ERRAND_LEASE_RENEW_MS);
    expect(plannerRequests(x.rig)).toHaveLength(1);
    expect((await errandOf(x))?.outcome ?? null).not.toBe("answered");
  });
});

describe("a broad mail ask is spoken, each sender named by code", () => {
  it("'What about my email?': an authenticated shop by its name, an unchecked sender by address", async () => {
    const { x, google } = await googleErrand();
    google.messages.set("m1", gmailMessage("m1", { from: "Acme Shop <orders@acme.example>", subject: "Your order shipped", text: "Arriving Tuesday.", date: Date.UTC(2026, 10, 18, 15, 0), headers: [dmarcPass("acme.example")] }));
    google.messages.set("m2", gmailMessage("m2", { from: "Totally Your Bank <deals@shop.example>", subject: "Sale", text: "Half off.", date: Date.UTC(2026, 10, 17, 15, 0) }));
    const started = await callRoute(x.rig, toolRoute, tool(x));
    expect(started.body.result.state).toBe("started");
    scriptPlanner(
      x.rig,
      [
        { call: "search_mail", args: { from: null, words: [], when: null, unread: false } },
        { raw: callsResponse([fcall("ra", "read_mail", { ref: "r1" }), fcall("rb", "read_mail", { ref: "r2" })]) },
        { outcome: "answered", lines: [{ text: "Your order arrives Tuesday.", refs: ["r1"] }, { text: "There is a sale on.", refs: ["r2"] }] },
      ],
      readerSays("The sender says something."),
    );
    await runScheduled(x.rig);
    const e = (await errandOf(x))!;
    expect(e.outcome).toBe("answered");
    expect(e.reads.map((r) => r.sender?.address)).toEqual(["orders@acme.example", "deals@shop.example"]);
    x.rig.clock.advance(ERRAND_SILENCE_MS + 100);
    const st = await callRoute(x.rig, stateRoute, poll(x));
    const said = st.body.proactive?.whisper.text as string;
    expect(said).toContain("From Acme Shop");
    expect(said).toContain("Your order arrives Tuesday.");
    expect(said).toContain("From deals@shop.example");
    expect(said).not.toContain("Totally Your Bank");
  });
});
