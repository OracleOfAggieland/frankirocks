/**
 * Brief 049 part C, review fixes: a rig for the Google errand agents on fakes only (FakeOpenAI, FakeGoogle), and a
 * hand-built tool context so one tool can be driven without the runner.
 */
import type { ErrandRead, ID } from "@franki/core";
import type { ErrandReadInput, ErrandToolContext, ErrandToolFlag } from "../errands/agent";
import { GOOGLE_ERRAND_AGENTS } from "../errands/google-agents";
import { registeredRead } from "../errands/run";
import { ok } from "../openai/fake";
import { normalizeResponse } from "../openai/live";
import type { RouteContext } from "../routes/runtime";
import { ASK, ERRAND_OWNER, type ErrandSetup, errandSetup } from "./errand-agent";
import { FakeGoogle, GOOGLE_TEST_ENV } from "./fake-google";
import { connectGoogleVia } from "./google-rig";

export async function googleErrand(opts: { judge?: "O" | "timeout" } = {}): Promise<{ x: ErrandSetup; google: FakeGoogle }> {
  const x = await errandSetup([], { agents: false, noMail: true, ...opts });
  Object.assign(x.rig.deps.env, GOOGLE_TEST_ENV);
  const google = new FakeGoogle();
  x.rig.deps.google = google;
  const connected = await connectGoogleVia(x.rig);
  if (connected.status !== 200) throw new Error(`googleErrand: connect answered ${connected.status}`);
  x.rig.deps.errandAgents = GOOGLE_ERRAND_AGENTS;
  return { x, google };
}

export const routeOf = (x: ErrandSetup): RouteContext => ({ uid: ERRAND_OWNER, deps: x.rig.deps, schedule: x.rig.sched.schedule });

export interface ToolHarness {
  ctx: ErrandToolContext;
  reads: ErrandRead[];
  flags: ErrandToolFlag[];
  abort: AbortController;
}

/** A tool context the way the runner builds one: its own scratch, reads registered in order, flags kept. */
export function toolHarness(x: ErrandSetup, over: Partial<ErrandToolContext> = {}): ToolHarness {
  const reads: ErrandRead[] = [];
  const flags: ErrandToolFlag[] = [];
  const abort = new AbortController();
  const read = (r: ErrandReadInput): string | null => {
    const same = reads.find((x2) => x2.evidenceId === r.evidenceId && x2.rev === r.rev);
    if (same !== undefined) {
      if (r.shown) same.shown = true;
      return same.ref;
    }
    const v = registeredRead(`r${reads.length + 1}`, r);
    if (v === null) return null;
    reads.push(v);
    return v.ref;
  };
  const ctx: ErrandToolContext = {
    route: routeOf(x),
    errandId: x.errandId as ID,
    ownerWords: [ASK],
    deadlineAt: x.rig.clock.read().opsClock.now + 8_000,
    signal: abort.signal,
    read,
    epoch: x.stamp.epoch,
    scratch: new Map(),
    readsLeft: () => 32 - reads.length,
    flag: (f) => {
      flags.push(f);
    },
    ...over,
  };
  return { ctx, reads, flags, abort };
}

export const readerRequests = (x: ErrandSetup) =>
  x.rig.openai.requestsTo("responses.create").filter((r) => (r.body as { text?: { format?: { name?: string } } } | undefined)?.text?.format?.name === "ErrandReaderV1");

/** A reader answer the fake returns. */
export const readerSays = (gist: string, when: string | null = null) => () =>
  ok(normalizeResponse({ status: "completed", output_text: JSON.stringify({ bears: true, gist, when, where: null }), output: [] } as never));

/** The tool outputs (`function_call_output`) the planner's requests carried, as text. */
export function toolOutputs(x: ErrandSetup): string[] {
  const planner = x.rig.openai.requestsTo("responses.create").filter((r) => (r.body as { text?: { format?: { name?: string } } }).text?.format?.name === "ErrandResultV1");
  const last = planner.at(-1);
  if (last === undefined) return [];
  return ((last.body as { input: { type?: string; output?: string }[] }).input ?? []).filter((i) => i.type === "function_call_output").map((i) => i.output ?? "");
}

/** Gmail's own Authentication-Results header for a domain that passed DMARC. */
export const dmarcPass = (domain: string) => ({ name: "Authentication-Results", value: `mx.google.com; dkim=pass header.i=@${domain}; spf=pass smtp.mailfrom=${domain}; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=${domain}` });
