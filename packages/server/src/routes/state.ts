/**
 * POST /api/session/state (R13.3, R13.6; design "Refresh"). No request ledger (contracts §6 "State=norequestledger").
 * Every success returns the current SS, a StateAck (expiresOpsAt = issuedOpsAt + 2.5 s) and a re-issued Deck
 * (issuedAt now, expiresAt + 60 s) built from the stored core/bundle Head and the current four revisions; it
 * ignores core/bundle.expiresAt. The route does only its own reads and one write, and schedules `tick` without
 * awaiting it, so OpenAI or extraction never delay it.
 */
import { type Infer, type Session, StateRequest, type StateResponse, tsFromMs } from "@franki/core";
import { ensureCoreDocs, readCoreDocs } from "../core-docs";
import { currentStamp, issueDeck } from "../deck";
import { SESSION_IDLE_MS, stateAck } from "../sessions";
import { isStoreError } from "../store/errors";
import { paths } from "../store/paths";
import { scheduleTick } from "../worker/tick";
import { barrierError, scopeError, staleError } from "./errors";
import { type RouteContext, type RouteSpec, parseWith } from "./runtime";

type StateReq = Infer<typeof StateRequest>;
type StateRes = Infer<typeof StateResponse>;

/** Re-runs `fn` when a concurrent writer wins the compare-and-set (bounded; the browser retries after that). */
export async function retryStale<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i >= attempts || !isStoreError(error, "staleRevision")) throw error;
    }
  }
}

export async function sessionState(ctx: RouteContext, req: StateReq): Promise<StateRes> {
  const { uid, deps } = ctx;
  await ensureCoreDocs(uid, deps);
  scheduleTick(ctx);
  return retryStale(() =>
    deps.store.transaction(uid, async (tx) => {
      const doc = await tx.get<Session>(paths.session(uid, req.sessionId));
      if (doc === null) throw scopeError();
      const s = doc.data;
      if (s.generation !== req.generation || (s.status !== "minting" && s.status !== "active")) throw staleError("session");
      const core = await readCoreDocs(tx, uid);
      if (core.epoch.data.barrier !== null) throw barrierError();
      const head = core.bundle.data.head;
      if (head === null) throw staleError("no head");
      const ops = deps.clock.read().opsClock.now;
      const stamp = currentStamp(req.sessionId, s.generation, { epoch: core.epoch.data, rules: core.rules.data, bundle: core.bundle.data });
      const ack = stateAck(stamp, ops);
      tx.update(doc.path, {
        ...s,
        status: "active",
        browserState: "LISTENING",
        stateAck: ack,
        expiresAt: tsFromMs(ops + SESSION_IDLE_MS),
        lastSpeechStartedOpsAt: req.speechStartedOpsAt ?? s.lastSpeechStartedOpsAt,
        updatedAt: tsFromMs(ops),
      });
      return { stamp, state: "LISTENING", deck: issueDeck(stamp, head, ops), ack, barrierReceiptId: null, proactive: null } satisfies StateRes;
    }),
  );
}

export const stateRoute: RouteSpec<StateReq> = {
  name: "state",
  parse: ({ body }) => parseWith(StateRequest, body),
  run: (ctx, req) => sessionState(ctx, req),
};
