/**
 * The hardRule route on a parse committed after the turn's own transaction (brief 012 G20, G39, CQ 113; task B9):
 * the Superseding_Post and the Parse_Repair. Both run the hardRule route only, and only once per turn: when
 * `core/rules.handled` already has a hardRule entry for the turn's Evidence, nothing runs and no FastSlots call is
 * made.
 *
 * - A supersede is the turn's own post. It runs `executeHardRule` in its own transaction (`routes/turn.ts`).
 * - A repair commits the parse under its lease as before, then runs the route outside the lease. Its result is a
 *   proposal (`repairProposal`): the rules the plan would add, written into `core/rules.proposals` without raising
 *   `rulesRev`, with a `proposed` entry in `handled`. The next turn or `open` applies it (G39), so no Deck rises
 *   mid-reply.
 *
 * Rulings for this build (brief 018 report): a late route never answers the open question (`LATE_ANSWERS`), so it
 * lends no subject and closes nothing; a repair's proposal can only add rules, so a late denial, or a pending rule
 * the plan would make active, changes nothing (the owner's next turn does), and it plans no question.
 */
import { type CoreBundle, type CoreEpoch, type CoreRules, type CoreState, type Evidence, HANDLED_RING_MAX, PROPOSAL_INSTALL_MAX, type Session, type Turn, UNRESOLVED, tsFromMs } from "@franki/core";
import { effectiveAudience } from "../audience";
import { ownerClock } from "../core-docs";
import { isDemoVisit } from "../demo/visit";
import type { SlowParse } from "../intents/slow-parse";
import type { RouteContext } from "../routes/runtime";
import { isStoreError } from "../store/errors";
import { paths } from "../store/paths";
import { type Tx, readSnapshot } from "../store/port";
import { turnEvidenceId } from "../turns";
import { withBackstop } from "./backstop";
import { proposalDecision, writeRuleRows } from "./rule-rows";
import { type HardRuleRun, executeHardRule } from "./execute";
import { type RouteRun, readPreRoute, runHardRuleSlots } from "./route";
import { candidateOpens, regexOpens, speakerCertain } from "./trigger";

/** A late route treats no turn as an answer to the open question (fail closed: no subject is lent, nothing closes). */
export const LATE_ANSWERS = false;
/** Transaction attempts for the repair's proposal write. */
const LATE_TX_ATTEMPTS = 8;

type Rule = CoreRules["allergies"][number];
const slotOf = (r: Rule) => `${r.anonymous ? "" : (r.subjectId ?? "")}|${r.code}`;

/** The route already ran for this Evidence: on the turn, in a supersede or in an earlier repair. */
export const routeHandled = (rules: CoreRules, eid: string): boolean => (rules.handled ?? []).some((h) => h.eid === eid && h.entries.some((e) => e.route === "hardRule"));

/** Whether a late parse opens hardRule: a final U line with RX4 in it, or a committed parse with a hardRule candidate. */
export const lateOpens = (text: string, cls: string, slow: SlowParse | null): boolean => {
  const facts = { text, cls, transcriptState: "final" as const, supersedes: false };
  return regexOpens(facts) || (cls === "U" && text !== "" && candidateOpens(slow));
};

/** The FastSlots call of a late route, or null when it doesn't open or already ran. */
export async function lateSlots(ctx: Pick<RouteContext, "uid" | "deps">, a: { turnId: string; text: string; cls: string; typed: boolean; slow: SlowParse | null; generation: number }): Promise<{ run: RouteRun; regex: boolean } | null> {
  if (!lateOpens(a.text, a.cls, a.slow)) return null;
  const pre = await readPreRoute(ctx);
  const eid = turnEvidenceId(a.turnId as never, ctx.deps.hasher);
  if (routeHandled(pre.rules, eid)) return null;
  const regex = regexOpens({ text: a.text, cls: a.cls, transcriptState: "final", supersedes: false });
  const run = await runHardRuleSlots(ctx, { eid, text: a.text, typed: a.typed, regex, askedRuleId: null, asked: LATE_ANSWERS, pre, generation: a.generation, slowP: Promise.resolve(a.slow) });
  return run === null ? null : { run, regex };
}

/**
 * The repair's proposal (G39): what the plan would add to `core/rules`, as a `repair` proposal, plus the `proposed`
 * `handled` entry. `rulesRev`, the open question and every existing rule stay as they are. Null when the route
 * already ran for this Evidence.
 */
