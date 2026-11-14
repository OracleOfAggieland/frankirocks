/**
 * Brief 049 part C, review Group 4: end-to-end scripts with the Google agents through the real routes (`/api/tool`,
 * the scheduled run, `/api/state`), on fakes only. The ask in a private call with the result at a pause, and the
 * disconnect mid-run and expired grant, are in `google-agents.test.ts` and `google-review.test.ts`; these add company,
 * a forget midway, Google not connected, two calendar asks and a mixed mail and calendar ask.
 */
import { type CoreEpoch, ERRAND_SILENCE_MS, type Session, localMinuteAt, tsFromMs } from "@franki/core";
import { describe, expect, it } from "vitest";
import { googleDisconnectRoute } from "../google/routes";
import { stateRoute } from "../routes/state";
import { toolRoute } from "../routes/tool";
import { paths } from "../store/paths";
import { ERRAND_OWNER, type PlannerStep, errandOf, plannerRequests, poll, scriptPlanner, tool } from "../testing/errand-agent";
import { ACCOUNT_EMAIL, calendarEvent, gmailMessage } from "../testing/fake-google";
import { callRoute, patchRecord, runScheduled } from "../testing/fakes";
import { dmarcPass, googleErrand, readerSays } from "../testing/google-errand";
import { testId } from "@franki/core/testing";
import { dropAllErrands } from "./forget";

const ZONE = "America/Chicago";
const at = (date: string, hh: number) => new Date(localMinuteAt(date, hh * 60, ZONE)!).toISOString();

async function withPat() {
  const g = await googleErrand();
  await patchRecord(g.x.rig.store, ERRAND_OWNER, paths.core(ERRAND_OWNER, "state"), { currentZone: ZONE } as never);
  g.google.messages.set("m1", gmailMessage("m1", { from: "Pat Plumber <pat@plumbing.example.org>", subject: "Your visit", text: "The plumber comes Thursday at 9.", headers: [dmarcPass("plumbing.example.org")] }));
  g.google.messages.set("s1", gmailMessage("s1", { from: `Owner <${ACCOUNT_EMAIL}>`, to: "pat@plumbing.example.org", subject: "Plumbing", text: "Can you come by?", labels: ["SENT"] }));
  g.google.events = { timeZone: ZONE, items: [calendarEvent("e1", { summary: "Dentist", start: { dateTime: at("2026-11-04", 13) }, end: { dateTime: at("2026-11-04", 14) } }), calendarEvent("e2", { summary: "Design review", start: { dateTime: at("2026-11-05", 13) }, end: { dateTime: at("2026-11-05", 14) } })] };
  return g;
}

const MAIL_STEPS: PlannerStep[] = [
  { call: "search_mail", args: { from: "pat", words: ["plumber"], when: null, unread: false } },
  { call: "read_mail", args: { ref: "r1" } },
  { outcome: "answered", lines: [{ text: "The plumber comes Thursday at 9.", refs: ["r1"] }] },
];
const reader = readerSays("The sender says the plumber comes Thursday at 9.", "Thursday at 9");

async function pause(x: Awaited<ReturnType<typeof withPat>>["x"]) {
  x.rig.clock.advance(ERRAND_SILENCE_MS + 100);
  return callRoute(x.rig, stateRoute, poll(x));
}

