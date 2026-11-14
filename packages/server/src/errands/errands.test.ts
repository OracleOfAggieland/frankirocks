/** Brief 049 part A: the errand framework end to end on fakes, with the test-only agent. */
import { ERRAND_LEASE_MS, ERRAND_RESULT_TTL_MS, ERRAND_SILENCE_MS, type Job, errandFailedLine } from "@franki/core";
import { describe, expect, it } from "vitest";
import { stateRoute } from "../routes/state";
import { toolRoute } from "../routes/tool";
import { turnRoute } from "../routes/turn";
import { paths } from "../store/paths";
import { ASK, ERRAND_OWNER as UID, errandOf, plannerRequests, poll, seedMail, errandSetup as setup, testMailAgent, tool } from "../testing/errand-agent";
import { callRoute, recordingSchedule, runScheduled } from "../testing/fakes";
import { claimJob } from "../worker/jobs";
import { asrTurn } from "../testing/session-fixtures";
import { errandIdOf } from "./records";

describe("start_errand", () => {
  it("answers unavailable with no agent registered, and starts nothing", async () => {
    const x = await setup([], { agents: false });
    const res = await callRoute(x.rig, toolRoute, tool(x));
    expect(res.status).toBe(200);
    expect(res.body.result).toMatchObject({ name: "start_errand", state: "unavailable", errandId: null });
    expect(res.body.result.notes[0].sens).toBe("S0");
    expect(await errandOf(x)).toBeNull();
  });

  it("answers notConnected when the only agent is not connected", async () => {
    const x = await setup([]);
    x.rig.deps.errandAgents = [testMailAgent(() => [], async () => "notConnected")];
    const res = await callRoute(x.rig, toolRoute, tool(x));
    expect(res.body.result.state).toBe("notConnected");
  });

  it("answers at once, claims one Errand per turn, and a repeat starts nothing new", async () => {
    const x = await setup([{ call: "search_mail" }, { outcome: "answered", lines: [{ text: "The plumber comes Thursday at 9.", refs: ["r1"] }] }]);
    const res = await callRoute(x.rig, toolRoute, tool(x));
    expect(res.body.result.state).toBe("started");
    expect(plannerRequests(x.rig)).toHaveLength(0);
    const again = await callRoute(x.rig, toolRoute, tool(x, "2"));
    expect(again.body.result.state).toBe("started");
    expect(again.body.result.errandId).toBe(res.body.result.errandId);
    const e = await errandOf(x);
    expect(e?.status).toBe("running");
    expect(e?.assignmentTurnIds).toEqual([x.stamp.turnId]);
  });
});

