/**
 * The forget properties of brief 048 stage 5, on the routes: the stored world of `world.ts`, with the forget asked
 * through the real `/api/turn` (spoken in a call, or typed with no call), and the worker tick left to finish it.
 * Every model answer is a fake: the parse, the typed reply and the forget's own resolve. Test-only.
 */
import { type CoreBundle, type CoreRules, type ID, type Job, type Session, type SS } from "@franki/core";
import { type NrWorld, testId } from "@franki/core/testing";
import { currentStamp } from "../../deck";
import { readCoreDocs } from "../../core-docs";
import { storeReader } from "../../head-build";
import { fail, ok } from "../../openai/fake";
import { completed } from "../../openai/responses";
import type { RouteContext } from "../../routes/runtime";
import { turnRoute } from "../../routes/turn";
import { paths } from "../../store/paths";
import { decisionAnswer } from "../../testing/decisions";
import { callRoute, patchRecord, runScheduled, settle } from "../../testing/fakes";
import { runDueJobs } from "../../worker/tick";
import { drainExtractJobs } from "../../worker/drain";
import { WORLD_SESSION, WORLD_UID, type StoredWorld, forgetJobsOf, rootFoodOf, storeWorld, worldResolver } from "./world";

const UID = WORLD_UID;

export interface RouteWorld extends StoredWorld {
  ctx: RouteContext;
  /** True when the world's Session has a registered call (the forget is spoken and hangs it up). */
  inCall: boolean;
  /** Requests made so far, for "made after" checks. */
  n: number;
}

/**
 * The world, with a fake for every model: the parse answers "ordinary", the Responses endpoint fails (a typed reply,
 * an extraction or a recall read then takes its own fallback), every hang-up answers, and the forget resolves through
 * the world's resolver. With `inCall` false the Session's call is removed, so a forget is typed with no call open.
 */
export async function routeWorld(w: NrWorld, inCall: boolean): Promise<RouteWorld> {
  const s = await storeWorld(w);
  const deps = s.rig.deps as typeof s.rig.deps & { forgetResolve?: unknown };
  deps.forgetResolve = worldResolver(s);
  s.rig.openai.always("decisions.create", ok(decisionAnswer({})));
  s.rig.openai.always("responses.create", fail(new Error("no model answer in this world")));
  s.rig.openai.always("realtime.calls.hangup", ok({}));
  await patchRecord<Session>(s.rig.store, UID, paths.session(UID, WORLD_SESSION), {
    nextClientSeq: s.seq + 1,
    lastClientSeq: s.seq,
    committedParseSeq: s.seq,
    ...(inCall ? {} : { callId: null, registeredCallIds: [] }),
  });
  return { ...s, ctx: { uid: UID, deps: s.rig.deps, schedule: s.rig.sched.schedule }, inCall, n: 0 };
}

/** The Session's current stamp, as the browser holds it. */
export async function stampOf(s: RouteWorld, sessionId: string = WORLD_SESSION): Promise<SS> {
  const { store } = s.rig.deps;
  const core = await readCoreDocs(storeReader(store, UID), UID);
  const session = (await store.get<Session>(UID, paths.session(UID, sessionId)))!.data;
  const st = currentStamp(sessionId as ID, session.generation, { epoch: core.epoch.data, rules: core.rules.data as CoreRules, bundle: core.bundle.data as CoreBundle });
  return { sessionId: st.sessionId, epoch: st.epoch, policyRev: st.policyRev, bundleRev: st.bundleRev, rulesRev: st.rulesRev, generation: st.generation };
}

/** The next clientSeq the Session takes. */
export async function nextSeqOf(s: RouteWorld, sessionId: string = WORLD_SESSION): Promise<number> {
  return (await s.rig.store.get<Session>(UID, paths.session(UID, sessionId)))!.data.nextClientSeq;
}

/** A TurnRequest body: typed, or a final ASR turn when `spoken`. */
export function turnBody(stamp: SS, seq: number, text: string, label: string, opts: { spoken?: boolean; transcriptState?: "final" | "missing"; supersedes?: string | null; turnId?: string } = {}) {
  const spoken = opts.spoken === true || opts.transcriptState === "missing" || (opts.supersedes ?? null) !== null;
  return {
    ...stamp,
    turnId: opts.turnId ?? testId(`rw-turn-${label}`),
    requestId: testId(`rw-req-${label}`),
    clientSeq: seq,
    source: spoken ? "asr" : "typed",
    items: spoken ? [{ itemId: `item_rw_${label}`, commitSeq: seq, final: true, audioEndOpsAt: "2026-11-03T12:00:00.000Z", audioDurationMs: 800 }] : [],
    utteredWorldAt: "2026-11-03T12:00:00.000Z",
    transcript: opts.transcriptState === "missing" ? "" : text,
    transcriptState: opts.transcriptState ?? "final",
    judge: spoken ? "timeout" : "typed",
    pendingId: null,
    choiceId: null,
    supersedesRequestId: opts.supersedes ?? null,
    uiControl: null,
  };
}

export async function postTurn(s: RouteWorld, body: unknown) {
  return (await settle(callRoute(s.rig, turnRoute, body), s.rig.clock, s.rig.timers)).value;
}

/** The forget request's words for `target`, with an optional marker word only the request says. */
export const forgetText = (w: NrWorld, target: number, marker = "") => `Forget what I said about ${rootFoodOf(w, target)}${marker === "" ? "" : `, the ${marker} one`}.`;

/**
 * "Forget what I said about <food>" through `/api/turn`: spoken in a call, typed with no call. The parse answers a
 * forget; a typed turn's reply runs beside it and is dropped. Returns the route's answer.
 */
export async function forgetByRoute(s: RouteWorld, target: number, label: string, marker = "") {
  s.resolveFor.set(rootFoodOf(s.w, target), s.memoryIds[target]!);
  s.rig.clock.advance(60_000);
  s.rig.openai.script("decisions.create", ok(decisionAnswer({ forget: 0.95 })));
  if (!s.inCall) s.rig.openai.script("responses.create", ok(completed("Okay.")));
  const body = turnBody(await stampOf(s), await nextSeqOf(s), forgetText(s.w, target, marker), label, { spoken: s.inCall });
  return postTurn(s, body);
}

/** Runs the worker (scheduled work, due jobs, the extraction drain) until every forget job is done, or `rounds` pass. */
export async function workUntilForgotten(s: RouteWorld, rounds = 60): Promise<boolean> {
  const { rig } = s;
  for (let i = 0; i < rounds; i++) {
    await runScheduled(rig);
    await settle(runDueJobs(s.ctx), rig.clock, rig.timers);
    await settle(drainExtractJobs(UID, rig.deps), rig.clock, rig.timers);
    const jobs = await forgetJobsOf(rig.store);
    if (jobs.every((j) => j.job.payload.kind === "forget" && j.job.payload.phase === "done")) return true;
    if (jobs.some((j) => j.job.status === "blocked" || j.job.status === "failed")) return false;
    rig.clock.advance(5_000);
  }
  return false;
}

/** Every Job of the owner. */
export async function jobsOf(s: RouteWorld): Promise<Job[]> {
  return (await s.rig.store.query<Job>(UID, { collection: paths.collection(UID, "jobs"), where: [], orderBy: { field: "__name__", dir: "asc" }, limit: 100 })).map((j) => j.data);
}
