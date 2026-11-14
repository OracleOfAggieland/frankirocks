/**
 * Brief 049 part C, review fixes (Nov 14): each finding's test, written to fail on the code the reviewers read. All
 * on fakes: FakeOpenAI, FakeGoogle, the fake clock.
 */
import { describe, expect, it } from "vitest";
import { settle } from "../testing/fakes";
import { gmailMessage } from "../testing/fake-google";
import { googleErrand, readerRequests, readerSays, toolHarness } from "../testing/google-errand";
import { toolRoute } from "../routes/tool";
import { callRoute } from "../testing/fakes";
import { tool } from "../testing/errand-agent";
import { READER_CALL_MS, mailAgent } from "./google-agents";

const search = mailAgent.tools.find((t) => t.name === "search_mail")!;
const readMail = mailAgent.tools.find((t) => t.name === "read_mail")!;
const SEARCH = { from: null, words: ["lease"], when: null, unread: false };

async function started() {
  const g = await googleErrand();
  g.google.messages.set("m1", gmailMessage("m1", { from: "Dana Park <dana@example.org>", subject: "Lease", text: "The lease renewal is due Friday." }));
  const r = await callRoute(g.x.rig, toolRoute, tool(g.x));
  expect(r.body.result.state).toBe("started");
  return g;
}

describe("T11: per-run state lives in the runner's scratch, never in the module", () => {
  it("a second claim's context can't use the first claim's refs", async () => {
    const { x } = await started();
    x.rig.openai.respond("responses.create", readerSays("The sender says the lease renewal is due Friday."));
    const first = toolHarness(x);
    const out = (await settle(search.run(first.ctx, SEARCH), x.rig.clock, x.rig.timers)).value as { messages: { ref: string }[] };
    expect(out.messages.length).toBe(1);
    // A fresh claim: a new scratch, the same owner, Errand and epoch.
    const second = toolHarness(x);
    const again = (await settle(readMail.run(second.ctx, { ref: out.messages[0]!.ref }), x.rig.clock, x.rig.timers)).value as { error?: string };
    expect(again.error).toContain("not from this errand's search");
    expect(readerRequests(x)).toHaveLength(0);
  });

  it("the reader call carries its own timeout and the run's abort signal", async () => {
    const { x } = await started();
    x.rig.openai.respond("responses.create", readerSays("The sender says the lease renewal is due Friday."));
    const h = toolHarness(x);
    const out = (await settle(search.run(h.ctx, SEARCH), x.rig.clock, x.rig.timers)).value as { messages: { ref: string }[] };
    await settle(readMail.run(h.ctx, { ref: out.messages[0]!.ref }), x.rig.clock, x.rig.timers);
    const req = readerRequests(x)[0]!;
    expect(req.options?.signal).toBe(h.ctx.signal);
    expect(req.options?.timeoutMs).toBeGreaterThan(0);
    expect(req.options?.timeoutMs).toBeLessThanOrEqual(READER_CALL_MS);
  });

  it("the sent-mail checks for up to 8 senders run in parallel, inside the tool's deadline", async () => {
    const { x, google } = await started();
    google.messages.clear();
    for (let i = 1; i <= 8; i++) google.messages.set(`m${i}`, gmailMessage(`m${i}`, { from: `Sender ${i} <s${i}@example.org>`, subject: `Lease ${i}` }));
    google.slow = { timers: x.rig.timers, ms: (m, args) => (m === "listMessages" && String(args[1]).startsWith("in:sent") ? 2_000 : 0) };
    const h = toolHarness(x);
    const t0 = x.rig.clock.read().opsClock.now;
    const out = (await settle(search.run(h.ctx, SEARCH), x.rig.clock, x.rig.timers)).value as { messages: unknown[] };
    expect(out.messages).toHaveLength(8);
    expect(x.rig.clock.read().opsClock.now - t0).toBeLessThan(8_000);
    expect(google.maxInFlight.get("listMessages")).toBeGreaterThan(1);
    expect(google.maxInFlight.get("listMessages")).toBeLessThanOrEqual(4);
  });
});