describe("Google errands end to end", () => {
  it("in company, the found line from someone else's mail is never said", async () => {
    const { x } = await withPat();
    scriptPlanner(x.rig, MAIL_STEPS, reader);
    expect((await callRoute(x.rig, toolRoute, tool(x))).body.result.state).toBe("started");
    await runScheduled(x.rig);
    expect((await errandOf(x))?.status).toBe("ready");
    await patchRecord<Session>(x.rig.store, ERRAND_OWNER, paths.session(ERRAND_OWNER, x.sessionId), { audience: "company" });
    const p = await pause(x);
    expect(JSON.stringify(p.body.proactive ?? null)).not.toContain("Thursday at 9");
    expect(JSON.stringify(p.body.errands?.cards ?? [])).not.toContain("Thursday at 9");
  });

  it("a forget midway: the run's result is never said or shown, and the Errand keeps nothing", async () => {
    const { x, google } = await withPat();
    scriptPlanner(x.rig, MAIL_STEPS, reader);
    expect((await callRoute(x.rig, toolRoute, tool(x))).body.result.state).toBe("started");
    google.during("getMessage", async () => {
      const ep = paths.core(ERRAND_OWNER, "epoch");
      const e = (await x.rig.store.get<CoreEpoch>(ERRAND_OWNER, ep))!.data;
      await patchRecord<CoreEpoch>(x.rig.store, ERRAND_OWNER, ep, { epoch: e.epoch + 1 });
      await dropAllErrands(x.rig.store, ERRAND_OWNER, tsFromMs(x.rig.clock.read().opsClock.now));
    });
    await runScheduled(x.rig);
    const e = await errandOf(x);
    expect(e?.status).toBe("dropped");
    expect(e?.lines ?? []).toEqual([]);
    expect(e?.reads ?? []).toEqual([]);
    const p = await pause(x);
    expect(JSON.stringify(p.body.proactive ?? null)).not.toContain("Thursday");
    expect(p.body.errands?.cards ?? []).toEqual([]);
  });

  it("Google not connected: the ask answers notConnected, says so, and starts nothing", async () => {
    const { x } = await withPat();
    expect((await callRoute(x.rig, googleDisconnectRoute, { requestId: testId("gd-e2e") })).status).toBe(200);
    const r = await callRoute(x.rig, toolRoute, tool(x));
    expect(r.body.result.state).toBe("notConnected");
    expect(r.body.result.notes[0].text).toMatch(/not connected/);
    expect(await errandOf(x)).toBeNull();
    expect(plannerRequests(x.rig)).toHaveLength(0);
  });

  it("'what's on tomorrow': the owner's own event is said at a pause", async () => {
    const { x } = await withPat();
    scriptPlanner(x.rig, [
      { call: "list_events", args: { when: "tomorrow", part: null } },
      { outcome: "answered", lines: [{ text: "Tomorrow you have the dentist at 1 PM.", refs: ["r1"] }] },
    ]);
    expect((await callRoute(x.rig, toolRoute, tool(x, "1", ["calendar"]))).body.result.state).toBe("started");
    await runScheduled(x.rig);
    const e = await errandOf(x);
    expect(e?.lines).toHaveLength(1);
    expect(e!.reads[0]!.source).toMatchObject({ kind: "event", title: "Dentist" });
    const p = await pause(x);
    expect(p.body.proactive?.whisper.text ?? "").toContain("dentist at 1 PM");
  });

  it("'am I free Thursday afternoon for 45 minutes': free time cites what blocks it, by time only", async () => {
    const { x } = await withPat();
    scriptPlanner(x.rig, [
      { call: "find_free_time", args: { when: "Thursday afternoon", minutes: 45, part: null } },
      { outcome: "answered", lines: [{ text: "Thursday afternoon you're free from 2 PM.", refs: ["r1"] }] },
    ]);
    expect((await callRoute(x.rig, toolRoute, tool(x, "1", ["calendar"]))).body.result.state).toBe("started");
    await runScheduled(x.rig);
    const e = await errandOf(x);
    expect(e?.lines).toHaveLength(1);
    expect(e!.reads[0]!).toMatchObject({ cls: "O", shown: true, source: { kind: "event", title: "" } });
    const out = JSON.stringify(plannerRequests(x.rig).at(-1)!.body);
    expect(out).not.toContain("Design review");
    const p = await pause(x);
    expect(p.body.proactive?.whisper.text ?? "").toContain("free from 2 PM");
  });

  it("a mixed ask looks through mail and calendar in one run, with both agents' tools", async () => {
    const { x } = await withPat();
    scriptPlanner(
      x.rig,
      [
        { call: "search_mail", args: { from: "pat", words: ["plumber"], when: null, unread: false } },
        { call: "list_events", args: { when: "Thursday", part: null } },
        { outcome: "answered", lines: [{ text: "The plumber comes Thursday at 9.", refs: ["r1"] }, { text: "You have the design review Thursday at 1 PM.", refs: ["r3"] }] },
      ],
      reader,
    );
    const r = await callRoute(x.rig, toolRoute, tool(x, "1", ["mail", "calendar"]));
    expect(r.body.result.state).toBe("started");
    await runScheduled(x.rig);
    const first = ((plannerRequests(x.rig)[0]!.body as { tools?: { name: string }[] }).tools ?? []).map((t) => t.name).sort();
    expect(first).toEqual(["find_free_time", "list_events", "read_mail", "search_mail"]);
    const e = await errandOf(x);
    expect(e?.about).toEqual(["mail", "calendar"]);
    expect(e?.reads.map((r) => r.source.kind)).toEqual(expect.arrayContaining(["event", "mail"]));
    expect(e?.lines.length).toBeGreaterThan(0);
  });
});