describe("the run and its delivery", () => {
  it("runs the helper, checks the refs, and says the result once at a pause, attributed, with a card", async () => {
    const x = await setup([{ call: "search_mail" }, { outcome: "answered", lines: [{ text: "The plumber comes Thursday at 9.", refs: ["r1"] }, { text: "No source here.", refs: ["r9"] }] }]);
    await callRoute(x.rig, toolRoute, tool(x));
    await runScheduled(x.rig);
    const e = await errandOf(x);
    expect(e?.status).toBe("ready");
    expect(e?.lines).toHaveLength(1);
    expect(e?.lines[0]?.cls).toBe("T");
    expect(e?.lines[0]?.attribution).toMatch(/^From Pat Plumber/);
    const body = plannerRequests(x.rig)[0]!.body as { store: boolean; input: { role?: string; content?: string }[] };
    expect(body.store).toBe(false);
    expect(body.input[1]).toEqual({ role: "user", content: JSON.stringify({ owner_words: [ASK] }) });

    x.rig.clock.advance(ERRAND_SILENCE_MS + 100);
    const first = await callRoute(x.rig, stateRoute, poll(x));
    expect(first.status).toBe(200);
    expect(first.body.proactive?.whisper.text).toContain("The plumber comes Thursday at 9.");
    expect(first.body.proactive?.whisper.text).toContain("From Pat Plumber");
    expect(first.body.proactive?.permit.kind).toBe("proactive");
    expect(first.body.proactive?.whisper.momentId).toBe(errandIdOf(x.rig.deps.hasher, x.sessionId, x.stamp.turnId));
    expect((await errandOf(x))?.status).toBe("delivered");
    const second = await callRoute(x.rig, stateRoute, poll(x));
    expect(second.body.proactive?.whisper.momentId ?? null).not.toBe(first.body.proactive.whisper.momentId);
    expect(second.body.errands.cards).toHaveLength(1);
    expect(second.body.errands.cards[0].lines.join("\n")).toContain("Pat Plumber · Your visit");
  });

  it("shows the running word while it runs, and waits for silence", async () => {
    const x = await setup([{ never: true }]);
    await callRoute(x.rig, toolRoute, tool(x));
    const st = await callRoute(x.rig, stateRoute, poll(x));
    expect(st.body.errands.running).toEqual(["mail"]);
  });

  it("an uncertain speaker hears no found line: it is carded", async () => {
    const x = await setup([{ call: "search_mail" }, { outcome: "answered", lines: [{ text: "The plumber comes Thursday at 9.", refs: ["r1"] }] }], { judge: "timeout" });
    await callRoute(x.rig, toolRoute, tool(x));
    await runScheduled(x.rig);
    x.rig.clock.advance(ERRAND_SILENCE_MS + 100);
    const st = await callRoute(x.rig, stateRoute, poll(x));
    expect(st.body.proactive?.whisper.text ?? "").not.toContain("Thursday");
  });

  it("a sender the owner never mailed is carded, not spoken", async () => {
    const x = await setup([{ call: "search_mail" }, { outcome: "answered", lines: [{ text: "The plumber comes Thursday at 9.", refs: ["r1"] }] }], { noMail: true });
    x.mail.push(await seedMail(x.rig, "stranger", { text: "Thursday at 9.", from: "Stranger", mailedByOwner: false }));
    await callRoute(x.rig, toolRoute, tool(x));
    await runScheduled(x.rig);
    x.rig.clock.advance(ERRAND_SILENCE_MS + 100);
    const st = await callRoute(x.rig, stateRoute, poll(x));
    expect(st.body.proactive?.whisper.text).toBe("I found something. It's on your screen.");
    expect(st.body.errands.cards).toHaveLength(1);
  });

  it("a failed model call is said plainly, once", async () => {
    const x = await setup([{ raw: { status: "failed", outputText: null, refusal: null, usage: { inputTokens: 0, outputTokens: 0 } } }]);
    await callRoute(x.rig, toolRoute, tool(x));
    await runScheduled(x.rig);
    expect((await errandOf(x))?.status).toBe("failed");
    x.rig.clock.advance(ERRAND_SILENCE_MS + 100);
    const st = await callRoute(x.rig, stateRoute, poll(x));
    expect(st.body.proactive?.whisper.text).toBe(errandFailedLine(["mail"]));
    const again = await callRoute(x.rig, stateRoute, poll(x));
    expect(again.body.proactive?.whisper.text ?? null).not.toBe(errandFailedLine(["mail"]));
  });

  it("a result nobody heard in time drops to card-only", async () => {
    const x = await setup([{ call: "search_mail" }, { outcome: "answered", lines: [{ text: "The plumber comes Thursday at 9.", refs: ["r1"] }] }]);
    await callRoute(x.rig, toolRoute, tool(x));
    await runScheduled(x.rig);
    x.rig.clock.advance(ERRAND_RESULT_TTL_MS + 1);
    const st = await callRoute(x.rig, stateRoute, poll(x));
    expect(st.body.proactive?.whisper.momentId ?? null).toBeNull();
    expect((await errandOf(x))?.status).toBe("cardOnly");
  });

  it("at most two run per owner; a third is busy", async () => {
    const x = await setup([{ never: true }, { never: true }]);
    await callRoute(x.rig, toolRoute, tool(x));
    const second = await callRoute(x.rig, turnRoute, { ...asrTurn({ ...x.stamp, generation: 1 } as never, 2, "Also check my mail for the dentist.", [{ itemId: "item2", commitSeq: 2 }], "final", 2), judge: "O" });
    const s2 = { ...x, stamp: second.body.stamp };
    expect((await callRoute(x.rig, toolRoute, tool(s2, "b"))).body.result.state).toBe("started");
    const third = await callRoute(x.rig, turnRoute, { ...asrTurn({ ...x.stamp } as never, 3, "And the electrician.", [{ itemId: "item3", commitSeq: 3 }], "final", 3), judge: "O" });
    expect((await callRoute(x.rig, toolRoute, tool({ ...x, stamp: third.body.stamp }, "c"))).body.result.state).toBe("busy");
  });

  it("a run whose lease lapsed is picked up by the state poll and restarts from nothing", async () => {
    const x = await setup([{ call: "search_mail" }, { outcome: "answered", lines: [{ text: "The plumber comes Thursday at 9.", refs: ["r1"] }] }]);
    await callRoute(x.rig, toolRoute, tool(x));
    // The first runner claimed the Job and its instance died: its scheduled work is lost, and the lease lapses.
    x.rig.sched = recordingSchedule();
    expect(await claimJob(x.rig.store, UID, errandIdOf(x.rig.deps.hasher, x.sessionId, x.stamp.turnId), x.rig.clock.read().opsClock.now, x.rig.deps.hasher, ERRAND_LEASE_MS)).not.toBeNull();
    x.rig.clock.advance(ERRAND_LEASE_MS + 1);
    await callRoute(x.rig, stateRoute, poll(x));
    await runScheduled(x.rig);
    const job = (await x.rig.store.get<Job>(UID, paths.job(UID, errandIdOf(x.rig.deps.hasher, x.sessionId, x.stamp.turnId))))?.data;
    expect(job?.generation).toBe(2);
    expect((await errandOf(x))?.status).toBe("ready");
  });
});
