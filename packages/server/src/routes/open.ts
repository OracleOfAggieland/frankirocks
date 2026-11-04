/**
 * POST /api/session/open (R11; R26.10, R26.11; KV09; design "Session open").
 *   1. Guard (runRoute), core documents, idempotency, then the bounded Q13 expiry close from `tick`.
 *   2. The extract drain raced against 3,000 ms of opsClock; if the limit wins, open proceeds and the drain keeps
 *      running through `schedule`.
 *   3. One transaction: barrier check, Memories through Q28, compileHead, prior Session closing, core/bundle with
 *      bundleRev + 1, the new Session (minting, generation 1, stateAck), core/epoch.activeSessionId,
 *      core/state.currentZone and the request ledger entry. The Deck, StateAck and Session.stateAck carry the
 *      post-compile bundleRev. Any failure commits nothing, so core/bundle is unchanged.
 *   4. After commit, hang up the prior Session's calls and mark it closed (a failure also writes a hangup Job).
 */
import {
  type CoreBundle,
  type CoreEpoch,
  type CoreState,
  type Infer,
  OpenRequest,
  type OpenResponse,
  idParts,
  tsFromMs,
  utf8,
} from "@franki/core";
import { raceLimit } from "../clock/timers";
import { ensureCoreDocs, ownerClock, readCoreDocs } from "../core-docs";
import { currentStamp, issueDeck } from "../deck";
import { completeRequest } from "../ledger/request";
import { buildHead } from "../head-build";
import { DECK_TTL_MS, afterClosed, beginCloseInTx, finishCloseInTx, newSession, stateAck } from "../sessions";
import { paths } from "../store/paths";
import { drainExtractJobs } from "../worker/drain";
import { hangupAll } from "../worker/hangup";
import { startTick } from "../worker/tick";
import { configError } from "./errors";
import { mutation } from "./mutation";
import { type RouteContext, type RouteSpec, parseWith } from "./runtime";

export const OPEN_DRAIN_LIMIT_MS = 3_000;
export const PRIOR_HANGUP_BUDGET_MS = 1_000;

type OpenReq = Infer<typeof OpenRequest>;
type OpenRes = Infer<typeof OpenResponse>;

export async function openSession(ctx: RouteContext, req: OpenReq): Promise<OpenRes> {
  const { uid, deps } = ctx;
  await ensureCoreDocs(uid, deps, req.clientZone);
  return mutation(ctx, "open", req.requestId, req, async (key) => {
    const expiry = startTick(ctx);
    if (expiry !== null) await expiry;

    const drain = drainExtractJobs(uid, deps);
    if (!(await raceLimit(drain, OPEN_DRAIN_LIMIT_MS, deps.timers))) ctx.schedule(() => drain);

    const sessionId = deps.hasher.id(idParts.session(uid, req.requestId));
    const { response, prior } = await deps.store.transaction(uid, async (tx) => {
      const core = await readCoreDocs(tx, uid);
      const ops = deps.clock.read().opsClock.now;
      if (core.epoch.data.barrier !== null) {
        const blocked: OpenRes = { sessionId, generation: 0, deck: null, state: "blocked", ack: null, proactive: null };
        await completeRequest(tx, key, blocked, ops);
        return { response: blocked, prior: null };
      }

      const state: CoreState = { ...core.state.data, currentZone: req.clientZone };
      const pair = ownerClock(state, deps.clock);
      const compiled = await buildHead(tx, uid, { epoch: core.epoch.data, rules: core.rules.data }, pair, 1);
      if (!compiled.ok) throw configError(500, "head fixed sections exceed the token cap");
      const head = compiled.head;
      const now = tsFromMs(ops);

      const priorId = core.epoch.data.activeSessionId;
      const prior = priorId !== null && priorId !== sessionId ? await beginCloseInTx(tx, uid, priorId, ops, core.epoch) : null;

      const bundle: CoreBundle = {
        ...core.bundle.data,
        state: "clean",
        bundleRev: core.bundle.data.bundleRev + 1,
        rulesRev: core.rules.data.rulesRev,
        head,
        headHash: deps.hasher.sha256(utf8(head.text)),
        selectedRefs: head.selectedRefs,
        compiledAt: now,
        expiresAt: tsFromMs(ops + DECK_TTL_MS),
        updatedAt: now,
      };
      tx.update(paths.core(uid, "bundle"), bundle);

      const stamp = currentStamp(sessionId, 1, { epoch: core.epoch.data, rules: core.rules.data, bundle });
      tx.create(paths.session(uid, sessionId), newSession(uid, { stamp, now: ops, startedBy: req.initiator }));
      const epoch: CoreEpoch = { ...core.epoch.data, activeSessionId: sessionId, activeCallId: null, updatedAt: now };
      tx.update(paths.core(uid, "epoch"), epoch);
      tx.update(paths.core(uid, "state"), { ...state, updatedAt: now });

      const opened: OpenRes = { sessionId, generation: 1, deck: issueDeck(stamp, head, ops), state: "connecting", ack: stateAck(stamp, ops), proactive: null };
      await completeRequest(tx, key, opened, ops);
      return { response: opened, prior: prior === null ? null : { id: priorId!, ...prior } };
    });

    if (prior !== null) {
      if (prior.closed) await afterClosed(ctx, prior.id);
      else {
        const ok = await hangupAll(prior.callIds, deps, PRIOR_HANGUP_BUDGET_MS);
        const t = deps.clock.read().opsClock.now;
        await deps.store.transaction(uid, (tx) => finishCloseInTx(tx, uid, prior.id, ok, t, ctx, true));
        await afterClosed(ctx, prior.id);
      }
    }
    return response;
  });
}

export const openRoute: RouteSpec<OpenReq> = {
  name: "open",
  parse: ({ body }) => parseWith(OpenRequest, body),
  run: (ctx, req) => openSession(ctx, req),
};
