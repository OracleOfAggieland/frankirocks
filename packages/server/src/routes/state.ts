/**
 * POST /api/session/state (R13.3, R13.6; design "Refresh"). No request ledger (contracts §6 "State=norequestledger").
 * Every success returns the current SS, a StateAck (expiresOpsAt = issuedOpsAt + 2.5 s) and a re-issued Deck
 * (issuedAt now, expiresAt + 60 s) built from the stored core/bundle Head and the current four revisions; it
 * ignores core/bundle.expiresAt. The route does only its own reads and one write, and schedules `tick` without
 * awaiting it, so OpenAI or extraction never delay it.
 */
import { type Infer, type Session, StateRequest, type StateResponse, type Turn, msFromTs, tsFromMs } from "@franki/core";
import { effectiveAudience, expireLease, hasParseGap } from "../audience";
import { ensureCoreDocs, readCoreDocs } from "../core-docs";
import { currentStamp, issueDeck } from "../deck";
import { SESSION_IDLE_MS, stateAck } from "../sessions";
import { isStoreError } from "../store/errors";
import { paths } from "../store/paths";
import type { Tx } from "../store/port";
import { scheduleTick } from "../worker/tick";
import { barrierError, scopeError, staleError } from "./errors";
import { type RouteContext, type RouteSpec, parseWith } from "./runtime";

type StateReq = Infer<typeof StateRequest>;
type StateRes = Infer<typeof StateResponse>;

/** A poll writes the Session only when its idle expiry would move at least this far (question 84). */
export const SESSION_WRITE_MIN_MS = 30_000;

/** True when an S2 user Turn is among the Session's last four user Turns (R4.2; question 61). */
async function recentS2(tx: Pick<Tx, "query">, uid: string, sessionId: string, s: Session): Promise<boolean> {
  if (s.lastClientSeq === 0) return false;
  const rows = await tx.query<Turn>({
    collection: paths.turns(uid, sessionId),
    where: [{ field: "seq", op: ">=", value: Math.max(0, s.lastClientSeq - 3) }],
    orderBy: { field: "seq", dir: "asc" },
    limit: 16,
  });
  return rows.some((r) => r.data.role === "user" && r.data.rootSlices.some((sl) => sl.sens === "S2"));
}

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
      // An earlier failed parse whose repair window ran out is a failed repair (R15.6).
      const next = expireLease(s, ops);
      // R4.2: no ack while the audience is unknown, a parse gap exists, or an S2 user Turn is among the last four.
      const ack = effectiveAudience(next, ops) === "unknown" || hasParseGap(next) || (await recentS2(tx, uid, req.sessionId, next)) ? null : stateAck(stamp, ops);
      // Question 84: polled once a second, the Session is written only when something it shows would change.
      const expiresAt = tsFromMs(ops + SESSION_IDLE_MS);
      const due = next !== s || s.status !== "active" || s.browserState !== "LISTENING" || msFromTs(expiresAt) - msFromTs(s.expiresAt) >= SESSION_WRITE_MIN_MS;
      if (due) {
        tx.update(doc.path, {
          ...next,
          status: "active",
          browserState: "LISTENING",
          stateAck: ack ?? next.stateAck,
          expiresAt,
          lastSpeechStartedOpsAt: req.speechStartedOpsAt ?? s.lastSpeechStartedOpsAt,
          updatedAt: tsFromMs(ops),
        });
      }
      return { stamp, state: "LISTENING", deck: issueDeck(stamp, head, ops), ack, barrierReceiptId: null, proactive: null } satisfies StateRes;
    }),
  );
}

export const stateRoute: RouteSpec<StateReq> = {
  name: "state",
  parse: ({ body }) => parseWith(StateRequest, body),
  run: (ctx, req) => sessionState(ctx, req),
};