export function repairProposal(run: HardRuleRun): CoreRules | null {
  const r0 = run.rules;
  if (routeHandled(r0, run.evidence.eid)) return null;
  // Planned on the rules as they stand, without the open proposals, so only what this turn adds is proposed.
  const res = executeHardRule({ ...run, rules: { ...r0, proposals: [] }, askedAtArrival: null });
  const have = new Set([...r0.allergies, ...r0.proposals.flatMap((p) => p.install)].map(slotOf));
  const added = res.rules.allergies.filter((r) => !have.has(slotOf(r)));
  const install: Rule[] =
    added.length <= PROPOSAL_INSTALL_MAX
      ? added
      : [...added.slice(0, PROPOSAL_INSTALL_MAX - 1), { ...added[0]!, id: run.hasher.id(["allergyPending", "anyone", UNRESOLVED, run.evidence.eid]), subjectId: null, anonymous: true, code: UNRESOLVED, state: "pending", proof: null, proofRev: null, rootKeys: [], dependsOn: [] }];
  const ring = res.rules.handled.at(-1)!;
  const handled = [...r0.handled.filter((h) => h.eid !== run.evidence.eid), { ...ring, entries: ring.entries.map((e) => ({ ...e, outcome: "proposed" as const })) }].slice(-HANDLED_RING_MAX);
  const base: CoreRules = { ...r0, subjectLabels: res.rules.subjectLabels, handled };
  if (install.length === 0) return base;
  return withBackstop(base, { id: run.hasher.id(["proposal", "repair", run.evidence.eid]), origin: "repair", turnId: run.turnId, eid: run.evidence.eid, install });
}

/**
 * After a repair has committed the parse (`ordinary` or `hit`): the hardRule route, once, as a proposal. Its own
 * transaction re-checks `handled`, so two late runs propose once.
 * Kiroween Demo (contract question 97): `demo` is the caller's answer when it has one; else the verified token, else
 * the connectors (a repair runs after the response, with no token). The plan compiles a Head as the turn's does, so it
 * plays the persona on a demo visit; the proposal keeps only rules, so what is written is the same either way.
 */
export async function runRepairRoute(ctx: Pick<RouteContext, "uid" | "deps" | "anonymous">, target: { sessionId: string; turnId: string }, slow: SlowParse, demo?: boolean): Promise<"proposed" | "none"> {
  const { uid, deps } = ctx;
  const turnDoc = await deps.store.get<Turn>(uid, paths.turn(uid, target.sessionId, target.turnId));
  const t = turnDoc?.data;
  if (t === undefined || t.role !== "user" || t.text === null || t.evidenceId === null) return "none";
  const session = await deps.store.get<Session>(uid, paths.session(uid, target.sessionId));
  if (session === null) return "none";
  const typed = t.itemIds.length === 0;
  const late = await lateSlots(ctx, { turnId: target.turnId, text: t.text, cls: t.sourceClass, typed, slow, generation: session.data.generation });
  if (late === null) return "none";
  const playsOwner = demo ?? (ctx.anonymous !== undefined ? ctx.anonymous : await readSnapshot(deps.store, uid, (reader) => isDemoVisit({ uid, env: deps.env, hasher: deps.hasher }, reader)));
  const evidenceId = t.evidenceId;
  for (let attempt = 1; ; attempt++) {
    try {
      return await deps.store.transaction(uid, (tx) => proposeTx(tx));
    } catch (error) {
      if (!isStoreError(error, "staleRevision") || attempt >= LATE_TX_ATTEMPTS) throw error;
    }
  }

  async function proposeTx(tx: Tx): Promise<"proposed" | "none"> {
    const [rules, epoch, bundle, state, ev, s] = await Promise.all([
      tx.get<CoreRules>(paths.core(uid, "rules")),
      tx.get<CoreEpoch>(paths.core(uid, "epoch")),
      tx.get<CoreBundle>(paths.core(uid, "bundle")),
      tx.get<CoreState>(paths.core(uid, "state")),
      tx.get<Evidence>(paths.evidence(uid, evidenceId)),
      tx.get<Session>(paths.session(uid, target.sessionId)),
    ]);
    if (rules === null || epoch === null || bundle === null || state === null || ev === null || s === null) return "none";
    const clock = ownerClock(state.data, deps.clock);
    const ops = clock.opsClock.now;
    const next = repairProposal({
      uid,
      sessionId: target.sessionId,
      turnId: target.turnId,
      clientSeq: t!.seq,
      generation: s.data.generation,
      source: typed ? "typed" : "asr",
      rules: rules.data,
      epoch: epoch.data,
      bundle: bundle.data,
      evidence: { eid: evidenceId, record: ev.data },
      slots: late!.run.slots,
      trigger: { regex: late!.regex, candidate: candidateOpens(slow), asked: false },
      askedAtArrival: null,
      speakerCertain: speakerCertain(typed ? "typed" : "asr", slow),
      context: late!.run.context,
      clock,
      audience: effectiveAudience(s.data, ops),
      hasher: deps.hasher,
      ...(playsOwner ? { playsOwner: true } : {}),
    });
    if (next === null) return "none";
    tx.update(rules.path, next);
    // Brief 042 item 6 (W-166 row 7): the repair's proposal is a row citing the turn's Evidence.
    const proposal = next.proposals.find((p) => p.origin === "repair" && p.eid === evidenceId);
    if (proposal !== undefined) {
      writeRuleRows(tx, { uid, source: "repair", sessionId: target.sessionId, turnId: target.turnId, rulesDocRev: rules.data.rev, rulesRev: next.rulesRev, now: tsFromMs(ops), epoch: epoch.data.epoch, policyRev: epoch.data.policyRev, hasher: deps.hasher }, [proposalDecision(proposal)]);
    }
    return "proposed";
  }
}
