import { type CoreEpoch, type Ledger, type Session, type Stamp, idParts, tsFromMs } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { fail, ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { toolRoute } from "../routes/tool";
import { turnRoute } from "../routes/turn";
import { paths } from "../store/paths";
import { callRoute, patchRecord, runScheduled, testRig } from "../testing/fakes";
import { asrTurn, openTestSession } from "../testing/session-fixtures";
import { WEB_SEARCH_RETAIN_MS, readWebSearchView, runWebSearchTask, webSearchId, type WebSearchEntry } from "./tasks";

const uid = "owner-1";
const question = "Which restaurants near me stay open tonight?";
const args = { query: "restaurants near me stay open tonight", local: true, location: "Austin" };
const finding = { text: "Night Kitchen serves until 10 p.m. tonight.", sources: [{ title: "Night Kitchen", url: "https://example.org/hours" }] };

async function setup() {
  const rig = testRig();
  const opened = await openTestSession(rig);
  const ctx = { uid, deps: rig.deps, schedule: rig.sched.schedule };
  const searches: unknown[] = [];
  rig.openai.respond("responses.create", (body) => {
    if (!JSON.stringify(body).includes('"type":"web_search"')) return fail(new Error("no other model output"));
    searches.push(body);
    return ok({ ...completed("verified"), webSearchFindings: [finding] });
  });
  const say = async (n: number, text: string, judge: "O" | "timeout" = "O") => {
    const res = await callRoute(rig, turnRoute, { ...asrTurn(opened.stamp, n, text, [{ itemId: "audio-" + n, commitSeq: n }]), judge });
    expect(res.status).toBe(200);
    return res.body.stamp as Stamp;
  };
  const tool = (stamp: Stamp, name: "search_web" | "read_web_result", args: unknown, key: string) =>
    callRoute(rig, toolRoute, { requestId: testId(key), stamp, callId: key, tool: { name, args } });
  const snapshot = (stamp: Stamp) => rig.store.transaction(uid, async (tx) => {
    const s = (await tx.get<Session>(paths.session(uid, opened.sessionId)))!.data;
    return readWebSearchView(tx, ctx, opened.sessionId, s, stamp.epoch);
  });
  return { rig, opened, ctx, searches, say, tool, snapshot };
}

describe("background web tasks", () => {
  it("accepts a city follow-up, releases the turn before search, and returns private citations for the right task", async () => {
    const { rig, ctx, say, tool, searches, snapshot } = await setup();
    const ask = await say(1, question);
    expect((await tool(ask, "search_web", { ...args, location: null }, "missing")).body.result.state).toBe("needsLocation");
    const city = await say(2, "In Austin please.");
    expect((await tool(city, "search_web", args, "start")).body.result).toMatchObject({ name: "search_web", state: "started" });
    expect((await tool(city, "search_web", args, "duplicate")).body.result.state).toBe("alreadyRunning");
    expect(searches).toHaveLength(0);
    const id = webSearchId(ctx, city);
    expect(await snapshot(city)).toMatchObject({ status: "searching", resumeId: id, cards: [] });
    const ordinary = await say(3, "What is two plus two?");
    expect((await tool(ordinary, "read_web_result", {}, "pending")).body.result).toMatchObject({ status: "searching", findings: [] });
    expect((await tool(ordinary, "search_web", { query: "two plus two", location: null, local: false }, "other-busy")).body.result.state).toBe("busy");
    await runScheduled(rig);
    expect(searches).toHaveLength(1);
    const summary = JSON.stringify(searches[0]);
    expect(summary).toContain(args.query);
    expect(summary).toContain("Austin");
    expect(summary).not.toContain("two plus two");
    const found = await snapshot(ordinary);
    expect(found.status).toBe("found");
    expect((await tool(ordinary, "search_web", { query: "two plus two", location: null, local: false }, "other-ready")).body.result.state).toBe("previousReady");
    expect(found.cards).toMatchObject([{ sens: "S2", lines: [finding.text], citations: finding.sources }]);
    const next = await say(4, "What did you find?");
    const read = await tool(next, "read_web_result", {}, "found");
    expect(read.body.result).toMatchObject({ status: "found", taskId: id, findings: [finding] });
    expect((await tool(next, "read_web_result", {}, "found")).body.result).toEqual(read.body.result);
    const key = ctx.deps.hasher.id(idParts.request(uid, "tool", testId("found")));
    const cached = await rig.store.get<Ledger>(uid, paths.ledger(uid, key));
    expect(JSON.stringify(cached)).not.toContain(finding.text);
    const row = await rig.store.get<WebSearchEntry>(uid, paths.ledger(uid, id));
    expect(row?.data.payload).toMatchObject({ status: "found", attempts: 1, query: null, location: null });
    await patchRecord<Session>(rig.store, uid, paths.session(uid, next.sessionId), { audience: "company" });
    expect((await tool(next, "read_web_result", {}, "found")).body.status).toBe("stale");
    expect(await snapshot(next)).toMatchObject({ status: "none", cards: [] });
    await patchRecord<Session>(rig.store, uid, paths.session(uid, next.sessionId), { audience: "private" });
    rig.clock.advance(WEB_SEARCH_RETAIN_MS + 1);
    expect(await snapshot(next)).toMatchObject({ status: "none", cards: [] });
  });

  it("does not search an invented location, uncertain speaker, unrelated query or street address", async () => {
    const { rig, say, tool, searches } = await setup();
    const stamp = await say(1, question);
    expect((await tool(stamp, "search_web", { query: "restaurants", local: false, location: null }, "abbreviated")).body.result.state).toBe("needsLocation");
    expect((await tool(stamp, "search_web", args, "hallucinated")).body.result.state).toBe("needsLocation");
    expect((await tool(stamp, "search_web", { query: "private family name", local: false, location: null }, "unrelated")).body.result.state).toBe("needsQuestion");
    const uncertain = await say(2, "What concerts are in Austin?", "timeout");
    expect((await tool(uncertain, "search_web", { query: "concerts", local: true, location: "Austin" }, "uncertain")).body.result.state).toBe("unavailable");
    const address = await say(3, "Find restaurants near 123 Main Street.");
    expect((await tool(address, "search_web", { query: "restaurants", local: true, location: "123 Main Street" }, "street")).body.result.state).toBe("needsLocation");
    const privateTurn = await say(4, "My diagnosis is private. Find a concert in Austin.");
    expect((await tool(privateTurn, "search_web", { query: "my diagnosis concert in Austin", local: true, location: "Austin" }, "mixed")).body.result.state).toBe("needsQuestion");
    await runScheduled(rig);
    expect(searches).toHaveLength(0);
  });

  it("resolves a named public subject for a follow-up without sending the earlier conversation", async () => {
    const { rig, say, tool, searches } = await setup();
    await say(1, "Tell me about the City Gallery.");
    const next = await say(2, "Is it open tomorrow?");
    const query = "City Gallery open tomorrow";
    const response = await tool(next, "search_web", { query, local: false, location: null }, "followUp");
    expect(response.body.result.state).toBe("started");
    await runScheduled(rig);
    expect(searches).toHaveLength(1);
    expect(JSON.stringify(searches[0])).toContain(query);
    expect(JSON.stringify(searches[0])).not.toContain("Tell me about");
  });

  it("reclaims a lost lease once, drops an obsolete epoch before provider contact and ignores duplicate workers", async () => {
    const { rig, ctx, say, tool, searches, snapshot } = await setup();
    const stamp = await say(1, "Find concerts in Austin.");
    await tool(stamp, "search_web", { query: "concerts", local: true, location: "Austin" }, "start");
    const id = webSearchId(ctx, stamp);
    const path = paths.ledger(uid, id);
    const row = (await rig.store.get<WebSearchEntry>(uid, path))!.data;
    await patchRecord(rig.store, uid, path, { payload: { ...row.payload, attempts: 1, leaseUntil: tsFromMs(rig.clock.read().opsClock.now + 1000) } });
    await runWebSearchTask(ctx, id);
    expect(searches).toHaveLength(0);
    expect((await snapshot(stamp)).resumeId).toBeNull();
    rig.clock.advance(1_001);
    expect((await snapshot(stamp)).resumeId).toBe(id);
    await Promise.all([runWebSearchTask(ctx, id), runWebSearchTask(ctx, id)]);
    expect(searches).toHaveLength(1);
    const complete = (await rig.store.get<WebSearchEntry>(uid, path))!.data;
    await patchRecord(rig.store, uid, path, { payload: { ...complete.payload, delivered: true } });
    const next = await say(2, "Is the library open?");
    expect((await tool(next, "search_web", { query: "library open", local: true, location: "Austin" }, "again")).body.result.state).toBe("started");
    await patchRecord<CoreEpoch>(rig.store, uid, paths.core(uid, "epoch"), { epoch: stamp.epoch + 1 });
    await runWebSearchTask(ctx, webSearchId(ctx, next));
    expect(searches).toHaveLength(1);
    expect(await rig.store.get(uid, paths.ledger(uid, webSearchId(ctx, next)))).toBeNull();
  });
});
